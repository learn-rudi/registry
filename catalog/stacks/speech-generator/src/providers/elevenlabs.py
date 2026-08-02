"""ElevenLabs Text to Speech API adapter."""

from __future__ import annotations

import json
from typing import Callable
from urllib.parse import quote, urlencode

from constants import PROVIDER_TIMEOUT_SECONDS
from errors import ToolError
from http_client import HttpResponse, http_request
from model_config import MODEL_CONFIG
from provider_types import ProviderAudio
from validation import SpeechRequest


RequestFunction = Callable[..., HttpResponse]


def _optional_text(value: object, max_chars: int = 1_000) -> str | None:
    return value[:max_chars] if isinstance(value, str) else None


def _safe_labels(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    labels: dict[str, str] = {}
    for key, item in list(value.items())[:50]:
        if isinstance(key, str) and isinstance(item, str):
            labels[key[:100]] = item[:200]
    return labels


def list_voices(
    secret: str,
    *,
    page_size: int,
    next_page_token: str | None,
    search: str | None,
    request_fn: RequestFunction | None = None,
) -> dict[str, object]:
    transport = request_fn or http_request
    query_values: dict[str, object] = {
        "page_size": page_size,
        "include_total_count": "true",
    }
    if next_page_token:
        query_values["next_page_token"] = next_page_token
    if search:
        query_values["search"] = search
    response = transport(
        method="GET",
        url=f"https://api.elevenlabs.io/v2/voices?{urlencode(query_values)}",
        headers={"xi-api-key": secret},
        payload=None,
        timeout=PROVIDER_TIMEOUT_SECONDS,
    )
    try:
        payload = json.loads(response.body.decode("utf-8"))
        raw_voices = payload["voices"]
        if not isinstance(raw_voices, list):
            raise TypeError("voices is not a list")
        voices: list[dict[str, object]] = []
        for raw_voice in raw_voices[:100]:
            if not isinstance(raw_voice, dict):
                raise TypeError("voice is not an object")
            voice_id = raw_voice.get("voice_id")
            name = raw_voice.get("name")
            if not isinstance(voice_id, str) or not voice_id or not isinstance(name, str) or not name:
                raise TypeError("voice id or name is invalid")
            reported_is_owner = raw_voice.get("is_owner")
            voices.append(
                {
                    "id": voice_id[:200],
                    "name": name[:500],
                    "description": _optional_text(raw_voice.get("description")),
                    "category": _optional_text(raw_voice.get("category"), 100),
                    "labels": _safe_labels(raw_voice.get("labels")),
                    "provider_reported_is_owner": (
                        reported_is_owner if isinstance(reported_is_owner, bool) else None
                    ),
                }
            )
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ToolError(
            "provider_error",
            "ElevenLabs returned an invalid voice inventory response.",
            {"provider": "elevenlabs"},
        ) from exc

    has_more = payload.get("has_more") is True
    token = payload.get("next_page_token")
    total_count = payload.get("total_count")
    return {
        "voices": voices,
        "has_more": has_more,
        "next_page_token": token if isinstance(token, str) else None,
        "total_count": total_count if isinstance(total_count, int) else None,
    }


def generate(
    request: SpeechRequest,
    secret: str,
    *,
    request_fn: RequestFunction | None = None,
) -> ProviderAudio:
    transport = request_fn or http_request
    output_format = MODEL_CONFIG["elevenlabs"]["format_ids"][request.audio_format]
    query = urlencode({"output_format": output_format})
    voice_id = quote(request.voice, safe="")
    payload: dict[str, object] = {
        "text": request.text,
        "model_id": request.model,
    }
    if request.language_code:
        payload["language_code"] = request.language_code
    if request.speed is not None:
        payload["voice_settings"] = {"speed": request.speed}

    response = transport(
        method="POST",
        url=f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?{query}",
        headers={
            "xi-api-key": secret,
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=PROVIDER_TIMEOUT_SECONDS,
    )
    return ProviderAudio(
        audio_bytes=response.body,
        request_id=response.headers.get("request-id") or response.headers.get("x-request-id"),
    )
