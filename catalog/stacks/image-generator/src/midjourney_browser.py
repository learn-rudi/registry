"""Playwright driver for bounded Midjourney browser workflows."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import stat
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from errors import ToolError
from midjourney_contract import (
    IMAGE_MEDIA_TYPES,
    JOB_ID_PATTERN,
    MIDJOURNEY_IMAGINE_URL,
    file_digest,
    source_url,
)
from midjourney_uploads import upload_reference_prompt
from outputs import ensure_output_path, nonce, timestamp


class _ProfileLock:
    STALE_AFTER_SECONDS = 2 * 60 * 60

    def __init__(self, path: Path) -> None:
        self.path = path
        self.token = uuid.uuid4().hex

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {"pid": os.getpid(), "created_at": int(time.time()), "token": self.token},
            separators=(",", ":"),
        )
        descriptor = None
        for attempt in range(2):
            try:
                descriptor = os.open(
                    self.path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                break
            except FileExistsError as exc:
                if attempt == 0 and self._remove_stale_lock():
                    continue
                raise ToolError(
                    "browser_busy",
                    "The dedicated Midjourney browser profile is already in use.",
                ) from exc
        if descriptor is None:
            raise ToolError("browser_busy", "Could not lock the Midjourney browser profile.")
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(payload)

    def _remove_stale_lock(self) -> bool:
        try:
            metadata = self.path.lstat()
            if not stat.S_ISREG(metadata.st_mode) or self.path.is_symlink() or metadata.st_size > 1024:
                return False
            value = json.loads(self.path.read_text(encoding="utf-8"))
            created_at = value.get("created_at")
            if not isinstance(created_at, int):
                return False
            if time.time() - created_at <= self.STALE_AFTER_SECONDS:
                return False
            self.path.unlink()
            return True
        except (OSError, json.JSONDecodeError):
            return False

    def release(self) -> None:
        if self.path.is_symlink() or not self.path.is_file():
            return
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if value.get("token") == self.token:
            self.path.unlink(missing_ok=True)


def _find_chromium_executable() -> str | None:
    configured = os.environ.get("MIDJOURNEY_CHROMIUM_EXECUTABLE")
    if configured:
        path = Path(configured).expanduser().resolve()
        if not path.is_file() or not os.access(path, os.X_OK):
            raise ToolError(
                "browser_dependency",
                "MIDJOURNEY_CHROMIUM_EXECUTABLE does not point to a browser executable.",
            )
        return str(path)
    candidates = (
        "chromium",
        "chromium-browser",
        "google-chrome",
        "google-chrome-stable",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    )
    for candidate in candidates:
        if os.path.isabs(candidate):
            if Path(candidate).is_file() and os.access(candidate, os.X_OK):
                return candidate
        else:
            found = shutil.which(candidate)
            if found:
                return found
    return None


def login_browser_command(executable: str, profile_dir: Path) -> tuple[str, ...]:
    """Build the fixed, visible login command for the dedicated profile."""
    return (
        executable,
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        MIDJOURNEY_IMAGINE_URL,
    )


def persistent_context_launch_options(
    *,
    show_browser: bool,
    executable: str | None,
) -> dict[str, Any]:
    options: dict[str, Any] = {
        "headless": not show_browser,
        "locale": "en-US",
        "chromium_sandbox": True,
    }
    if executable:
        options["executable_path"] = executable
    return options


def profile_browser_is_running(profile_dir: Path) -> bool:
    socket_path = profile_dir / "SingletonSocket"
    if socket_path.is_symlink() and socket_path.exists():
        return True

    lock_path = profile_dir / "SingletonLock"
    if not lock_path.is_symlink():
        return False
    try:
        target = os.readlink(lock_path)
    except OSError:
        return False
    match = re.search(r"-([1-9][0-9]*)$", target)
    if match is None:
        return False
    try:
        os.kill(int(match.group(1)), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class PlaywrightMidjourneyDriver:
    def __init__(self, *, state_root: Path, output_root: Path) -> None:
        self.state_root = state_root.expanduser().resolve()
        self.profile_dir = self.state_root / "profile"
        self.lock = _ProfileLock(self.state_root / "profile.lock")
        self.output_root = output_root.expanduser().resolve()
        self._login_process: subprocess.Popen[bytes] | None = None

    def _require_online(self) -> None:
        if os.environ.get("RUDI_VERIFY_OFFLINE") == "1":
            raise ToolError(
                "offline",
                "Midjourney browser calls are disabled during offline verification.",
            )

    @asynccontextmanager
    async def _page(self, *, show_browser: bool) -> AsyncIterator[Any]:
        self._require_online()
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise ToolError(
                "browser_dependency",
                "Python Playwright is not installed for the image-generator stack.",
            ) from exc

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.profile_dir.chmod(0o700)
        except OSError:
            pass
        self.lock.acquire()
        playwright = None
        context = None
        try:
            if profile_browser_is_running(self.profile_dir):
                raise ToolError(
                    "browser_busy",
                    "The dedicated Midjourney sign-in browser is still open.",
                    {
                        "remediation": (
                            "Finish sign-in, close the dedicated browser window, "
                            "then retry."
                        )
                    },
                )
            try:
                playwright = await async_playwright().start()
            except Exception as exc:
                raise ToolError(
                    "browser_dependency",
                    "Could not initialize Playwright for Midjourney automation.",
                ) from exc
            executable = _find_chromium_executable()
            launch_options = persistent_context_launch_options(
                show_browser=show_browser,
                executable=executable,
            )
            try:
                context = await playwright.chromium.launch_persistent_context(
                    str(self.profile_dir),
                    **launch_options,
                )
            except Exception as exc:
                raise ToolError(
                    "browser_dependency",
                    "Could not launch Chromium for Midjourney automation.",
                    {
                        "remediation": (
                            "Install Chromium or run `python -m playwright install chromium`, "
                            "then retry."
                        )
                    },
                ) from exc
            page = context.pages[0] if context.pages else await context.new_page()
            page.set_default_timeout(15_000)
            yield page
        finally:
            try:
                if context is not None:
                    await context.close()
            finally:
                try:
                    if playwright is not None:
                        await playwright.stop()
                finally:
                    self.lock.release()

    async def _navigate_imagine(self, page: Any, timeout_seconds: int) -> None:
        try:
            await page.goto(
                MIDJOURNEY_IMAGINE_URL,
                wait_until="domcontentloaded",
                timeout=min(timeout_seconds, 60) * 1_000,
            )
        except Exception as exc:
            raise ToolError("provider_error", "Could not open Midjourney Create.") from exc

    async def _authentication_state(self, page: Any) -> bool | None:
        prompt_box = page.get_by_role(
            "textbox",
            name="What will you imagine?",
            exact=True,
        )
        count = await prompt_box.count()
        if count == 1 and await prompt_box.is_enabled():
            return True
        if count > 1:
            raise ToolError("ui_drift", "Midjourney exposed an ambiguous prompt control.")
        login_box = page.get_by_role(
            "textbox",
            name="Log in to start creating...",
            exact=True,
        )
        if await login_box.count() == 1:
            return False
        login_text = page.get_by_text("Log In", exact=True)
        if await login_text.count() >= 1:
            return False
        return None

    async def _authenticated(self, page: Any, *, wait_seconds: int = 15) -> bool:
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            state = await self._authentication_state(page)
            if state is not None:
                return state
            await asyncio.sleep(0.25)
        if "just a moment" in (await page.title()).lower():
            raise ToolError(
                "browser_challenge",
                "Midjourney presented a browser verification challenge.",
                {"remediation": "Retry with show_browser=true and complete the visible challenge if prompted."},
            )
        raise ToolError("ui_drift", "Midjourney authentication controls changed.")

    async def session_status(self) -> dict[str, Any]:
        async with self._page(show_browser=True) as page:
            await self._navigate_imagine(page, 60)
            return {"authenticated": await self._authenticated(page)}

    async def login(self) -> dict[str, Any]:
        self._require_online()
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.profile_dir.chmod(0o700)
        except OSError:
            pass
        self.lock.acquire()
        try:
            if (
                profile_browser_is_running(self.profile_dir)
                or (
                    self._login_process is not None
                    and self._login_process.poll() is None
                )
            ):
                return {"browser_ready": True, "browser_started": False}
            executable = _find_chromium_executable()
            if executable is None:
                raise ToolError(
                    "browser_dependency",
                    "Could not find Chromium for the Midjourney login browser.",
                    {
                        "remediation": (
                            "Install Chromium or configure MIDJOURNEY_CHROMIUM_EXECUTABLE, "
                            "then retry."
                        )
                    },
                )
            try:
                self._login_process = subprocess.Popen(
                    login_browser_command(executable, self.profile_dir),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    close_fds=True,
                    start_new_session=True,
                )
            except OSError as exc:
                raise ToolError(
                    "browser_dependency",
                    "Could not open Chromium for Midjourney sign-in.",
                ) from exc
            return {"browser_ready": True, "browser_started": True}
        finally:
            self.lock.release()

    async def _job_ids(self, page: Any) -> set[str]:
        hrefs = await page.locator('a[href^="/jobs/"]').evaluate_all(
            "elements => elements.slice(0, 500).map(element => element.getAttribute('href'))"
        )
        values: set[str] = set()
        for href in hrefs:
            if not isinstance(href, str):
                continue
            match = re.match(r"^/jobs/([0-9a-f-]{36})\?index=[0-3]$", href)
            if match and JOB_ID_PATTERN.fullmatch(match.group(1)):
                values.add(match.group(1))
        return values

    async def generate(
        self,
        *,
        prompt: str,
        references: dict[str, Any],
        timeout_seconds: int,
        show_browser: bool,
    ) -> dict[str, Any]:
        async with self._page(show_browser=show_browser) as page:
            await self._navigate_imagine(page, timeout_seconds)
            if not await self._authenticated(page):
                raise ToolError(
                    "authentication_required",
                    "Midjourney is not signed in for the dedicated RUDI browser profile.",
                    {"remediation": "Call midjourney_login and complete sign-in in the opened browser."},
                )
            prompt_box = page.get_by_role(
                "textbox",
                name="What will you imagine?",
                exact=True,
            )
            if await prompt_box.count() != 1:
                raise ToolError("ui_drift", "Midjourney prompt control changed.")
            submitted_prompt = await upload_reference_prompt(
                page,
                prompt_value=prompt,
                references=references,
                timeout_seconds=timeout_seconds,
            )
            baseline = await self._job_ids(page)
            await prompt_box.fill(submitted_prompt)
            await prompt_box.press("Enter")

            deadline = time.monotonic() + timeout_seconds
            job_id_value: str | None = None
            while time.monotonic() < deadline:
                new_job_ids = (await self._job_ids(page)) - baseline
                if len(new_job_ids) > 1:
                    raise ToolError(
                        "ui_drift",
                        "More than one new Midjourney job appeared; refusing to guess which one was submitted.",
                    )
                if len(new_job_ids) == 1:
                    job_id_value = next(iter(new_job_ids))
                    break
                await asyncio.sleep(0.5)
            if job_id_value is None:
                raise ToolError(
                    "timeout",
                    "Midjourney did not expose a job id before the timeout.",
                    {"timeout_seconds": timeout_seconds},
                )
            return {"job_id": job_id_value}

    async def export_job(
        self,
        *,
        job_id: str,
        indexes: tuple[int, ...],
        timeout_seconds: int,
        show_browser: bool,
    ) -> list[dict[str, Any]]:
        ensure_output_path(self.output_root, "midjourney output root")
        export_dir = self.output_root / "midjourney" / f"{job_id}-{timestamp()}-{nonce()}"
        ensure_output_path(export_dir, "midjourney export directory")
        export_dir.mkdir(parents=True, exist_ok=False)
        artifacts: list[dict[str, Any]] = []
        try:
            async with self._page(show_browser=show_browser) as page:
                for index in indexes:
                    artifact = await self._download_variation(
                        page,
                        export_dir=export_dir,
                        job_id=job_id,
                        index=index,
                        timeout_seconds=timeout_seconds,
                    )
                    artifacts.append(artifact)
            return artifacts
        except Exception:
            shutil.rmtree(export_dir, ignore_errors=True)
            raise

    async def _download_variation(
        self,
        page: Any,
        *,
        export_dir: Path,
        job_id: str,
        index: int,
        timeout_seconds: int,
    ) -> dict[str, Any]:
        job_url = source_url(job_id, index)
        await page.goto(
            job_url,
            wait_until="domcontentloaded",
            timeout=min(timeout_seconds, 60) * 1_000,
        )
        if not await self._authenticated(page):
            raise ToolError(
                "authentication_required",
                "Midjourney is not signed in for the dedicated RUDI browser profile.",
            )
        download_button = page.get_by_role(
            "button",
            name="Download Image",
            exact=True,
        )
        try:
            await download_button.wait_for(
                state="visible",
                timeout=timeout_seconds * 1_000,
            )
        except Exception as exc:
            raise ToolError(
                "timeout",
                "Midjourney image was not ready to download before the timeout.",
                {"job_id": job_id, "index": index},
            ) from exc
        if await download_button.count() != 1:
            raise ToolError("ui_drift", "Midjourney download control changed.")
        temporary = export_dir / f".variation-{index + 1}-{uuid.uuid4().hex}.download"
        try:
            async with page.expect_download(timeout=timeout_seconds * 1_000) as pending:
                await download_button.click()
            download = await pending.value
            await download.save_as(str(temporary))
        except Exception as exc:
            raise ToolError(
                "download_failed",
                "Midjourney did not produce a downloadable image.",
                {"job_id": job_id, "index": index},
            ) from exc
        size, digest, image_format = file_digest(temporary)
        media_type = IMAGE_MEDIA_TYPES.get(image_format)
        if media_type is None:
            raise ToolError(
                "download_failed",
                "Midjourney download was not a PNG, JPEG, or WebP image.",
                {"job_id": job_id, "index": index},
            )
        suffix = ".jpg" if image_format == "jpg" else f".{image_format}"
        final_path = export_dir / f"variation-{index + 1}{suffix}"
        if final_path.exists():
            raise ToolError("download_failed", "Midjourney export path already exists.")
        os.replace(temporary, final_path)
        return {
            "index": index,
            "file_name": final_path.name,
            "local_path": str(final_path.resolve()),
            "media_type": media_type,
            "sha256": digest,
            "size_bytes": size,
            "source_url": job_url,
        }
