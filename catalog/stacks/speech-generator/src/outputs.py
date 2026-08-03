"""Speech output path and audio byte validation."""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from constants import DEFAULT_OUTPUT_DIR, MAX_PROVIDER_RESPONSE_BYTES
from errors import ToolError


def _timestamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _nonce() -> str:
    return uuid.uuid4().hex[:8]


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def output_path(value: str | None, audio_format: str) -> Path:
    path = (
        Path(value).expanduser().resolve()
        if value
        else DEFAULT_OUTPUT_DIR / f"speech-{_timestamp()}-{_nonce()}.{audio_format}"
    ).resolve()
    output_root = DEFAULT_OUTPUT_DIR.resolve()
    if not _is_relative_to(path, output_root):
        raise ToolError(
            "validation",
            "`out_path` must be inside ~/.rudi/outputs/speech-generator.",
            {"field": "out_path", "path": str(path), "allowed_root": str(output_root)},
        )
    expected_suffix = f".{audio_format}"
    if path.suffix.lower() != expected_suffix:
        raise ToolError(
            "validation",
            f"`out_path` must end in {expected_suffix} when `format` is `{audio_format}`.",
            {"field": "out_path", "format": audio_format, "path": str(path)},
        )
    if path.exists():
        raise ToolError(
            "validation",
            f"Output path already exists: {path}",
            {"field": "out_path", "path": str(path)},
        )
    return path


def detect_audio_format(audio_bytes: bytes) -> str | None:
    if len(audio_bytes) >= 12 and audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        return "wav"
    if audio_bytes.startswith(b"ID3"):
        return "mp3"
    if len(audio_bytes) >= 2 and audio_bytes[0] == 0xFF and (audio_bytes[1] & 0xE0) == 0xE0:
        return "mp3"
    if audio_bytes.startswith(b"OggS"):
        return "opus"
    if audio_bytes.startswith(b"fLaC"):
        return "flac"
    return None


def validate_audio_bytes(audio_bytes: bytes, expected_format: str, provider: str) -> None:
    if not audio_bytes or len(audio_bytes) > MAX_PROVIDER_RESPONSE_BYTES:
        raise ToolError(
            "invalid_audio",
            f"{provider} returned an invalid audio payload size.",
            {
                "provider": provider,
                "bytes": len(audio_bytes),
                "max_bytes": MAX_PROVIDER_RESPONSE_BYTES,
            },
        )
    if expected_format in {"aac", "pcm"}:
        return
    detected = detect_audio_format(audio_bytes)
    if detected != expected_format:
        raise ToolError(
            "invalid_audio",
            f"{provider} returned bytes that do not match `{expected_format}` audio.",
            {"provider": provider, "expected_format": expected_format, "detected_format": detected},
        )


def safe_write_audio(path: Path, audio_bytes: bytes, audio_format: str, provider: str) -> None:
    validate_audio_bytes(audio_bytes, audio_format, provider)
    if path.exists():
        raise ToolError(
            "write_failed",
            f"Output path already exists: {path}",
            {"out_path": str(path)},
        )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio_bytes)
    except OSError as exc:
        raise ToolError(
            "write_failed",
            f"Could not write generated speech to {path}: {exc}",
            {"out_path": str(path)},
        ) from exc
