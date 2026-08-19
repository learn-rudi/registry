#!/usr/bin/env python3
"""Image Generator MCP Server."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from errors import ToolError, error_result
from midjourney import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_MIDJOURNEY_PROMPT_CHARS,
    MAX_TIMEOUT_SECONDS,
    MIN_TIMEOUT_SECONDS,
    midjourney_export_job,
    midjourney_generate,
    midjourney_login,
    midjourney_session_status,
)
from tools import (
    ASSET_FORMATS,
    MAX_COMPARE_SPECS,
    MAX_PROMPT_CHARS,
    MAX_REFERENCE_COUNT,
    compare_providers,
    generate_image,
    list_models,
)


server = Server("image-generator")
SECRET_ENV_NAMES = ("GEMINI_API_KEY", "OPENAI_API_KEY", "REPLICATE_API_TOKEN")


def safe_exception_detail(exc: Exception) -> str:
    detail = str(exc) or type(exc).__name__
    for name in SECRET_ENV_NAMES:
        value = os.environ.get(name)
        if value and len(value) >= 8:
            detail = detail.replace(value, "[redacted]")
    return detail[:2000]


def json_content(result: dict[str, Any]) -> list[types.TextContent]:
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
            name="generate_image",
            description=(
                "Generate one image with Gemini, OpenAI, or Replicate. "
                "Reference support is validated before dispatch. Provider "
                "calls have a 120 second timeout."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["gemini", "openai", "replicate"],
                        "description": "Provider to use.",
                    },
                    "prompt": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_PROMPT_CHARS,
                        "description": "Prompt text. File paths are treated as literal prompt text.",
                    },
                    "model": {
                        "type": "string",
                        "description": "Preset (sketch, photoreal, edit) or explicit model id. Defaults to photoreal.",
                    },
                    "format": {
                        "type": "string",
                        "enum": list(ASSET_FORMATS),
                        "description": "Content asset format. Defaults to square.",
                    },
                    "references": {
                        "type": "array",
                        "maxItems": MAX_REFERENCE_COUNT,
                        "items": {"type": "string"},
                        "description": "Optional local PNG, JPEG, or WebP reference image file paths.",
                    },
                    "out_path": {
                        "type": "string",
                        "description": "Optional output file path under ~/.rudi/outputs. Defaults to ~/.rudi/outputs/image-<ts>-<nonce>.<detected-format>.",
                    },
                },
                "required": ["provider", "prompt"],
            },
        ),
        types.Tool(
            name="compare_providers",
            description=(
                "Generate the same prompt across provider:model specs and "
                "write an HTML gallery. Per-spec failures are returned in "
                "results while the run continues. Provider calls have a 120 "
                "second timeout each."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "prompt": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_PROMPT_CHARS,
                        "description": "Prompt text. File paths are treated as literal prompt text.",
                    },
                    "specs": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": MAX_COMPARE_SPECS,
                        "items": {"type": "string"},
                        "description": "Provider/model specs such as gemini:sketch or replicate:flux-2.",
                    },
                    "format": {
                        "type": "string",
                        "enum": list(ASSET_FORMATS),
                        "description": "Content asset format applied to every spec. Defaults to square.",
                    },
                    "references": {
                        "type": "array",
                        "maxItems": MAX_REFERENCE_COUNT,
                        "items": {"type": "string"},
                        "description": "Optional local PNG, JPEG, or WebP reference image file paths.",
                    },
                    "out_dir": {
                        "type": "string",
                        "description": "Optional empty output directory under ~/.rudi/outputs. Defaults to ~/.rudi/outputs/compare-<ts>/.",
                    },
                },
                "required": ["prompt", "specs"],
            },
        ),
        types.Tool(
            name="list_models",
            description=(
                "Return static provider presets, default model ids, aliases, "
                "and reference-image support. Makes no provider API calls."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["gemini", "openai", "replicate"],
                        "description": "Optional provider filter.",
                    },
                },
            },
        ),
        types.Tool(
            name="midjourney_session_status",
            description=(
                "Check whether the dedicated RUDI Midjourney browser profile "
                "is authenticated. This performs a read-only Midjourney page check."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {},
            },
        ),
        types.Tool(
            name="midjourney_login",
            description=(
                "Open the dedicated RUDI Chromium profile and return as soon as the "
                "browser is ready. The user completes Midjourney sign-in, closes the "
                "window, and then calls midjourney_session_status. Credentials are "
                "entered by the user and are never returned through MCP."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "timeout_seconds": {
                        "type": "integer",
                        "minimum": MIN_TIMEOUT_SECONDS,
                        "maximum": MAX_TIMEOUT_SECONDS,
                        "default": DEFAULT_TIMEOUT_SECONDS,
                        "description": (
                            "Accepted for backward compatibility and validated, but "
                            "does not bound human sign-in because this tool returns "
                            "as soon as the browser is ready."
                        ),
                    },
                },
            },
        ),
        types.Tool(
            name="midjourney_generate",
            description=(
                "Submit one idempotent Midjourney browser generation and export "
                "all four variations to ~/.rudi/outputs. Requires prior login in "
                "the dedicated RUDI browser profile."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "request_id": {
                        "type": "string",
                        "minLength": 8,
                        "maxLength": 128,
                        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
                        "description": "Caller-provided idempotency key for this exact prompt request.",
                    },
                    "prompt": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_MIDJOURNEY_PROMPT_CHARS,
                    },
                    "aspect_ratio": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]?:[1-9][0-9]?$",
                        "description": "Optional Midjourney aspect ratio such as 16:9.",
                    },
                    "stylization": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 1000,
                        "description": "Midjourney artistic stylization (--stylize).",
                    },
                    "weirdness": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 3000,
                        "description": "Midjourney experimental weirdness (--weird).",
                    },
                    "variety": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                        "description": "Variation diversity, mapped to Midjourney --chaos.",
                    },
                    "model_version": {
                        "type": "string",
                        "pattern": "^[1-9][0-9]?(?:\\.[0-9]{1,2})?$",
                        "description": "Numeric Midjourney model version such as 8.2.",
                    },
                    "resolution": {
                        "type": "string",
                        "enum": ["sd", "hd"],
                        "description": "Generate at Midjourney standard or HD resolution.",
                    },
                    "raw": {
                        "type": "boolean",
                        "description": "Append Midjourney --raw when true.",
                    },
                    "speed": {
                        "type": "string",
                        "enum": ["fast", "relax", "turbo"],
                        "description": "Per-request Midjourney GPU speed override.",
                    },
                    "image_prompts": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "uniqueItems": True,
                        "items": {"type": "string", "minLength": 1, "maxLength": 4096},
                        "description": "Local PNG/JPEG/WebP paths for content and composition influence.",
                    },
                    "style_references": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "uniqueItems": True,
                        "items": {"type": "string", "minLength": 1, "maxLength": 4096},
                        "description": "Local PNG/JPEG/WebP paths for visual style influence.",
                    },
                    "omni_reference": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 4096,
                        "description": "One local PNG/JPEG/WebP path for likeness or object-form consistency.",
                    },
                    "image_weight": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 3,
                        "description": "Image Prompt influence (--iw); requires image_prompts.",
                    },
                    "style_weight": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1000,
                        "description": "Style Reference influence (--sw); requires style_references.",
                    },
                    "omni_weight": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 1000,
                        "description": "Omni Reference influence (--ow); requires omni_reference.",
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "minimum": MIN_TIMEOUT_SECONDS,
                        "maximum": MAX_TIMEOUT_SECONDS,
                        "default": DEFAULT_TIMEOUT_SECONDS,
                    },
                    "show_browser": {
                        "type": "boolean",
                        "default": True,
                        "description": "Show Chromium while the bounded workflow runs. Visible mode is the reliable Midjourney default.",
                    },
                },
                "required": ["request_id", "prompt"],
            },
        ),
        types.Tool(
            name="midjourney_export_job",
            description=(
                "Download selected variations from an existing Midjourney UUID "
                "job into a new bounded directory under ~/.rudi/outputs."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "job_id": {
                        "type": "string",
                        "format": "uuid",
                    },
                    "indexes": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "uniqueItems": True,
                        "items": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 3,
                        },
                        "default": [0, 1, 2, 3],
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "minimum": MIN_TIMEOUT_SECONDS,
                        "maximum": MAX_TIMEOUT_SECONDS,
                        "default": DEFAULT_TIMEOUT_SECONDS,
                    },
                    "show_browser": {
                        "type": "boolean",
                        "default": True,
                    },
                },
                "required": ["job_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> list[types.TextContent]:
    args = arguments or {}
    try:
        if name == "generate_image":
            return json_content(await generate_image(args))
        if name == "compare_providers":
            return json_content(await compare_providers(args))
        if name == "list_models":
            return json_content(list_models(args))
        if name == "midjourney_session_status":
            return json_content(await midjourney_session_status(args))
        if name == "midjourney_login":
            return json_content(await midjourney_login(args))
        if name == "midjourney_generate":
            return json_content(await midjourney_generate(args))
        if name == "midjourney_export_job":
            return json_content(await midjourney_export_job(args))
        return json_content(error_result("unknown_tool", f"Unknown tool: {name}"))
    except ToolError as exc:
        return json_content(exc.to_result())
    except Exception as exc:
        return json_content(
            error_result(
                "internal_error",
                "Image generator failed unexpectedly.",
                exception_type=type(exc).__name__,
                detail=safe_exception_detail(exc),
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
