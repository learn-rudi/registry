"""Deterministic, local-only brand-asset primitives."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_SVG_BYTES = 10 * 1024 * 1024
SUPPORTED_RASTER_FORMATS = ["png", "jpeg", "webp"]
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class BrandAssetError(Exception):
    """A stable, user-actionable brand-asset failure."""

    def __init__(self, error_kind: str, message: str, **details: object) -> None:
        super().__init__(message)
        self.error_kind = error_kind
        self.details = details

    def to_result(self) -> dict[str, object]:
        return {
            "ok": False,
            "error_kind": self.error_kind,
            "message": str(self),
            **self.details,
        }


def _require_absolute_path(value: str | Path, label: str) -> Path:
    if not isinstance(value, (str, Path)) or not str(value).strip():
        raise BrandAssetError("validation", f"{label} must be a non-empty path.")
    raw = str(value)
    if "\x00" in raw:
        raise BrandAssetError("validation", f"{label} contains a null byte.")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise BrandAssetError("validation", f"{label} must be an absolute path.")
    return path

def _read_regular_source(source: str | Path, *, max_bytes: int = MAX_SOURCE_BYTES) -> tuple[Path, bytes]:
    path = _require_absolute_path(source, "source_path")
    if path.is_symlink():
        raise BrandAssetError("validation", "source_path must not be a symlink.")
    if not path.is_file():
        raise BrandAssetError("validation", "source_path must be a regular file.")
    if path.stat().st_size > max_bytes:
        raise BrandAssetError(
            "validation",
            f"source_path exceeds the {max_bytes // (1024 * 1024)} MB input limit.",
            max_bytes=max_bytes,
        )
    return path, path.read_bytes()


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or data[12:16] != b"IHDR":
        return None
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if width < 1 or height < 1:
        raise BrandAssetError("validation", "PNG dimensions must be positive.")
    return width, height


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\xff\xd8"):
        return None
    position = 2
    while position + 3 < len(data):
        while position < len(data) and data[position] != 0xFF:
            position += 1
        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break
        marker = data[position]
        position += 1
        if marker in (0xD8, 0xD9):
            continue
        if position + 2 > len(data):
            break
        segment_length = int.from_bytes(data[position : position + 2], "big")
        if segment_length < 2 or position + segment_length > len(data):
            break
        if marker in {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }:
            height = int.from_bytes(data[position + 3 : position + 5], "big")
            width = int.from_bytes(data[position + 5 : position + 7], "big")
            if width < 1 or height < 1:
                raise BrandAssetError("validation", "JPEG dimensions must be positive.")
            return width, height
        position += segment_length
    raise BrandAssetError("validation", "JPEG dimensions could not be read.")


def _webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 16 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8X" and len(data) >= 30:
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
    elif chunk == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
    elif chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        width = 1 + (bits & 0x3FFF)
        height = 1 + ((bits >> 14) & 0x3FFF)
    else:
        return None
    if width < 1 or height < 1:
        raise BrandAssetError("validation", "WebP dimensions must be positive.")
    return width, height


def inspect_source(source: str | Path) -> dict[str, object]:
    """Inspect a supported raster without changing it or calling a provider."""

    path, data = _read_regular_source(source)
    dimensions = _png_dimensions(data)
    image_format = "png"
    if dimensions is None:
        dimensions = _jpeg_dimensions(data)
        image_format = "jpeg"
    if dimensions is None:
        dimensions = _webp_dimensions(data)
        image_format = "webp"
    if dimensions is None:
        raise BrandAssetError(
            "validation",
            "source_path is not a supported PNG, JPEG, or WebP image.",
            allowed_formats=SUPPORTED_RASTER_FORMATS,
        )

    width, height = dimensions
    return {
        "path": str(path),
        "format": image_format,
        "width": width,
        "height": height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def _require_label(value: object, label: str = "canonical_label") -> str:
    if not isinstance(value, str) or not value.strip():
        raise BrandAssetError("validation", f"{label} must be a non-empty string.")
    result = value.strip()
    if len(result) > 160 or CONTROL_CHARS.search(result):
        raise BrandAssetError("validation", f"{label} is too long or contains control characters.")
    return result


def _require_color(value: object, label: str, *, allow_none: bool = False) -> str | None:
    if allow_none and value is None:
        return None
    if not isinstance(value, str) or not HEX_COLOR.fullmatch(value):
        raise BrandAssetError("validation", f"{label} must be a six-digit hex color.")
    return value.upper()


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BrandAssetError("validation", f"{label} must be a finite number.")
    number = float(value)
    if not math.isfinite(number):
        raise BrandAssetError("validation", f"{label} must be a finite number.")
    return number


def _require_output_path(output: str | Path) -> Path:
    path = _require_absolute_path(output, "output_path")
    if path.suffix.lower() != ".svg":
        raise BrandAssetError("validation", "output_path must use the .svg extension.")
    if path.exists() and (path.is_symlink() or path.is_dir()):
        raise BrandAssetError("validation", "output_path must not be a symlink or directory.")
    return path


def _sidecar_path(output: Path) -> Path:
    return output.with_suffix(output.suffix + ".json")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_write(path: Path, data: bytes, *, overwrite: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if overwrite:
            os.replace(temporary, path)
            temporary = None
        else:
            os.link(temporary, path)
            temporary.unlink()
            temporary = None
    except FileExistsError as exc:
        raise BrandAssetError(
            "write_failed",
            "output already exists; pass overwrite=true to replace it explicitly.",
            path=str(path),
        ) from exc
    except OSError as exc:
        raise BrandAssetError(
            "write_failed",
            f"could not write {path.name}: {exc.strerror or type(exc).__name__}.",
            path=str(path),
        ) from exc
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _write_artifact_pair(
    output: Path,
    svg_text: str,
    metadata: dict[str, Any],
    *,
    overwrite: bool,
) -> dict[str, object]:
    sidecar = _sidecar_path(output)
    if not overwrite:
        existing = [path for path in (output, sidecar) if path.exists()]
        if existing:
            raise BrandAssetError(
                "write_failed",
                "output or provenance sidecar already exists; pass overwrite=true to replace it explicitly.",
                paths=[str(path) for path in existing],
            )
    svg_bytes = svg_text.encode("utf-8")
    metadata = dict(metadata)
    metadata["output"] = {
        "path": str(output),
        "bytes": len(svg_bytes),
        "sha256": _sha256_bytes(svg_bytes),
    }
    sidecar_bytes = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode("utf-8")
    written: list[Path] = []
    try:
        _atomic_write(output, svg_bytes, overwrite=overwrite)
        written.append(output)
        _atomic_write(sidecar, sidecar_bytes, overwrite=overwrite)
        written.append(sidecar)
    except Exception:
        if not overwrite:
            for path in written:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
        raise
    return {
        "output_path": str(output),
        "sidecar_path": str(sidecar),
        "output_bytes": len(svg_bytes),
        "output_sha256": _sha256_bytes(svg_bytes),
    }


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_viewbox(root: ET.Element) -> tuple[float, float, float, float]:
    raw = root.attrib.get("viewBox", "").replace(",", " ").split()
    if len(raw) != 4:
        raise BrandAssetError("validation", "SVG must declare a four-value viewBox.")
    try:
        values = tuple(float(value) for value in raw)
    except ValueError as exc:
        raise BrandAssetError("validation", "SVG viewBox must contain numbers.") from exc
    if any(not math.isfinite(value) for value in values):
        raise BrandAssetError("validation", "SVG viewBox must contain finite numbers.")
    x, y, width, height = values
    if width <= 0 or height <= 0:
        raise BrandAssetError("validation", "SVG viewBox width and height must be positive.")
    return x, y, width, height


def _validate_svg_tree(root: ET.Element) -> None:
    if _local_name(root.tag) != "svg":
        raise BrandAssetError("validation", "SVG root element must be <svg>.")
    _parse_viewbox(root)
    blocked_elements = {"script", "foreignObject", "iframe", "object", "embed"}
    for element in root.iter():
        if _local_name(element.tag) in blocked_elements:
            raise BrandAssetError(
                "validation",
                f"SVG contains a blocked element: {_local_name(element.tag)}.",
            )
        for key, value in element.attrib.items():
            local_key = _local_name(key).lower()
            lower_value = value.lower()
            if local_key in {"href", "src"} or "url(" in lower_value:
                raise BrandAssetError(
                    "validation",
                    "SVG external references and CSS url() values are not allowed.",
                )
            if any(scheme in lower_value for scheme in ("http:", "https:", "data:", "file:")):
                raise BrandAssetError(
                    "validation",
                    "SVG external and data references are not allowed.",
                )


def _read_svg(source: str | Path) -> tuple[Path, ET.Element, bytes, tuple[float, float, float, float]]:
    path = _require_absolute_path(source, "mark_path")
    if path.suffix.lower() != ".svg":
        raise BrandAssetError("validation", "mark_path must use the .svg extension.")
    path, data = _read_regular_source(path, max_bytes=MAX_SVG_BYTES)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise BrandAssetError("validation", "mark_path is not well-formed SVG.") from exc
    _validate_svg_tree(root)
    viewbox = _parse_viewbox(root)
    shapes = sum(
        1
        for element in root.iter()
        if _local_name(element.tag) in {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}
    )
    if shapes == 0:
        raise BrandAssetError("validation", "SVG does not contain a drawable mark.")
    return path, root, data, viewbox


def _visual_children(root: ET.Element) -> list[ET.Element]:
    ignored = {"title", "desc", "metadata"}
    return [copy.deepcopy(child) for child in list(root) if _local_name(child.tag) not in ignored]


def _set_visual_fill(element: ET.Element, fill: str) -> None:
    if _local_name(element.tag) in {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}:
        element.attrib["fill"] = fill
        element.attrib.pop("style", None)
    for child in list(element):
        _set_visual_fill(child, fill)


def _metadata_element(parent: ET.Element, payload: dict[str, Any]) -> None:
    element = ET.SubElement(parent, "metadata")
    element.text = json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _new_svg_root(viewbox: tuple[float, float, float, float], title: str, description: str) -> ET.Element:
    ET.register_namespace("", SVG_NAMESPACE)
    root = ET.Element(
        f"{{{SVG_NAMESPACE}}}svg",
        {
            "viewBox": " ".join(f"{value:g}" for value in viewbox),
            "role": "img",
            "aria-labelledby": "title description",
        },
    )
    title_element = ET.SubElement(root, "title", {"id": "title"})
    title_element.text = title
    description_element = ET.SubElement(root, "desc", {"id": "description"})
    description_element.text = description
    return root


def _serialize_svg(root: ET.Element) -> str:
    _validate_svg_tree(root)
    return ET.tostring(root, encoding="unicode", short_empty_elements=True) + "\n"


def _resolve_binary(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        raise BrandAssetError(
            "dependency",
            f"Required binary is unavailable: {name}.",
            binary=name,
        )
    return resolved


def _run_command(command: list[str], *, timeout_seconds: int = 60) -> str:
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise BrandAssetError(
            "dependency",
            f"Command timed out after {timeout_seconds} seconds: {Path(command[0]).name}.",
        ) from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "no diagnostic").strip()[-2000:]
        raise BrandAssetError(
            "trace_failed",
            f"{Path(command[0]).name} failed with exit code {completed.returncode}: {detail}",
        )
    return completed.stdout.strip()


def _tool_version(binary: str) -> str:
    try:
        output = _run_command([binary, "--version"], timeout_seconds=10)
    except BrandAssetError:
        return "unavailable"
    return output.splitlines()[0][:200] if output else "unknown"


def _trace_parameters(arguments: dict[str, Any]) -> dict[str, float | int]:
    threshold = _finite_number(arguments.get("threshold_percent", 50), "threshold_percent")
    if threshold <= 0 or threshold >= 100:
        raise BrandAssetError("validation", "threshold_percent must be greater than 0 and less than 100.")
    turdsize = arguments.get("turdsize", 2)
    if isinstance(turdsize, bool) or not isinstance(turdsize, int) or not 0 <= turdsize <= 100:
        raise BrandAssetError("validation", "turdsize must be an integer from 0 to 100.")
    alphamax = _finite_number(arguments.get("alphamax", 1.0), "alphamax")
    if not 0 <= alphamax <= 4:
        raise BrandAssetError("validation", "alphamax must be between 0 and 4.")
    opttolerance = _finite_number(arguments.get("opttolerance", 0.2), "opttolerance")
    if not 0 <= opttolerance <= 1:
        raise BrandAssetError("validation", "opttolerance must be between 0 and 1.")
    return {
        "threshold_percent": threshold,
        "turdsize": turdsize,
        "alphamax": alphamax,
        "opttolerance": opttolerance,
    }


def build_trace_commands(
    source: str | Path,
    mask: str | Path,
    raw_svg: str | Path,
    *,
    imagemagick: str = "magick",
    potrace: str = "potrace",
    parameters: dict[str, float | int] | None = None,
) -> list[list[str]]:
    params = parameters or {
        "threshold_percent": 50,
        "turdsize": 2,
        "alphamax": 1.0,
        "opttolerance": 0.2,
    }
    threshold = float(params["threshold_percent"])
    return [
        [
            imagemagick,
            str(source),
            "-background",
            "white",
            "-alpha",
            "remove",
            "-alpha",
            "off",
            "-colorspace",
            "Gray",
            "-threshold",
            f"{threshold:g}%",
            str(mask),
        ],
        [
            potrace,
            str(mask),
            "--svg",
            "--tight",
            "--turdsize",
            str(params["turdsize"]),
            "--alphamax",
            str(params["alphamax"]),
            "--opttolerance",
            str(params["opttolerance"]),
            "--output",
            str(raw_svg),
        ],
    ]


def _trace_svg(raw_svg: bytes, canonical_label: str, primary_color: str) -> str:
    try:
        raw_root = ET.fromstring(raw_svg)
    except ET.ParseError as exc:
        raise BrandAssetError("trace_failed", "Potrace returned malformed SVG.") from exc
    _validate_svg_tree(raw_root)
    viewbox = _parse_viewbox(raw_root)
    paths = [element for element in raw_root.iter() if _local_name(element.tag) == "path"]
    if not paths:
        raise BrandAssetError("trace_failed", "Potrace returned an SVG with no paths.")
    root = _new_svg_root(
        viewbox,
        f"{canonical_label} traced mark",
        "One-color vector trace generated from a caller-selected raster source.",
    )
    root.attrib["fill"] = primary_color
    for path in paths:
        attributes = {"d": path.attrib.get("d", ""), "fill": primary_color}
        if not attributes["d"]:
            continue
        for name in ("fill-rule", "clip-rule"):
            if name in path.attrib:
                attributes[name] = path.attrib[name]
        ET.SubElement(root, "path", attributes)
    return _serialize_svg(root)


def trace_brand_asset(
    source: str | Path,
    output: str | Path,
    *,
    canonical_label: object,
    primary_color: object = "#000000",
    overwrite: bool = False,
    **arguments: Any,
) -> dict[str, object]:
    started = time.monotonic()
    label = _require_label(canonical_label)
    color = _require_color(primary_color, "primary_color")
    output_path = _require_output_path(output)
    parameters = _trace_parameters(arguments)
    source_report = inspect_source(source)
    source_path = Path(str(source_report["path"]))
    imagemagick = _resolve_binary("magick")
    potrace = _resolve_binary("potrace")
    with tempfile.TemporaryDirectory(prefix="rudi-brand-trace-") as temporary_dir:
        temporary = Path(temporary_dir)
        mask = temporary / "mask.pbm"
        raw_svg = temporary / "potrace.svg"
        commands = build_trace_commands(
            source_path,
            mask,
            raw_svg,
            imagemagick=imagemagick,
            potrace=potrace,
            parameters=parameters,
        )
        _run_command(commands[0])
        _run_command(commands[1])
        raw_bytes = raw_svg.read_bytes()
    current_source = inspect_source(source_path)
    if current_source["sha256"] != source_report["sha256"]:
        raise BrandAssetError(
            "source_changed",
            "source_path changed while tracing; no final SVG was written.",
            before_sha256=source_report["sha256"],
            after_sha256=current_source["sha256"],
        )
    svg_text = _trace_svg(raw_bytes, label, color)
    metadata: dict[str, Any] = {
        "schema_version": "1.0",
        "operation": "trace_brand_asset",
        "canonical_label": label,
        "source": source_report,
        "parameters": parameters,
        "tools": {
            "imagemagick": {"binary": Path(imagemagick).name, "version": _tool_version(imagemagick)},
            "potrace": {"binary": Path(potrace).name, "version": _tool_version(potrace)},
        },
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }
    result = _write_artifact_pair(output_path, svg_text, metadata, overwrite=overwrite)
    return {**result, "canonical_label": label, "source": source_report, "parameters": parameters}


def _read_upstream_manifest(mark_path: Path) -> dict[str, Any] | None:
    sidecar = _sidecar_path(mark_path)
    if not sidecar.exists():
        return None
    if sidecar.is_symlink() or not sidecar.is_file() or sidecar.stat().st_size > 1 * 1024 * 1024:
        raise BrandAssetError("validation", "mark provenance sidecar is unsafe or too large.")
    try:
        value = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BrandAssetError("validation", "mark provenance sidecar is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise BrandAssetError("validation", "mark provenance sidecar must contain a JSON object.")
    return value


def _accent_dots(value: object, label: str) -> list[dict[str, float]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 16:
        raise BrandAssetError("validation", f"{label} must contain at most 16 dots.")
    dots: list[dict[str, float]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise BrandAssetError("validation", f"{label}[{index}] must be an object.")
        cx = _finite_number(item.get("cx"), f"{label}[{index}].cx")
        cy = _finite_number(item.get("cy"), f"{label}[{index}].cy")
        radius = _finite_number(item.get("r"), f"{label}[{index}].r")
        if radius <= 0:
            raise BrandAssetError("validation", f"{label}[{index}].r must be positive.")
        dots.append({"cx": cx, "cy": cy, "r": radius})
    return dots


def compose_brand_variant(
    mark: str | Path,
    output: str | Path,
    *,
    canonical_label: object,
    layout: object = "standalone",
    descriptor: object = None,
    primary_color: object = "#14242B",
    accent_color: object = "#00B5B0",
    background: object = None,
    divider_color: object = "#14242B",
    font_family: object = "IBM Plex Mono, monospace",
    font_size: object = 28,
    gap: object = 72,
    accent_dots: object = None,
    overwrite: bool = False,
) -> dict[str, object]:
    started = time.monotonic()
    label = _require_label(canonical_label)
    if layout not in {"standalone", "stacked", "horizontal"}:
        raise BrandAssetError("validation", "layout must be standalone, stacked, or horizontal.")
    if layout == "standalone" and descriptor is not None:
        raise BrandAssetError("validation", "descriptor is only valid for stacked or horizontal layouts.")
    if layout != "standalone" and (not isinstance(descriptor, str) or not descriptor.strip()):
        raise BrandAssetError("validation", "descriptor is required for stacked and horizontal layouts.")
    descriptor_text = descriptor.strip() if isinstance(descriptor, str) else None
    if descriptor_text and (len(descriptor_text) > 240 or CONTROL_CHARS.search(descriptor_text)):
        raise BrandAssetError("validation", "descriptor is too long or contains control characters.")
    primary = _require_color(primary_color, "primary_color")
    accent = _require_color(accent_color, "accent_color")
    divider = _require_color(divider_color, "divider_color")
    paper = _require_color(background, "background", allow_none=True)
    if not isinstance(font_family, str) or not font_family.strip() or len(font_family) > 160 or CONTROL_CHARS.search(font_family):
        raise BrandAssetError("validation", "font_family must be a safe, non-empty string.")
    size = _finite_number(font_size, "font_size")
    spacing = _finite_number(gap, "gap")
    if size <= 0 or size > 256 or spacing < 0 or spacing > 512:
        raise BrandAssetError("validation", "font_size or gap is outside the supported range.")
    dots = _accent_dots(accent_dots, "accent_dots")
    mark_path, mark_root, mark_bytes, viewbox = _read_svg(mark)
    output_path = _require_output_path(output)
    x, y, width, height = viewbox
    mark_width = 600.0
    scale = mark_width / width
    mark_height = height * scale
    upstream = _read_upstream_manifest(mark_path)

    if layout == "standalone":
        canvas_width = mark_width
        canvas_height = mark_height
    elif layout == "stacked":
        canvas_width = mark_width
        canvas_height = mark_height + spacing + size * 1.5
    else:
        estimated_text_width = max(180.0, len(descriptor_text or "") * size * 0.62)
        canvas_width = mark_width + 32 + 2 + 32 + estimated_text_width
        canvas_height = max(mark_height, size * 1.6)

    root = _new_svg_root(
        (0, 0, canvas_width, canvas_height),
        f"{label} {layout} brand asset",
        "Composed from a validated SVG mark; descriptor text remains live and editable.",
    )
    if paper:
        ET.SubElement(root, "rect", {"width": f"{canvas_width:g}", "height": f"{canvas_height:g}", "fill": paper})
    root.attrib["fill"] = primary

    mark_group = ET.SubElement(root, "g", {"fill": primary})
    if layout == "horizontal":
        mark_y = (canvas_height - mark_height) / 2
        divider_x = mark_width + 32
        text_x = divider_x + 34
    else:
        mark_y = 0.0
        divider_x = 0.0
        text_x = 0.0
    mark_group.attrib["transform"] = f"translate(0 {mark_y:g}) scale({scale:g}) translate({-x:g} {-y:g})"
    for child in _visual_children(mark_root):
        _set_visual_fill(child, primary)
        mark_group.append(child)
    for dot in dots:
        ET.SubElement(
            mark_group,
            "circle",
            {"cx": f"{dot['cx']:g}", "cy": f"{dot['cy']:g}", "r": f"{dot['r']:g}", "fill": accent},
        )

    if layout == "stacked":
        text = ET.SubElement(
            root,
            "text",
            {
                "x": f"{canvas_width / 2:g}",
                "y": f"{mark_height + spacing + size:g}",
                "text-anchor": "middle",
                "font-family": font_family.strip(),
                "font-size": f"{size:g}",
                "font-weight": "500",
                "letter-spacing": "0.02em",
                "fill": primary,
            },
        )
        text.text = descriptor_text
    elif layout == "horizontal":
        ET.SubElement(
            root,
            "rect",
            {
                "x": f"{divider_x:g}",
                "y": f"{(canvas_height - size * 1.2) / 2:g}",
                "width": "2",
                "height": f"{size * 1.2:g}",
                "fill": divider,
            },
        )
        text = ET.SubElement(
            root,
            "text",
            {
                "x": f"{text_x:g}",
                "y": f"{canvas_height / 2 + size * 0.35:g}",
                "font-family": font_family.strip(),
                "font-size": f"{size:g}",
                "font-weight": "500",
                "letter-spacing": "0.02em",
                "fill": primary,
            },
        )
        text.text = descriptor_text

    metadata: dict[str, Any] = {
        "schema_version": "1.0",
        "operation": "compose_brand_variant",
        "canonical_label": label,
        "layout": layout,
        "descriptor": descriptor_text,
        "mark": {
            "path": str(mark_path),
            "bytes": len(mark_bytes),
            "sha256": _sha256_bytes(mark_bytes),
        },
        "upstream": upstream,
        "style": {
            "primary_color": primary,
            "accent_color": accent,
            "background": paper,
            "divider_color": divider,
            "font_family": font_family.strip() if layout != "standalone" else None,
            "font_size": size if layout != "standalone" else None,
            "accent_dots": dots,
        },
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }
    _metadata_element(root, metadata)
    svg_text = _serialize_svg(root)
    result = _write_artifact_pair(output_path, svg_text, metadata, overwrite=overwrite)
    return {**result, "canonical_label": label, "layout": layout, "descriptor": descriptor_text}
