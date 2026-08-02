"""Speech-generator operations."""

from __future__ import annotations

from time import perf_counter
from typing import Any

from constants import PROVIDERS
from errors import ToolError, ok_result
from model_config import GEMINI_VOICES, OPENAI_ALL_VOICES
from model_registry import list_speech_models as _list_speech_models
from outputs import safe_write_audio
from provider_runtime import generate_with_provider, list_remote_voices, require_secret
from validation import validate_generate_args, validate_voice_list_args


def list_speech_models(args: dict[str, Any]) -> dict[str, Any]:
    provider = args.get("provider")
    if provider is not None and provider not in PROVIDERS:
        raise ToolError(
            "validation",
            f"Unknown provider: {provider}",
            {"field": "provider", "allowed": list(PROVIDERS)},
        )
    return _list_speech_models(provider)


async def list_speech_voices(args: dict[str, Any]) -> dict[str, Any]:
    provider, page_size, next_page_token, search = validate_voice_list_args(args)
    if provider == "openai":
        voices = [
            {"id": voice, "name": voice, "description": "Built-in OpenAI speech voice."}
            for voice in OPENAI_ALL_VOICES
        ]
    elif provider == "gemini":
        voices = [
            {"id": voice, "name": voice, "description": description}
            for voice, description in GEMINI_VOICES.items()
        ]
    else:
        secret = require_secret(provider)
        page = await list_remote_voices(
            secret,
            page_size=page_size,
            next_page_token=next_page_token,
            search=search,
        )
        return ok_result(provider=provider, source="remote", **page)
    if search:
        lowered = search.casefold()
        voices = [
            voice
            for voice in voices
            if lowered in voice["name"].casefold() or lowered in voice["description"].casefold()
        ]
    return ok_result(
        provider=provider,
        source="static",
        voices=voices[:page_size],
        has_more=len(voices) > page_size,
        next_page_token=None,
    )


async def generate_speech(args: dict[str, Any]) -> dict[str, Any]:
    request = validate_generate_args(args)
    secret = require_secret(request.provider)
    started = perf_counter()
    provider_audio = await generate_with_provider(request, secret)
    safe_write_audio(
        request.out_path,
        provider_audio.audio_bytes,
        request.audio_format,
        request.provider,
    )
    return ok_result(
        out_path=str(request.out_path),
        provider=request.provider,
        model=request.model,
        voice=request.voice,
        format=request.audio_format,
        bytes=len(provider_audio.audio_bytes),
        ms=round((perf_counter() - started) * 1000),
        provider_request_id=provider_audio.request_id,
        ai_generated=True,
        disclosure_policy="context_dependent",
        disclosure_review_required=True,
    )
