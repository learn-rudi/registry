"""Shared constants for the video-generator stack."""

from __future__ import annotations

from pathlib import Path


DEFAULT_OUTPUT_DIR = (Path.home() / ".rudi" / "outputs").resolve()

MAX_PROMPT_CHARS = 4000
MAX_REFERENCE_COUNT = 3
MAX_REFERENCE_BYTES = 20 * 1024 * 1024
MAX_SOURCE_VIDEO_BYTES = 300 * 1024 * 1024

PROVIDER_CALL_TIMEOUT_SECONDS = 60
JOB_TIMEOUT_SECONDS = 420
POLL_INTERVAL_SECONDS = 10

DEFAULT_OUTPUT_EXTENSION = "mp4"
VIDEO_SUFFIXES = {".mp4", ".webm"}
REFERENCE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

VIDEO_INPUT_MODES: dict[str, str] = {
    "text": "Prompt-only text-to-video.",
    "image": "First-frame image-to-video.",
    "interpolate": "First-frame plus last-frame image interpolation.",
    "references": "Reference images for subject, style, or composition guidance.",
    "extend": "Extend a source video; provider provenance metadata may be required.",
}

VIDEO_SIGNATURES = (
    (b"\x1a\x45\xdf\xa3", "webm"),
)

IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"RIFF", "webp"),
)

VIDEO_FORMATS: dict[str, dict[str, str]] = {
    "story": {
        "aspect_ratio": "9:16",
        "description": "Short-form vertical video.",
    },
    "landscape": {
        "aspect_ratio": "16:9",
        "description": "Widescreen video.",
    },
}

ALLOWED_DURATIONS_SECONDS = (4, 5, 6, 8, 10, 12)

SECRET_ENV_BY_PROVIDER: dict[str, str] = {
    "gemini": "GEMINI_API_KEY",
    "replicate": "REPLICATE_API_TOKEN",
    "fal": "FAL_KEY",
    "openai": "OPENAI_API_KEY",
}

MODEL_ENV_BY_PROVIDER: dict[str, str] = {
    "gemini": "VIDEO_GENERATOR_GEMINI_MODEL",
    "replicate": "VIDEO_GENERATOR_REPLICATE_MODEL",
    "fal": "VIDEO_GENERATOR_FAL_MODEL",
    "openai": "VIDEO_GENERATOR_OPENAI_MODEL",
}
