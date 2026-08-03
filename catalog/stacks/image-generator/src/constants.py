"""Shared constants for image-generator tool behavior."""

from __future__ import annotations

from pathlib import Path


DEFAULT_OUTPUT_DIR = (Path.home() / ".rudi" / "outputs").resolve()
MAX_PROMPT_CHARS = 20_000
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_REFERENCE_COUNT = 16
MAX_COMPARE_SPECS = 8
TIMEOUT_SECONDS = 120
REFERENCE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"RIFF", "webp"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)

SECRET_BY_PROVIDER = {
    "gemini": "GEMINI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "replicate": "REPLICATE_API_TOKEN",
}

MODEL_ENV_BY_PROVIDER = {
    "gemini": {
        "sketch": "GEMINI_MODEL_SKETCH",
        "photoreal": "GEMINI_MODEL_PHOTOREAL",
    },
    "openai": {
        "sketch": "OPENAI_MODEL_SKETCH",
        "photoreal": "OPENAI_MODEL_PHOTOREAL",
        "edit": "OPENAI_MODEL_EDIT",
    },
    "replicate": {
        "sketch": "REPLICATE_MODEL_SKETCH",
        "photoreal": "REPLICATE_MODEL_PHOTOREAL",
        "edit": "REPLICATE_MODEL_EDIT",
    },
}
