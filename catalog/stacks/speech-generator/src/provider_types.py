"""Shared values returned by speech provider adapters."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderAudio:
    audio_bytes: bytes
    request_id: str | None = None
