"""Read-only validation for generated SVG brand assets."""

from __future__ import annotations

import json
from typing import Any

try:
    from .core import (
        BrandAssetError,
        HEX_COLOR,
        _local_name,
        _read_svg,
        _require_label,
        _sha256_bytes,
    )
except ImportError:
    from core import (  # type: ignore[no-redef]
        BrandAssetError,
        HEX_COLOR,
        _local_name,
        _read_svg,
        _require_label,
        _sha256_bytes,
    )


def validate_brand_asset(
    source: str,
    *,
    canonical_label: object = None,
    expected_font_family: object = None,
    allowed_colors: object = None,
) -> dict[str, object]:
    path, root, data, viewbox = _read_svg(source)
    requested_label = _require_label(canonical_label) if canonical_label is not None else None
    if expected_font_family is not None and (
        not isinstance(expected_font_family, str) or not expected_font_family.strip()
    ):
        raise BrandAssetError("validation", "expected_font_family must be a non-empty string.")
    allowed: set[str] | None = None
    if allowed_colors is not None:
        if not isinstance(allowed_colors, list) or any(
            not isinstance(color, str) or not HEX_COLOR.fullmatch(color)
            for color in allowed_colors
        ):
            raise BrandAssetError("validation", "allowed_colors must be a list of six-digit hex colors.")
        allowed = {color.upper() for color in allowed_colors}
    fills: set[str] = set()
    text_nodes = 0
    matching_font_nodes = 0
    embedded_metadata: dict[str, Any] | None = None
    for element in root.iter():
        local = _local_name(element.tag)
        if local == "text":
            text_nodes += 1
            family = element.attrib.get("font-family", "")
            if expected_font_family and expected_font_family.strip() in family:
                matching_font_nodes += 1
        for attribute in ("fill", "stroke"):
            value = element.attrib.get(attribute)
            if value and value.lower() != "none":
                if not HEX_COLOR.fullmatch(value):
                    raise BrandAssetError("validation", f"SVG {attribute} must use six-digit hex colors.")
                fills.add(value.upper())
        if local == "metadata" and element.text:
            try:
                candidate = json.loads(element.text)
            except json.JSONDecodeError as exc:
                raise BrandAssetError("validation", "SVG metadata is not valid JSON.") from exc
            if isinstance(candidate, dict):
                embedded_metadata = candidate
    if allowed is not None and not fills.issubset(allowed):
        raise BrandAssetError(
            "validation",
            "SVG contains a color outside allowed_colors.",
            colors=sorted(fills),
            allowed_colors=sorted(allowed),
        )
    if expected_font_family and matching_font_nodes == 0:
        raise BrandAssetError("validation", "SVG does not contain the expected live font family.")
    if requested_label and embedded_metadata and embedded_metadata.get("canonical_label") != requested_label:
        raise BrandAssetError("validation", "SVG metadata canonical_label does not match the request.")
    shapes = sum(
        1
        for element in root.iter()
        if _local_name(element.tag) in {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}
    )
    return {
        "path": str(path),
        "format": "svg",
        "bytes": len(data),
        "sha256": _sha256_bytes(data),
        "viewBox": [value for value in viewbox],
        "shape_count": shapes,
        "text_count": text_nodes,
        "colors": sorted(fills),
        "has_metadata": embedded_metadata is not None,
        "canonical_label": (embedded_metadata or {}).get("canonical_label"),
    }
