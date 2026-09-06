#!/usr/bin/env python3
"""Dependency-light MCP stdio server for brand-assets."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from core import (
    BrandAssetError,
    compose_brand_variant,
    inspect_source,
    trace_brand_asset,
)
from validation import validate_brand_asset


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "inspect_brand_source",
            "description": (
                "Read-only inspection of a local PNG, JPEG, or WebP logo source. "
                "Returns dimensions, bytes, format, and SHA-256 without changing the file."
            ),
            "inputSchema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"source_path": {"type": "string", "minLength": 1}},
                "required": ["source_path"],
            },
        },
        {
            "name": "trace_brand_asset",
            "description": (
                "Trace a caller-selected raster logo candidate into a sanitized, "
                "one-color SVG using ImageMagick and Potrace. The canonical label "
                "is required and is recorded as provenance; the tool never chooses "
                "between competing geometries."
            ),
            "inputSchema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "source_path": {"type": "string", "minLength": 1},
                    "output_path": {"type": "string", "minLength": 1},
                    "canonical_label": {"type": "string", "minLength": 1, "maxLength": 160},
                    "primary_color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                    "threshold_percent": {"type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 100},
                    "turdsize": {"type": "integer", "minimum": 0, "maximum": 100},
                    "alphamax": {"type": "number", "minimum": 0, "maximum": 4},
                    "opttolerance": {"type": "number", "minimum": 0, "maximum": 1},
                    "overwrite": {"type": "boolean"},
                },
                "required": ["source_path", "output_path", "canonical_label"],
            },
        },
        {
            "name": "compose_brand_variant",
            "description": (
                "Compose a validated SVG mark into standalone, stacked, or "
                "horizontal brand variants. Descriptor text is emitted as live "
                "text with a declared font family, not traced pixels."
            ),
            "inputSchema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "mark_path": {"type": "string", "minLength": 1},
                    "output_path": {"type": "string", "minLength": 1},
                    "canonical_label": {"type": "string", "minLength": 1, "maxLength": 160},
                    "layout": {"type": "string", "enum": ["standalone", "stacked", "horizontal"]},
                    "descriptor": {"type": "string", "maxLength": 240},
                    "primary_color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                    "accent_color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                    "background": {"type": ["string", "null"], "pattern": "^#[0-9A-Fa-f]{6}$"},
                    "divider_color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                    "font_family": {"type": "string", "minLength": 1, "maxLength": 160},
                    "font_size": {"type": "number", "exclusiveMinimum": 0, "maximum": 256},
                    "gap": {"type": "number", "minimum": 0, "maximum": 512},
                    "accent_dots": {
                        "type": "array",
                        "maxItems": 16,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "cx": {"type": "number"},
                                "cy": {"type": "number"},
                                "r": {"type": "number", "exclusiveMinimum": 0},
                            },
                            "required": ["cx", "cy", "r"],
                        },
                    },
                    "overwrite": {"type": "boolean"},
                },
                "required": ["mark_path", "output_path", "canonical_label"],
            },
        },
        {
            "name": "validate_brand_asset",
            "description": (
                "Read-only validation of an SVG brand asset. Checks safe SVG "
                "structure, drawable shapes, colors, optional live font family, "
                "and canonical-label provenance."
            ),
            "inputSchema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "source_path": {"type": "string", "minLength": 1},
                    "canonical_label": {"type": "string", "minLength": 1, "maxLength": 160},
                    "expected_font_family": {"type": "string", "minLength": 1, "maxLength": 160},
                    "allowed_colors": {
                        "type": "array",
                        "items": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
                    },
                },
                "required": ["source_path"],
            },
        },
    ]


def json_content(result: dict[str, Any]) -> list[dict[str, str]]:
    return [{"type": "text", "text": json.dumps(result, indent=2, sort_keys=False)}]


def safe_exception_detail(exc: Exception) -> str:
    detail = str(exc) or type(exc).__name__
    for name in ("OPENAI_API_KEY", "GEMINI_API_KEY", "REPLICATE_API_TOKEN"):
        value = os.environ.get(name)
        if value and len(value) >= 8:
            detail = detail.replace(value, "[redacted]")
    return detail[:2000]


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "inspect_brand_source":
            return {"ok": True, **inspect_source(arguments.get("source_path"))}
        if name == "trace_brand_asset":
            return {
                "ok": True,
                **trace_brand_asset(
                    arguments.get("source_path"),
                    arguments.get("output_path"),
                    canonical_label=arguments.get("canonical_label"),
                    primary_color=arguments.get("primary_color", "#000000"),
                    overwrite=arguments.get("overwrite", False),
                    threshold_percent=arguments.get("threshold_percent", 50),
                    turdsize=arguments.get("turdsize", 2),
                    alphamax=arguments.get("alphamax", 1.0),
                    opttolerance=arguments.get("opttolerance", 0.2),
                ),
            }
        if name == "compose_brand_variant":
            return {
                "ok": True,
                **compose_brand_variant(
                    arguments.get("mark_path"),
                    arguments.get("output_path"),
                    canonical_label=arguments.get("canonical_label"),
                    layout=arguments.get("layout", "standalone"),
                    descriptor=arguments.get("descriptor"),
                    primary_color=arguments.get("primary_color", "#14242B"),
                    accent_color=arguments.get("accent_color", "#00B5B0"),
                    background=arguments.get("background"),
                    divider_color=arguments.get("divider_color", "#14242B"),
                    font_family=arguments.get("font_family", "IBM Plex Mono, monospace"),
                    font_size=arguments.get("font_size", 28),
                    gap=arguments.get("gap", 72),
                    accent_dots=arguments.get("accent_dots"),
                    overwrite=arguments.get("overwrite", False),
                ),
            }
        if name == "validate_brand_asset":
            return {
                "ok": True,
                **validate_brand_asset(
                    arguments.get("source_path"),
                    canonical_label=arguments.get("canonical_label"),
                    expected_font_family=arguments.get("expected_font_family"),
                    allowed_colors=arguments.get("allowed_colors"),
                ),
            }
        return {"ok": False, "error_kind": "unknown_tool", "message": f"Unknown tool: {name}"}
    except BrandAssetError as exc:
        return exc.to_result()
    except Exception as exc:
        return {
            "ok": False,
            "error_kind": "internal_error",
            "message": "Brand-assets failed unexpectedly.",
            "exception_type": type(exc).__name__,
            "detail": safe_exception_detail(exc),
        }


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle_message(message: dict[str, Any]) -> None:
    method = message.get("method")
    request_id = message.get("id")
    if method == "initialize":
        params = message.get("params") if isinstance(message.get("params"), dict) else {}
        send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "brand-assets", "version": "0.1.0"},
                },
            }
        )
        return
    if method == "notifications/initialized":
        return
    if method == "tools/list":
        send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": tool_definitions()}})
        return
    if method == "tools/call":
        params = message.get("params") if isinstance(message.get("params"), dict) else {}
        name = params.get("name")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        payload = call_tool(name, arguments)
        send({"jsonrpc": "2.0", "id": request_id, "result": {"content": json_content(payload)}})
        return
    if request_id is not None:
        send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }
        )


def main() -> None:
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if isinstance(message, dict):
                handle_message(message)
        except (json.JSONDecodeError, TypeError):
            continue


if __name__ == "__main__":
    main()
