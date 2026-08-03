"""Validation, artifact, and idempotency contracts for Midjourney."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import time
import uuid
from pathlib import Path
from typing import Any

from errors import ToolError
from outputs import detect_image_format


MIDJOURNEY_ORIGIN = "https://www.midjourney.com"
MIDJOURNEY_IMAGINE_URL = f"{MIDJOURNEY_ORIGIN}/imagine"
MAX_MIDJOURNEY_PROMPT_CHARS = 6_000
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 180
MIN_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 600
JOB_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
ASPECT_RATIO_PATTERN = re.compile(r"^([1-9][0-9]?):([1-9][0-9]?)$")
ASPECT_PARAMETER_PATTERN = re.compile(r"(?:^|\s)--(?:ar|aspect)(?:\s|=)", re.IGNORECASE)
IMAGE_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
}


def exact_keys(args: dict[str, Any], allowed: set[str]) -> None:
    if not isinstance(args, dict):
        raise ToolError("validation", "Tool arguments must be an object.")
    unexpected = sorted(set(args) - allowed)
    if unexpected:
        raise ToolError(
            "validation",
            f"Unexpected field(s): {', '.join(unexpected)}.",
            {"fields": unexpected},
        )


def bounded_timeout(value: Any) -> int:
    if value is None:
        return DEFAULT_TIMEOUT_SECONDS
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolError(
            "validation",
            "`timeout_seconds` must be an integer.",
            {"field": "timeout_seconds"},
        )
    if value < MIN_TIMEOUT_SECONDS or value > MAX_TIMEOUT_SECONDS:
        raise ToolError(
            "validation",
            f"`timeout_seconds` must be between {MIN_TIMEOUT_SECONDS} and {MAX_TIMEOUT_SECONDS}.",
            {
                "field": "timeout_seconds",
                "minimum": MIN_TIMEOUT_SECONDS,
                "maximum": MAX_TIMEOUT_SECONDS,
            },
        )
    return value


def boolean(value: Any, field: str, default: bool = False) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ToolError(
            "validation",
            f"`{field}` must be a boolean.",
            {"field": field},
        )
    return value


def prompt(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ToolError(
            "validation",
            "`prompt` must be a non-empty string.",
            {"field": "prompt"},
        )
    normalized = value.strip()
    if "\x00" in normalized or len(normalized) > MAX_MIDJOURNEY_PROMPT_CHARS:
        raise ToolError(
            "validation",
            f"`prompt` must be {MAX_MIDJOURNEY_PROMPT_CHARS} characters or fewer and contain no NUL bytes.",
            {"field": "prompt", "max_chars": MAX_MIDJOURNEY_PROMPT_CHARS},
        )
    return normalized


def request_id(value: Any) -> str:
    if not isinstance(value, str) or not REQUEST_ID_PATTERN.fullmatch(value):
        raise ToolError(
            "validation",
            "`request_id` must be 8-128 safe identifier characters.",
            {"field": "request_id"},
        )
    return value


def aspect_ratio(value: Any, prompt_value: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not ASPECT_RATIO_PATTERN.fullmatch(value):
        raise ToolError(
            "validation",
            "`aspect_ratio` must use N:N with each value between 1 and 99.",
            {"field": "aspect_ratio"},
        )
    if ASPECT_PARAMETER_PATTERN.search(prompt_value):
        raise ToolError(
            "validation",
            "Do not provide `aspect_ratio` when the prompt already contains --ar or --aspect.",
            {"field": "aspect_ratio"},
        )
    return value


def job_id(value: Any) -> str:
    if not isinstance(value, str) or not JOB_ID_PATTERN.fullmatch(value.lower()):
        raise ToolError(
            "validation",
            "`job_id` must be a Midjourney UUID.",
            {"field": "job_id"},
        )
    return value.lower()


def indexes(value: Any) -> tuple[int, ...]:
    if value is None:
        return (0, 1, 2, 3)
    if not isinstance(value, list) or not value or len(value) > 4:
        raise ToolError(
            "validation",
            "`indexes` must contain 1-4 variation indexes.",
            {"field": "indexes", "allowed": [0, 1, 2, 3]},
        )
    if any(isinstance(item, bool) or not isinstance(item, int) for item in value):
        raise ToolError(
            "validation",
            "`indexes` entries must be integers.",
            {"field": "indexes", "allowed": [0, 1, 2, 3]},
        )
    normalized = tuple(value)
    if len(set(normalized)) != len(normalized) or any(item < 0 or item > 3 for item in normalized):
        raise ToolError(
            "validation",
            "`indexes` must be unique values from 0 through 3.",
            {"field": "indexes", "allowed": [0, 1, 2, 3]},
        )
    return normalized


def fingerprint(prompt_value: str) -> str:
    return hashlib.sha256(prompt_value.encode("utf-8")).hexdigest()


def source_url(job_id_value: str, index: int) -> str:
    return f"{MIDJOURNEY_ORIGIN}/jobs/{job_id_value}?index={index}"


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def file_digest(path: Path) -> tuple[int, str, str]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ToolError(
            "download_failed",
            "Could not open an exported Midjourney image safely.",
            {"file_name": path.name},
        ) from exc

    size = 0
    digest = hashlib.sha256()
    prefix = b""
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ToolError("download_failed", "Exported Midjourney asset is not a regular file.")
        if metadata.st_size <= 0 or metadata.st_size > MAX_DOWNLOAD_BYTES:
            raise ToolError(
                "download_failed",
                "Exported Midjourney image has an invalid size.",
                {"size_bytes": metadata.st_size, "max_bytes": MAX_DOWNLOAD_BYTES},
            )
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            if len(prefix) < 16:
                prefix += chunk[: 16 - len(prefix)]
            size += len(chunk)
            if size > MAX_DOWNLOAD_BYTES:
                raise ToolError(
                    "download_failed",
                    "Exported Midjourney image exceeds the size limit.",
                    {"max_bytes": MAX_DOWNLOAD_BYTES},
                )
            digest.update(chunk)
    finally:
        os.close(descriptor)
    return size, digest.hexdigest(), detect_image_format(prefix)


def validate_artifacts(
    artifacts: Any,
    *,
    job_id_value: str,
    indexes_value: tuple[int, ...],
    output_root: Path,
) -> list[dict[str, Any]]:
    if not isinstance(artifacts, list) or len(artifacts) != len(indexes_value):
        raise ToolError(
            "download_failed",
            "Midjourney export returned an unexpected artifact count.",
        )
    expected_keys = {
        "file_name",
        "index",
        "local_path",
        "media_type",
        "sha256",
        "size_bytes",
        "source_url",
    }
    normalized: list[dict[str, Any]] = []
    seen: set[int] = set()
    root = output_root.resolve()
    for artifact, expected_index in zip(artifacts, indexes_value, strict=True):
        if not isinstance(artifact, dict) or set(artifact) != expected_keys:
            raise ToolError("download_failed", "Midjourney export returned invalid artifact metadata.")
        if artifact["index"] != expected_index or expected_index in seen:
            raise ToolError("download_failed", "Midjourney export returned mismatched variation indexes.")
        seen.add(expected_index)
        if artifact["source_url"] != source_url(job_id_value, expected_index):
            raise ToolError("download_failed", "Midjourney export returned an invalid source URL.")
        if not isinstance(artifact["local_path"], str) or not isinstance(artifact["file_name"], str):
            raise ToolError("download_failed", "Midjourney export returned an invalid local path.")
        raw_path = Path(artifact["local_path"]).expanduser()
        if raw_path.is_symlink():
            raise ToolError("download_failed", "Midjourney export returned a symbolic link.")
        try:
            path = raw_path.resolve(strict=True)
        except OSError as exc:
            raise ToolError("download_failed", "Midjourney export file is missing.") from exc
        if not _inside(path, root) or path.name != artifact["file_name"]:
            raise ToolError("download_failed", "Midjourney export escaped the output boundary.")
        size, digest, image_format = file_digest(path)
        media_type = IMAGE_MEDIA_TYPES.get(image_format)
        if (
            media_type is None
            or artifact["media_type"] != media_type
            or artifact["size_bytes"] != size
            or artifact["sha256"] != digest
        ):
            raise ToolError("download_failed", "Midjourney export metadata did not match the image file.")
        normalized.append(
            {
                "index": expected_index,
                "file_name": path.name,
                "local_path": str(path),
                "media_type": media_type,
                "sha256": digest,
                "size_bytes": size,
                "source_url": source_url(job_id_value, expected_index),
            }
        )
    return normalized


class JsonRequestStore:
    """Atomic local idempotency records; browser session state stays separate."""

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            self.root.chmod(0o700)
        except OSError:
            pass

    def _path(self, request_id_value: str) -> Path:
        name = hashlib.sha256(request_id_value.encode("utf-8")).hexdigest()
        return self.root / f"{name}.json"

    def load(self, request_id_value: str) -> dict[str, Any] | None:
        path = self._path(request_id_value)
        if not path.exists():
            return None
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ToolError("internal_error", "Midjourney idempotency record is invalid.")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ToolError("internal_error", "Could not read the Midjourney idempotency record.") from exc
        if not isinstance(value, dict) or value.get("request_id") != request_id_value:
            raise ToolError("internal_error", "Midjourney idempotency record failed validation.")
        return value

    def create_pending(self, *, request_id: str, fingerprint: str) -> bool:
        record = {
            "schema_version": 1,
            "request_id": request_id,
            "fingerprint": fingerprint,
            "status": "pending",
            "created_at": int(time.time()),
        }
        path = self._path(request_id)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return False
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as file:
                json.dump(record, file, separators=(",", ":"), sort_keys=True)
                file.flush()
                os.fsync(file.fileno())
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return True

    def update(self, request_id_value: str, record: dict[str, Any]) -> None:
        path = self._path(request_id_value)
        if not path.exists():
            raise ToolError("internal_error", "Midjourney idempotency record is missing.")
        temporary = self.root / f".{path.name}.{uuid.uuid4().hex}.tmp"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as file:
                json.dump(record, file, separators=(",", ":"), sort_keys=True)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
