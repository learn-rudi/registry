"""Gemini text-to-speech adapter using the Interactions API."""

from __future__ import annotations

import base64
import binascii
import json
import wave
from io import BytesIO
from typing import Callable

from constants import MAX_PROVIDER_RESPONSE_BYTES, PROVIDER_TIMEOUT_SECONDS
from errors import ToolError
from http_client import HttpResponse, http_request
from provider_types import ProviderAudio
from validation import SpeechRequest


RequestFunction = Callable[..., HttpResponse]


def _prompt(request: SpeechRequest) -> str:
    if request.instructions:
        return (
            "Synthesize speech using the delivery instructions below. "
            "Read only the transcript; do not read the delivery instructions aloud.\n\n"
            f"Delivery instructions:\n{request.instructions}\n\n"
            f"Transcript:\n{request.text}"
        )
    return (
        "Synthesize the following transcript as spoken audio. "
        "Read only the transcript.\n\n"
        f"Transcript:\n{request.text}"
    )


def _pcm_to_wav(pcm_bytes: bytes) -> bytes:
    if not pcm_bytes or len(pcm_bytes) % 2 != 0 or len(pcm_bytes) > MAX_PROVIDER_RESPONSE_BYTES:
        raise ToolError(
            "invalid_audio",
            "Gemini returned invalid 24 kHz, 16-bit PCM audio.",
            {"provider": "gemini", "bytes": len(pcm_bytes)},
        )
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24_000)
        wav_file.writeframes(pcm_bytes)
    return output.getvalue()


def _extract_pcm_data(payload: object) -> str:
    """Return the final inline L16 audio block from a raw Interaction response."""
    if not isinstance(payload, dict):
        raise TypeError("interaction response is not an object")
    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise TypeError("interaction steps are not a list")

    for step in reversed(steps):
        if not isinstance(step, dict) or step.get("type") != "model_output":
            continue
        content = step.get("content")
        if not isinstance(content, list):
            continue
        for block in reversed(content):
            if not isinstance(block, dict) or block.get("type") != "audio":
                continue
            encoded_audio = block.get("data")
            if not isinstance(encoded_audio, str):
                raise TypeError("audio data is not a string")
            if block.get("mime_type") not in (None, "audio/l16"):
                raise TypeError("audio MIME type is not L16 PCM")
            if block.get("sample_rate") not in (None, 24_000):
                raise TypeError("audio sample rate is not 24 kHz")
            if block.get("channels") not in (None, 1):
                raise TypeError("audio is not mono")
            return encoded_audio

    raise KeyError("interaction response has no inline audio block")


def generate(
    request: SpeechRequest,
    secret: str,
    *,
    request_fn: RequestFunction | None = None,
) -> ProviderAudio:
    transport = request_fn or http_request
    response = transport(
        method="POST",
        url="https://generativelanguage.googleapis.com/v1beta/interactions",
        headers={
            "x-goog-api-key": secret,
            "Content-Type": "application/json",
        },
        payload={
            "model": request.model,
            "input": _prompt(request),
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": request.voice}]},
        },
        timeout=PROVIDER_TIMEOUT_SECONDS,
    )
    try:
        payload = json.loads(response.body.decode("utf-8"))
        encoded_audio = _extract_pcm_data(payload)
        pcm_bytes = base64.b64decode(encoded_audio, validate=True)
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, binascii.Error) as exc:
        raise ToolError(
            "provider_error",
            "Gemini returned a response without valid output audio.",
            {"provider": "gemini"},
        ) from exc

    return ProviderAudio(
        audio_bytes=_pcm_to_wav(pcm_bytes),
        request_id=response.headers.get("x-goog-request-id") or response.headers.get("x-request-id"),
    )
