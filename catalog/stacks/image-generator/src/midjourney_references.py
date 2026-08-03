"""Validated local reference-image contracts for Midjourney generation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from errors import ToolError
from outputs import detect_image_format


MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_REFERENCE_LIST = 4
REFERENCE_MEDIA_TYPES = {
    "png": ("image/png", {".png"}),
    "jpg": ("image/jpeg", {".jpg", ".jpeg"}),
    "webp": ("image/webp", {".webp"}),
}
REFERENCE_PARAMETER_PATTERNS = {
    "image_weight": re.compile(r"(?:^|\s)--iw(?=\s|=|$)", re.IGNORECASE),
    "style_references": re.compile(r"(?:^|\s)--sref(?=\s|=|$)", re.IGNORECASE),
    "style_weight": re.compile(r"(?:^|\s)--sw(?=\s|=|$)", re.IGNORECASE),
    "omni_reference": re.compile(r"(?:^|\s)--oref(?=\s|=|$)", re.IGNORECASE),
    "omni_weight": re.compile(r"(?:^|\s)--ow(?=\s|=|$)", re.IGNORECASE),
}
MIDJOURNEY_CDN_HOST = "cdn.midjourney.com"


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _inspect_reference_file(path: Path) -> dict[str, Any]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ToolError(
            "validation",
            "Reference image could not be opened safely.",
            {"file_name": path.name},
        ) from exc

    digest = hashlib.sha256()
    prefix = b""
    size = 0
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ToolError("validation", "Reference image must be a regular file.")
        if metadata.st_size <= 0 or metadata.st_size > MAX_REFERENCE_BYTES:
            raise ToolError(
                "validation",
                "Reference image must be between 1 byte and 10 MB.",
                {"file_name": path.name, "max_bytes": MAX_REFERENCE_BYTES},
            )
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            if len(prefix) < 16:
                prefix += chunk[: 16 - len(prefix)]
            size += len(chunk)
            if size > MAX_REFERENCE_BYTES:
                raise ToolError(
                    "validation",
                    "Reference image exceeds the 10 MB upload limit.",
                    {"file_name": path.name, "max_bytes": MAX_REFERENCE_BYTES},
                )
            digest.update(chunk)
    finally:
        os.close(descriptor)

    image_format = detect_image_format(prefix)
    media = REFERENCE_MEDIA_TYPES.get(image_format)
    if media is None or path.suffix.lower() not in media[1]:
        raise ToolError(
            "validation",
            "Reference image must be a PNG, JPEG, or WebP file with a matching extension.",
            {"file_name": path.name},
        )
    return {
        "local_path": str(path),
        "file_name": path.name,
        "media_type": media[0],
        "sha256": digest.hexdigest(),
        "size_bytes": size,
    }


def _reference_file(value: Any, *, input_root: Path, output_root: Path) -> dict[str, Any]:
    if not isinstance(value, str) or not value or "\x00" in value or len(value) > 4096:
        raise ToolError(
            "validation",
            "Reference paths must be non-empty strings of 4,096 characters or fewer.",
        )
    supplied = Path(value).expanduser()
    if not supplied.is_absolute() and ".." in supplied.parts:
        raise ToolError("validation", "Relative reference paths cannot contain `..`.")
    candidate = supplied if supplied.is_absolute() else input_root / supplied
    if candidate.is_symlink():
        raise ToolError("validation", "Reference image symlinks are not allowed.")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise ToolError(
            "validation",
            "Reference image does not exist or cannot be resolved.",
            {"file_name": candidate.name},
        ) from exc
    allowed_roots = (input_root.resolve(), output_root.resolve())
    if not any(_inside(resolved, root) for root in allowed_roots):
        raise ToolError(
            "validation",
            "Reference image must be staged under the Midjourney input directory or RUDI outputs.",
            {"allowed_roots": [str(root) for root in allowed_roots]},
        )
    return _inspect_reference_file(resolved)


def _reference_list(
    value: Any,
    *,
    field: str,
    input_root: Path,
    output_root: Path,
) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not value or len(value) > MAX_REFERENCE_LIST:
        raise ToolError(
            "validation",
            f"`{field}` must contain 1-{MAX_REFERENCE_LIST} local image paths.",
            {"field": field, "max_items": MAX_REFERENCE_LIST},
        )
    references = [
        _reference_file(item, input_root=input_root, output_root=output_root)
        for item in value
    ]
    digests = [item["sha256"] for item in references]
    if len(set(digests)) != len(digests):
        raise ToolError(
            "validation",
            f"`{field}` cannot contain duplicate image content.",
            {"field": field},
        )
    return references


def _weight(
    value: Any,
    *,
    field: str,
    minimum: float,
    maximum: float,
    required_reference: bool,
    prompt_value: str,
) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ToolError(
            "validation",
            f"`{field}` must be a number between {minimum:g} and {maximum:g}.",
            {"field": field, "minimum": minimum, "maximum": maximum},
        )
    if value < minimum or value > maximum or not required_reference:
        message = (
            f"`{field}` requires its corresponding reference image."
            if not required_reference
            else f"`{field}` must be between {minimum:g} and {maximum:g}."
        )
        raise ToolError("validation", message, {"field": field})
    if REFERENCE_PARAMETER_PATTERNS[field].search(prompt_value):
        raise ToolError(
            "validation",
            f"Do not provide `{field}` when the prompt already contains its parameter.",
            {"field": field},
        )
    return value


def reference_inputs(
    args: dict[str, Any],
    *,
    prompt_value: str,
    input_root: Path,
    output_root: Path,
) -> dict[str, Any]:
    image_prompts = _reference_list(
        args.get("image_prompts"),
        field="image_prompts",
        input_root=input_root,
        output_root=output_root,
    )
    style_references = _reference_list(
        args.get("style_references"),
        field="style_references",
        input_root=input_root,
        output_root=output_root,
    )
    omni_value = args.get("omni_reference")
    omni_reference = (
        _reference_file(omni_value, input_root=input_root, output_root=output_root)
        if omni_value is not None
        else None
    )
    for field, present in (
        ("style_references", bool(style_references)),
        ("omni_reference", omni_reference is not None),
    ):
        if present and REFERENCE_PARAMETER_PATTERNS[field].search(prompt_value):
            raise ToolError(
                "validation",
                f"Do not combine `{field}` with its raw prompt parameter.",
                {"field": field},
            )

    return {
        "image_prompts": image_prompts,
        "style_references": style_references,
        "omni_reference": omni_reference,
        "image_weight": _weight(
            args.get("image_weight"),
            field="image_weight",
            minimum=0,
            maximum=3,
            required_reference=bool(image_prompts),
            prompt_value=prompt_value,
        ),
        "style_weight": _weight(
            args.get("style_weight"),
            field="style_weight",
            minimum=0,
            maximum=1000,
            required_reference=bool(style_references),
            prompt_value=prompt_value,
        ),
        "omni_weight": _weight(
            args.get("omni_weight"),
            field="omni_weight",
            minimum=1,
            maximum=1000,
            required_reference=omni_reference is not None,
            prompt_value=prompt_value,
        ),
    }


def has_reference_files(references: dict[str, Any]) -> bool:
    return bool(
        references["image_prompts"]
        or references["style_references"]
        or references["omni_reference"]
    )


def request_fingerprint(prompt_value: str, references: dict[str, Any]) -> str:
    if not has_reference_files(references):
        return hashlib.sha256(prompt_value.encode("utf-8")).hexdigest()
    payload = {
        "prompt": prompt_value,
        "image_prompts": [item["sha256"] for item in references["image_prompts"]],
        "style_references": [item["sha256"] for item in references["style_references"]],
        "omni_reference": (
            references["omni_reference"]["sha256"]
            if references["omni_reference"]
            else None
        ),
        "image_weight": references["image_weight"],
        "style_weight": references["style_weight"],
        "omni_weight": references["omni_weight"],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def verify_reference_unchanged(reference: dict[str, Any]) -> None:
    current = _inspect_reference_file(Path(reference["local_path"]))
    expected = (reference["sha256"], reference["size_bytes"], reference["media_type"])
    actual = (current["sha256"], current["size_bytes"], current["media_type"])
    if actual != expected:
        raise ToolError(
            "reference_changed",
            "A reference image changed after request validation; generation was not submitted.",
            {"file_name": reference["file_name"]},
        )


def normalize_midjourney_cdn_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != MIDJOURNEY_CDN_HOST
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.path.startswith("/")
    ):
        raise ToolError("ui_drift", "Midjourney returned an unexpected reference image URL.")
    return urlunsplit(("https", MIDJOURNEY_CDN_HOST, parsed.path, "", ""))


def compose_reference_prompt(
    prompt_value: str,
    references: dict[str, Any],
    uploaded_urls: dict[str, str],
) -> str:
    def url_for(reference: dict[str, Any]) -> str:
        value = uploaded_urls.get(reference["sha256"])
        if not isinstance(value, str):
            raise ToolError("internal_error", "A validated reference image was not uploaded.")
        return normalize_midjourney_cdn_url(value)

    image_urls = [url_for(item) for item in references["image_prompts"]]
    parameters: list[str] = []
    if references["image_weight"] is not None:
        parameters.extend(("--iw", format(float(references["image_weight"]), "g")))
    if references["style_references"]:
        parameters.append("--sref")
        parameters.extend(url_for(item) for item in references["style_references"])
    if references["style_weight"] is not None:
        parameters.extend(("--sw", format(float(references["style_weight"]), "g")))
    if references["omni_reference"]:
        parameters.extend(("--oref", url_for(references["omni_reference"])))
    if references["omni_weight"] is not None:
        parameters.extend(("--ow", format(float(references["omni_weight"]), "g")))
    return " ".join((*image_urls, prompt_value, *parameters))
