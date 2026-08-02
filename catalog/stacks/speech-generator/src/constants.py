"""Shared speech-generator limits and provider identifiers."""

from __future__ import annotations

from pathlib import Path


PROVIDERS = ("openai", "elevenlabs", "gemini")
SECRET_ENV_BY_PROVIDER = {
    "openai": "OPENAI_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
    "gemini": "GEMINI_API_KEY",
}

MAX_TEXT_CHARS = 4_096
MAX_INSTRUCTIONS_CHARS = 2_000
MAX_VOICE_CHARS = 200
MAX_MODEL_CHARS = 200
MAX_LANGUAGE_CODE_CHARS = 35
MAX_PROVIDER_RESPONSE_BYTES = 50 * 1024 * 1024
PROVIDER_TIMEOUT_SECONDS = 120

DEFAULT_OUTPUT_DIR = Path.home() / ".rudi" / "outputs" / "speech-generator"
