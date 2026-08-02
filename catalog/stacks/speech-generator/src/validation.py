"""Boundary validation for speech-generator tool calls."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from constants import (
    MAX_INSTRUCTIONS_CHARS,
    MAX_LANGUAGE_CODE_CHARS,
    MAX_MODEL_CHARS,
    MAX_TEXT_CHARS,
    MAX_VOICE_CHARS,
    PROVIDERS,
)
from errors import ToolError
from model_config import MODEL_CONFIG
from outputs import output_path


GENERATE_FIELDS = {
    "provider",
    "text",
    "model",
    "voice",
    "format",
    "instructions",
    "speed",
    "language_code",
    "out_path",
}
LIST_VOICE_FIELDS = {"provider", "page_size", "next_page_token", "search"}


@dataclass(frozen=True)
class SpeechRequest:
    provider: str
    text: str
    model: str
    voice: str
    audio_format: str
    instructions: str | None
    speed: float | None
    language_code: str | None
    out_path: Path


def _require_exact_fields(args: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(args) - allowed)
    if unknown:
        raise ToolError(
            "validation",
            f"Unknown field(s): {', '.join(unknown)}.",
            {"fields": unknown, "allowed": sorted(allowed)},
        )


def _require_string(args: dict[str, Any], name: str, max_chars: int) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ToolError("validation", f"`{name}` must be a non-empty string.", {"field": name})
    value = value.strip()
    if len(value) > max_chars:
        raise ToolError(
            "validation",
            f"`{name}` must be {max_chars} characters or fewer.",
            {"field": name, "max_chars": max_chars},
        )
    return value


def _optional_string(args: dict[str, Any], name: str, max_chars: int) -> str | None:
    value = args.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ToolError(
            "validation",
            f"`{name}` must be a non-empty string when provided.",
            {"field": name},
        )
    value = value.strip()
    if len(value) > max_chars:
        raise ToolError(
            "validation",
            f"`{name}` must be {max_chars} characters or fewer.",
            {"field": name, "max_chars": max_chars},
        )
    return value


def validate_generate_args(args: dict[str, Any]) -> SpeechRequest:
    _require_exact_fields(args, GENERATE_FIELDS)
    provider = _require_string(args, "provider", 40).lower()
    if provider not in PROVIDERS:
        raise ToolError(
            "validation",
            f"Unknown provider `{provider}`.",
            {"field": "provider", "allowed": list(PROVIDERS)},
        )
    text = _require_string(args, "text", MAX_TEXT_CHARS)
    config = MODEL_CONFIG[provider]
    model = _optional_string(args, "model", MAX_MODEL_CHARS) or config["default_model"]
    model_config = config["models"].get(model)
    if model_config is None:
        raise ToolError(
            "unsupported_combo",
            f"Model `{model}` is not supported for {provider} speech generation.",
            {"provider": provider, "model": model, "allowed": sorted(config["models"])},
        )
    voice = _optional_string(args, "voice", MAX_VOICE_CHARS) or config["default_voice"]
    if not voice:
        raise ToolError(
            "validation",
            "`voice` is required for ElevenLabs. Call `list_speech_voices` to discover voice IDs.",
            {"field": "voice", "provider": provider},
        )
    allowed_voices = model_config.get("voices")
    if allowed_voices and voice not in allowed_voices:
        raise ToolError(
            "unsupported_combo",
            f"Voice `{voice}` is not supported by `{model}`.",
            {"provider": provider, "model": model, "voice": voice},
        )
    audio_format = _optional_string(args, "format", 20) or config["default_format"]
    if audio_format not in model_config["formats"]:
        raise ToolError(
            "unsupported_combo",
            f"Format `{audio_format}` is not supported by {provider}:{model}.",
            {
                "provider": provider,
                "model": model,
                "format": audio_format,
                "allowed": list(model_config["formats"]),
            },
        )
    instructions = _optional_string(args, "instructions", MAX_INSTRUCTIONS_CHARS)
    if instructions and not model_config["supports_instructions"]:
        raise ToolError(
            "unsupported_combo",
            f"`instructions` is not supported by {provider}:{model}.",
            {"provider": provider, "model": model, "field": "instructions"},
        )
    speed_value = args.get("speed")
    speed: float | None = None
    if speed_value is not None:
        if isinstance(speed_value, bool) or not isinstance(speed_value, (int, float)):
            raise ToolError("validation", "`speed` must be a number.", {"field": "speed"})
        speed = float(speed_value)
        speed_range = model_config.get("speed_range")
        if speed_range is None:
            raise ToolError(
                "unsupported_combo",
                f"`speed` is not supported by {provider}:{model}; use `instructions` for pacing.",
                {"provider": provider, "model": model, "field": "speed"},
            )
        if not speed_range[0] <= speed <= speed_range[1]:
            raise ToolError(
                "validation",
                f"`speed` must be between {speed_range[0]} and {speed_range[1]} for {provider}.",
                {"field": "speed", "minimum": speed_range[0], "maximum": speed_range[1]},
            )
    language_code = _optional_string(args, "language_code", MAX_LANGUAGE_CODE_CHARS)
    if language_code and provider != "elevenlabs":
        raise ToolError(
            "unsupported_combo",
            "`language_code` is currently supported only for ElevenLabs.",
            {"provider": provider, "field": "language_code"},
        )
    path = output_path(_optional_string(args, "out_path", 4_096), audio_format)
    return SpeechRequest(
        provider=provider,
        text=text,
        model=model,
        voice=voice,
        audio_format=audio_format,
        instructions=instructions,
        speed=speed,
        language_code=language_code,
        out_path=path,
    )


def validate_voice_list_args(args: dict[str, Any]) -> tuple[str, int, str | None, str | None]:
    _require_exact_fields(args, LIST_VOICE_FIELDS)
    provider = _require_string(args, "provider", 40).lower()
    if provider not in PROVIDERS:
        raise ToolError(
            "validation",
            f"Unknown provider `{provider}`.",
            {"field": "provider", "allowed": list(PROVIDERS)},
        )
    page_size_value = args.get("page_size", 50)
    if isinstance(page_size_value, bool) or not isinstance(page_size_value, int):
        raise ToolError("validation", "`page_size` must be an integer.", {"field": "page_size"})
    if not 1 <= page_size_value <= 100:
        raise ToolError(
            "validation",
            "`page_size` must be between 1 and 100.",
            {"field": "page_size", "minimum": 1, "maximum": 100},
        )
    next_page_token = _optional_string(args, "next_page_token", 2_000)
    search = _optional_string(args, "search", 200)
    if provider != "elevenlabs" and next_page_token:
        raise ToolError(
            "unsupported_combo",
            "`next_page_token` is used only for ElevenLabs remote voice discovery.",
            {"provider": provider, "field": "next_page_token"},
        )
    return provider, page_size_value, next_page_token, search
