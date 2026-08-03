"""Midjourney state machine and MCP-facing service behavior."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from errors import ToolError, ok_result
from midjourney_contract import (
    JsonRequestStore,
    aspect_ratio,
    boolean,
    bounded_timeout,
    exact_keys,
    fingerprint,
    indexes,
    job_id,
    prompt,
    request_id,
    validate_artifacts,
)


class MidjourneyDriver(Protocol):
    async def session_status(self) -> dict[str, Any]: ...

    async def login(self, *, timeout_seconds: int) -> dict[str, Any]: ...

    async def generate(
        self,
        *,
        prompt: str,
        timeout_seconds: int,
        show_browser: bool,
    ) -> dict[str, Any]: ...

    async def export_job(
        self,
        *,
        job_id: str,
        indexes: tuple[int, ...],
        timeout_seconds: int,
        show_browser: bool,
    ) -> list[dict[str, Any]]: ...


class MidjourneyService:
    def __init__(
        self,
        *,
        driver: MidjourneyDriver,
        request_store: JsonRequestStore,
        output_root: Path,
    ) -> None:
        self.driver = driver
        self.request_store = request_store
        self.output_root = output_root.expanduser().resolve()
        self.output_root.mkdir(parents=True, exist_ok=True)

    async def session_status(self, args: dict[str, Any]) -> dict[str, Any]:
        exact_keys(args, set())
        result = await self.driver.session_status()
        authenticated = result.get("authenticated") if isinstance(result, dict) else None
        if not isinstance(authenticated, bool):
            raise ToolError("internal_error", "Midjourney driver returned an invalid session status.")
        return ok_result(
            provider="midjourney",
            authenticated=authenticated,
            profile_mode="dedicated",
            login_required=not authenticated,
        )

    async def login(self, args: dict[str, Any]) -> dict[str, Any]:
        exact_keys(args, {"timeout_seconds"})
        timeout_seconds = bounded_timeout(args.get("timeout_seconds"))
        result = await self.driver.login(timeout_seconds=timeout_seconds)
        authenticated = result.get("authenticated") if isinstance(result, dict) else None
        if authenticated is not True:
            raise ToolError("authentication_required", "Midjourney login did not complete.")
        return ok_result(
            provider="midjourney",
            authenticated=True,
            profile_mode="dedicated",
        )

    async def generate(self, args: dict[str, Any]) -> dict[str, Any]:
        exact_keys(
            args,
            {"aspect_ratio", "prompt", "request_id", "show_browser", "timeout_seconds"},
        )
        request_id_value = request_id(args.get("request_id"))
        prompt_value = prompt(args.get("prompt"))
        aspect_ratio_value = aspect_ratio(args.get("aspect_ratio"), prompt_value)
        submitted_prompt = (
            f"{prompt_value} --ar {aspect_ratio_value}"
            if aspect_ratio_value
            else prompt_value
        )
        timeout_seconds = bounded_timeout(args.get("timeout_seconds"))
        show_browser = boolean(args.get("show_browser"), "show_browser")
        fingerprint_value = fingerprint(submitted_prompt)

        record = self.request_store.load(request_id_value)
        replayed = record is not None
        if record is None:
            if not self.request_store.create_pending(
                request_id=request_id_value,
                fingerprint=fingerprint_value,
            ):
                record = self.request_store.load(request_id_value)
                replayed = True
            else:
                record = self.request_store.load(request_id_value)
        if record is None:
            raise ToolError("internal_error", "Midjourney idempotency record was not created.")
        if record.get("fingerprint") != fingerprint_value:
            raise ToolError(
                "idempotency_conflict",
                "`request_id` was already used for a different Midjourney request.",
                {"request_id": request_id_value},
            )

        if record.get("status") == "complete":
            stored = record.get("result")
            if not isinstance(stored, dict):
                raise ToolError("internal_error", "Completed Midjourney record has no result.")
            job_id_value = job_id(stored.get("job_id"))
            try:
                artifacts = validate_artifacts(
                    stored.get("artifacts"),
                    job_id_value=job_id_value,
                    indexes_value=(0, 1, 2, 3),
                    output_root=self.output_root,
                )
                return {**stored, "artifacts": artifacts, "replayed": True}
            except ToolError:
                record = {**record, "status": "submitted", "job_id": job_id_value}
                self.request_store.update(request_id_value, record)

        job_id_value = record.get("job_id")
        if record.get("status") == "pending" and job_id_value is None:
            if replayed:
                raise ToolError(
                    "idempotency_in_doubt",
                    "The earlier Midjourney submission outcome is unknown; refusing to submit it again.",
                    {"request_id": request_id_value},
                )
            generated = await self.driver.generate(
                prompt=submitted_prompt,
                timeout_seconds=timeout_seconds,
                show_browser=show_browser,
            )
            if not isinstance(generated, dict):
                raise ToolError("provider_error", "Midjourney returned an invalid generation result.")
            job_id_value = job_id(generated.get("job_id"))
            record = {**record, "status": "submitted", "job_id": job_id_value}
            self.request_store.update(request_id_value, record)

        job_id_value = job_id(job_id_value)
        artifacts = await self.driver.export_job(
            job_id=job_id_value,
            indexes=(0, 1, 2, 3),
            timeout_seconds=timeout_seconds,
            show_browser=show_browser,
        )
        validated = validate_artifacts(
            artifacts,
            job_id_value=job_id_value,
            indexes_value=(0, 1, 2, 3),
            output_root=self.output_root,
        )
        result = ok_result(
            provider="midjourney",
            status="complete",
            request_id=request_id_value,
            prompt_sha256=fingerprint_value,
            job_id=job_id_value,
            artifacts=validated,
            replayed=replayed,
        )
        self.request_store.update(
            request_id_value,
            {**record, "status": "complete", "result": {**result, "replayed": False}},
        )
        return result

    async def export_job(self, args: dict[str, Any]) -> dict[str, Any]:
        exact_keys(args, {"indexes", "job_id", "show_browser", "timeout_seconds"})
        job_id_value = job_id(args.get("job_id"))
        indexes_value = indexes(args.get("indexes"))
        timeout_seconds = bounded_timeout(args.get("timeout_seconds"))
        show_browser = boolean(args.get("show_browser"), "show_browser")
        artifacts = await self.driver.export_job(
            job_id=job_id_value,
            indexes=indexes_value,
            timeout_seconds=timeout_seconds,
            show_browser=show_browser,
        )
        return ok_result(
            provider="midjourney",
            job_id=job_id_value,
            artifacts=validate_artifacts(
                artifacts,
                job_id_value=job_id_value,
                indexes_value=indexes_value,
                output_root=self.output_root,
            ),
        )
