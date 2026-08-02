"""Provider credential and dispatch boundary for speech generation."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Callable

from constants import PROVIDER_TIMEOUT_SECONDS, SECRET_ENV_BY_PROVIDER
from errors import ToolError
from provider_types import ProviderAudio
from providers.elevenlabs import generate as generate_elevenlabs, list_voices as list_elevenlabs_voices
from providers.gemini import generate as generate_gemini
from providers.openai import generate as generate_openai
from validation import SpeechRequest


Adapter = Callable[[SpeechRequest, str], ProviderAudio]
ADAPTERS: dict[str, Adapter] = {
    "openai": generate_openai,
    "elevenlabs": generate_elevenlabs,
    "gemini": generate_gemini,
}


def require_secret(provider: str) -> str:
    secret_name = SECRET_ENV_BY_PROVIDER[provider]
    value = os.environ.get(secret_name)
    if not value:
        raise ToolError(
            "missing_secret",
            f"{secret_name} is not configured for {provider} speech generation.",
            {
                "provider": provider,
                "secret_name": secret_name,
                "remediation": f"Run `rudi secrets set {secret_name}` and restart the RUDI router.",
            },
        )
    return value


async def generate_with_provider(request: SpeechRequest, secret: str) -> ProviderAudio:
    adapter = ADAPTERS[request.provider]
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(adapter, request, secret),
            timeout=PROVIDER_TIMEOUT_SECONDS + 5,
        )
    except ToolError:
        raise
    except (asyncio.TimeoutError, TimeoutError) as exc:
        raise ToolError(
            "timeout",
            f"{request.provider} speech generation timed out.",
            {"provider": request.provider, "timeout_seconds": PROVIDER_TIMEOUT_SECONDS},
        ) from exc
    except Exception as exc:
        raise ToolError(
            "provider_error",
            f"{request.provider} speech generation failed unexpectedly.",
            {"provider": request.provider, "exception_type": type(exc).__name__},
        ) from exc


async def list_remote_voices(
    secret: str,
    *,
    page_size: int,
    next_page_token: str | None,
    search: str | None,
) -> dict[str, object]:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(
                list_elevenlabs_voices,
                secret,
                page_size=page_size,
                next_page_token=next_page_token,
                search=search,
            ),
            timeout=PROVIDER_TIMEOUT_SECONDS + 5,
        )
    except ToolError:
        raise
    except (asyncio.TimeoutError, TimeoutError) as exc:
        raise ToolError(
            "timeout",
            "ElevenLabs voice discovery timed out.",
            {"provider": "elevenlabs", "timeout_seconds": PROVIDER_TIMEOUT_SECONDS},
        ) from exc
    except Exception as exc:
        raise ToolError(
            "provider_error",
            "ElevenLabs voice discovery failed unexpectedly.",
            {"provider": "elevenlabs", "exception_type": type(exc).__name__},
        ) from exc
