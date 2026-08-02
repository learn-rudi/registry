"""OpenAI Speech API adapter."""

from __future__ import annotations

from typing import Callable

from constants import PROVIDER_TIMEOUT_SECONDS
from http_client import HttpResponse, http_request
from provider_types import ProviderAudio
from validation import SpeechRequest


RequestFunction = Callable[..., HttpResponse]


def generate(
    request: SpeechRequest,
    secret: str,
    *,
    request_fn: RequestFunction | None = None,
) -> ProviderAudio:
    transport = request_fn or http_request
    payload: dict[str, object] = {
        "model": request.model,
        "input": request.text,
        "voice": request.voice,
        "response_format": request.audio_format,
    }
    if request.instructions:
        payload["instructions"] = request.instructions
    if request.speed is not None:
        payload["speed"] = request.speed

    response = transport(
        method="POST",
        url="https://api.openai.com/v1/audio/speech",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=PROVIDER_TIMEOUT_SECONDS,
    )
    return ProviderAudio(
        audio_bytes=response.body,
        request_id=response.headers.get("x-request-id"),
    )
