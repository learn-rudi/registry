#!/usr/bin/env python3
"""Speech Generator MCP server."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from constants import (
    MAX_INSTRUCTIONS_CHARS,
    MAX_TEXT_CHARS,
    PROVIDERS,
    PROVIDER_TIMEOUT_SECONDS,
    SECRET_ENV_BY_PROVIDER,
)
from errors import ToolError, error_result
from tools import generate_speech, list_speech_models, list_speech_voices


server = Server("speech-generator")


def _safe_exception_detail(exc: Exception) -> str:
    detail = str(exc) or type(exc).__name__
    for name in SECRET_ENV_BY_PROVIDER.values():
        value = os.environ.get(name)
        if value and len(value) >= 8:
            detail = detail.replace(value, "[redacted]")
    return detail[:2_000]


def _json_content(result: dict[str, Any]) -> list[types.TextContent]:
    return [
        types.TextContent(
            type="text",
            text=json.dumps(result, indent=2, sort_keys=False),
        )
    ]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="list_speech_models",
            description=(
                "Return speech provider models, built-in capability rules, and credential readiness "
                "without making provider API calls."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": list(PROVIDERS),
                        "description": "Optional provider filter.",
                    }
                },
            },
        ),
        types.Tool(
            name="list_speech_voices",
            description=(
                "List built-in OpenAI or Gemini voices locally, or list the authenticated "
                "ElevenLabs voice inventory with pagination."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": list(PROVIDERS),
                        "description": "Provider whose voices should be listed.",
                    },
                    "page_size": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Maximum voices to return; defaults to 50.",
                    },
                    "next_page_token": {
                        "type": "string",
                        "description": "ElevenLabs continuation token from a previous response.",
                    },
                    "search": {
                        "type": "string",
                        "description": "Optional provider voice name/description search text.",
                    },
                },
                "required": ["provider"],
            },
        ),
        types.Tool(
            name="generate_speech",
            description=(
                "Generate one AI speech audio file with OpenAI, ElevenLabs, or Gemini. "
                f"Text is limited to {MAX_TEXT_CHARS} characters and provider calls time out "
                f"after {PROVIDER_TIMEOUT_SECONDS} seconds. Outputs are written only beneath "
                "~/.rudi/outputs/speech-generator and are never overwritten. The caller must "
                "establish voice-use authorization before generation; it is not verified by "
                "this stack."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": list(PROVIDERS),
                        "description": "Provider to use: openai, elevenlabs, or gemini.",
                    },
                    "text": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_TEXT_CHARS,
                        "description": "Literal text to synthesize. File paths are not read.",
                    },
                    "model": {
                        "type": "string",
                        "description": "Optional provider model id; defaults are discoverable with list_speech_models.",
                    },
                    "voice": {
                        "type": "string",
                        "description": "Voice name or ID. Required for ElevenLabs; provider defaults apply otherwise.",
                    },
                    "format": {
                        "type": "string",
                        "enum": ["mp3", "wav", "opus", "aac", "flac", "pcm"],
                        "description": "Audio format. Supported combinations vary by provider/model.",
                    },
                    "instructions": {
                        "type": "string",
                        "maxLength": MAX_INSTRUCTIONS_CHARS,
                        "description": "Natural-language delivery direction for compatible OpenAI and Gemini models.",
                    },
                    "speed": {
                        "type": "number",
                        "description": "Speech-speed multiplier for compatible OpenAI and ElevenLabs models.",
                    },
                    "language_code": {
                        "type": "string",
                        "description": "Optional ISO language code for compatible ElevenLabs models.",
                    },
                    "out_path": {
                        "type": "string",
                        "description": "Optional non-existing output path beneath ~/.rudi/outputs/speech-generator.",
                    },
                },
                "required": ["provider", "text"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> list[types.TextContent]:
    args = arguments or {}
    try:
        if name == "list_speech_models":
            return _json_content(list_speech_models(args))
        if name == "list_speech_voices":
            return _json_content(await list_speech_voices(args))
        if name == "generate_speech":
            return _json_content(await generate_speech(args))
        return _json_content(error_result("unknown_tool", f"Unknown tool: {name}"))
    except ToolError as exc:
        return _json_content(exc.to_result())
    except Exception as exc:
        return _json_content(
            error_result(
                "internal_error",
                "Speech generator failed unexpectedly.",
                exception_type=type(exc).__name__,
                detail=_safe_exception_detail(exc),
            )
        )


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
