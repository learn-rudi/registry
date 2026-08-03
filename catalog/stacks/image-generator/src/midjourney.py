"""Public Midjourney adapter facade for the image-generator MCP server."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from constants import DEFAULT_OUTPUT_DIR
from midjourney_browser import PlaywrightMidjourneyDriver
from midjourney_contract import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_MIDJOURNEY_PROMPT_CHARS,
    MAX_TIMEOUT_SECONDS,
    MIN_TIMEOUT_SECONDS,
    JsonRequestStore,
)
from midjourney_service import MidjourneyService


def _default_state_root() -> Path:
    rudi_home = Path(os.environ.get("RUDI_HOME") or (Path.home() / ".rudi"))
    return rudi_home.expanduser().resolve() / "state" / "image-generator" / "midjourney"


_DEFAULT_SERVICE: MidjourneyService | None = None


def default_midjourney_service() -> MidjourneyService:
    global _DEFAULT_SERVICE
    if _DEFAULT_SERVICE is None:
        state_root = _default_state_root()
        _DEFAULT_SERVICE = MidjourneyService(
            driver=PlaywrightMidjourneyDriver(
                state_root=state_root,
                output_root=DEFAULT_OUTPUT_DIR,
            ),
            request_store=JsonRequestStore(state_root / "requests"),
            output_root=DEFAULT_OUTPUT_DIR,
        )
    return _DEFAULT_SERVICE


async def midjourney_session_status(args: dict[str, Any]) -> dict[str, Any]:
    return await default_midjourney_service().session_status(args)


async def midjourney_login(args: dict[str, Any]) -> dict[str, Any]:
    return await default_midjourney_service().login(args)


async def midjourney_generate(args: dict[str, Any]) -> dict[str, Any]:
    return await default_midjourney_service().generate(args)


async def midjourney_export_job(args: dict[str, Any]) -> dict[str, Any]:
    return await default_midjourney_service().export_job(args)


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "JsonRequestStore",
    "MAX_MIDJOURNEY_PROMPT_CHARS",
    "MAX_TIMEOUT_SECONDS",
    "MIN_TIMEOUT_SECONDS",
    "MidjourneyService",
    "PlaywrightMidjourneyDriver",
    "midjourney_export_job",
    "midjourney_generate",
    "midjourney_login",
    "midjourney_session_status",
]
