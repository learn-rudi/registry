"""Provider model discovery without remote API calls."""

from __future__ import annotations

import os
from typing import Any

from constants import PROVIDERS, PROVIDER_TIMEOUT_SECONDS, SECRET_ENV_BY_PROVIDER
from model_config import MODEL_CONFIG


def secret_status(provider: str) -> dict[str, Any]:
    env_name = SECRET_ENV_BY_PROVIDER[provider]
    return {
        "env": env_name,
        "configured": bool(os.environ.get(env_name)),
        "required_for_generation": True,
    }


def provider_metadata(provider: str) -> dict[str, Any]:
    config = MODEL_CONFIG[provider]
    return {
        **config,
        "secret": SECRET_ENV_BY_PROVIDER[provider],
        "secret_status": secret_status(provider),
    }


def list_speech_models(provider: str | None = None) -> dict[str, Any]:
    selected = (provider,) if provider else PROVIDERS
    return {
        "ok": True,
        "max_text_chars": 4_096,
        "timeout_seconds": PROVIDER_TIMEOUT_SECONDS,
        "providers": {
            provider_id: provider_metadata(provider_id)
            for provider_id in selected
        },
    }
