"""Structured error helpers for speech-generator MCP tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolError(Exception):
    error_kind: str
    message: str
    details: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_result(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "ok": False,
            "error_kind": self.error_kind,
            "message": self.message,
        }
        if self.details:
            result.update(self.details)
        return result


def ok_result(**values: Any) -> dict[str, Any]:
    return {"ok": True, **values}


def error_result(error_kind: str, message: str, **details: Any) -> dict[str, Any]:
    return {"ok": False, "error_kind": error_kind, "message": message, **details}
