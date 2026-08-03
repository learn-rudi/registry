"""Fail-closed browser upload flow for validated Midjourney references."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any
from urllib.parse import urlsplit

from errors import ToolError
from midjourney_contract import MAX_MIDJOURNEY_PROMPT_CHARS
from midjourney_references import (
    compose_reference_prompt,
    has_reference_files,
    normalize_midjourney_cdn_url,
    verify_reference_unchanged,
)


CDN_ASSET_PATTERN = re.compile(
    r"^/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/"
)


async def _observed_cdn_urls(page: Any) -> set[str]:
    sources = await page.locator('img[src*="cdn.midjourney.com"]').evaluate_all(
        "elements => elements.slice(0, 2000).map(element => element.currentSrc || element.src)"
    )
    values: set[str] = set()
    for source in sources:
        if not isinstance(source, str):
            continue
        try:
            normalized = normalize_midjourney_cdn_url(source)
        except ToolError:
            continue
        if CDN_ASSET_PATTERN.match(urlsplit(normalized).path):
            values.add(normalized)
    return values


def _asset_groups(urls: set[str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for url in urls:
        match = CDN_ASSET_PATTERN.match(urlsplit(url).path)
        if match:
            groups.setdefault(match.group(1), []).append(url)
    return groups


async def _wait_for_uploaded_url(
    page: Any,
    *,
    baseline: set[str],
    deadline: float,
) -> str:
    baseline_ids = set(_asset_groups(baseline))
    while time.monotonic() < deadline:
        current = await _observed_cdn_urls(page)
        new_groups = {
            key: values
            for key, values in _asset_groups(current).items()
            if key not in baseline_ids
        }
        if len(new_groups) > 1:
            raise ToolError(
                "ui_drift",
                "More than one new Midjourney upload appeared; refusing to guess which file was added.",
            )
        if len(new_groups) == 1:
            urls = next(iter(new_groups.values()))
            return min(urls, key=lambda value: (len(value), value))
        await asyncio.sleep(0.25)
    raise ToolError(
        "timeout",
        "Midjourney did not expose an uploaded reference image before the timeout.",
    )


def _unique_references(references: dict[str, Any]) -> list[dict[str, Any]]:
    values = [*references["image_prompts"], *references["style_references"]]
    if references["omni_reference"]:
        values.append(references["omni_reference"])
    unique: dict[str, dict[str, Any]] = {}
    for reference in values:
        unique.setdefault(reference["sha256"], reference)
    return list(unique.values())


async def upload_reference_prompt(
    page: Any,
    *,
    prompt_value: str,
    references: dict[str, Any],
    timeout_seconds: int,
) -> str:
    if not has_reference_files(references):
        return prompt_value

    file_input = page.locator('input[type="file"][accept="image/*"]')
    input_count = await file_input.count()
    if input_count == 0:
        add_images = page.get_by_role("button", name="Add Images", exact=True)
        if await add_images.count() != 1:
            raise ToolError("ui_drift", "Midjourney Add Images control changed.")
        await add_images.click()
        file_input = page.locator('input[type="file"][accept="image/*"]')
        try:
            await file_input.wait_for(state="attached", timeout=min(timeout_seconds, 30) * 1000)
        except Exception as exc:
            raise ToolError("ui_drift", "Midjourney upload control did not open.") from exc
        input_count = await file_input.count()
    if input_count != 1:
        raise ToolError("ui_drift", "Midjourney upload control is missing or ambiguous.")

    deadline = time.monotonic() + timeout_seconds
    uploaded_urls: dict[str, str] = {}
    for reference in _unique_references(references):
        verify_reference_unchanged(reference)
        baseline = await _observed_cdn_urls(page)
        file_input = page.locator('input[type="file"][accept="image/*"]')
        if await file_input.count() != 1:
            raise ToolError("ui_drift", "Midjourney upload control changed during upload.")
        try:
            await file_input.set_input_files(reference["local_path"])
        except Exception as exc:
            raise ToolError(
                "upload_failed",
                "Midjourney rejected a validated reference image upload.",
                {"file_name": reference["file_name"]},
            ) from exc
        uploaded_urls[reference["sha256"]] = await _wait_for_uploaded_url(
            page,
            baseline=baseline,
            deadline=deadline,
        )

    final_prompt = compose_reference_prompt(prompt_value, references, uploaded_urls)
    if len(final_prompt) > MAX_MIDJOURNEY_PROMPT_CHARS:
        raise ToolError(
            "validation",
            "The prompt plus uploaded reference URLs exceeds the 6,000-character limit.",
            {"field": "prompt", "max_chars": MAX_MIDJOURNEY_PROMPT_CHARS},
        )
    return final_prompt
