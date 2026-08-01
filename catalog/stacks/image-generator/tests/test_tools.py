from __future__ import annotations

import asyncio
import base64
import os
import shutil
import sys
import tempfile
import unittest
import uuid
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from unittest.mock import AsyncMock

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import tools as tool_module  # noqa: E402
from errors import ToolError  # noqa: E402
from renderer.gemini_client import GeminiClient  # noqa: E402
from renderer.openai_client import OpenAIClient  # noqa: E402
from renderer.replicate_client import ReplicateClient  # noqa: E402
from tools import (  # noqa: E402
    ASSET_FORMATS,
    DEFAULT_OUTPUT_DIR,
    MAX_COMPARE_SPECS,
    _call_provider,
    _normalize_references,
    _output_path,
    _read_prompt,
    compare_providers,
    generate_image,
    list_models,
)


def png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return buffer.getvalue()


@contextmanager
def without_env(*names: str):
    previous = {name: os.environ.get(name) for name in names}
    for name in names:
        os.environ.pop(name, None)
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


class ImageGeneratorToolsTest(unittest.TestCase):
    def test_prompt_paths_are_literal_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            prompt_file = Path(tmp) / "prompt.txt"
            prompt_file.write_text("file contents should not be read", encoding="utf-8")

            prompt, label = _read_prompt(str(prompt_file))

        self.assertEqual(prompt, str(prompt_file))
        self.assertIn("literal prompt", label)

    def test_references_must_be_real_images(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fake_png = Path(tmp) / "not-an-image.png"
            fake_png.write_text("not image bytes", encoding="utf-8")

            with self.assertRaises(ToolError) as raised:
                _normalize_references({"references": [str(fake_png)]})

        self.assertEqual(raised.exception.error_kind, "validation")

    def test_valid_png_reference_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            png_path = Path(tmp) / "reference.png"
            Image.new("RGB", (2, 2), "white").save(png_path)

            refs = _normalize_references({"references": [str(png_path)]})

        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].name, "reference.png")

    def test_output_path_must_stay_inside_rudi_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            outside_path = Path(tmp) / "image.png"

            with self.assertRaises(ToolError) as raised:
                _output_path(str(outside_path))

        self.assertEqual(raised.exception.error_kind, "validation")
        self.assertIn(str(DEFAULT_OUTPUT_DIR), raised.exception.message)

    def test_list_models_reports_current_defaults(self) -> None:
        models = list_models({})

        self.assertTrue(models["ok"])
        self.assertEqual(
            models["providers"]["gemini"]["presets"]["sketch"]["default_model"],
            "gemini-3.1-flash-image",
        )
        self.assertEqual(
            models["providers"]["gemini"]["known_models"]["gemini-3.1-flash-image"][
                "status"
            ],
            "current",
        )
        self.assertEqual(
            models["providers"]["gemini"]["known_models"][
                "gemini-3.1-flash-image-preview"
            ]["status"],
            "deprecated",
        )
        self.assertEqual(
            models["providers"]["openai"]["presets"]["photoreal"]["default_model"],
            "gpt-image-2",
        )
        self.assertIn("gpt-image-1.5", models["providers"]["openai"]["known_models"])
        self.assertEqual(
            models["providers"]["openai"]["known_models"]["gpt-image-1.5"]["status"],
            "deprecated",
        )

    def test_list_models_marks_replicate_beta_and_model_specific(self) -> None:
        models = list_models({"provider": "replicate"})
        replicate = models["providers"]["replicate"]

        self.assertEqual(replicate["release_status"], "beta")
        self.assertEqual(replicate["stability"], "model-specific")
        self.assertIn("schema", replicate["beta_reason"])
        self.assertEqual(
            replicate["known_models"]["black-forest-labs/flux-2-max"]["status"],
            "beta",
        )
        self.assertEqual(replicate["aliases"]["flux-2"]["status"], "beta")
        self.assertEqual(replicate["aliases"]["flux-2-pro"]["status"], "unverified")
        self.assertEqual(replicate["aliases"]["seedream-4"]["status"], "beta")
        self.assertEqual(
            replicate["aliases"]["seedream-4"]["references"]["reference_param"],
            "image_input",
        )

    def test_list_models_reports_secret_status_without_provider_calls(self) -> None:
        with without_env("OPENAI_API_KEY"):
            missing = list_models({"provider": "openai"})
        self.assertFalse(missing["providers"]["openai"]["secret_status"]["configured"])

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False):
            configured = list_models({"provider": "openai"})
        self.assertTrue(configured["providers"]["openai"]["secret_status"]["configured"])
        self.assertEqual(
            configured["providers"]["openai"]["secret_status"]["env"],
            "OPENAI_API_KEY",
        )

    def test_list_models_response_shape_snapshot(self) -> None:
        models = list_models({})
        summary = {
            "top_level": sorted(models),
            "formats": {
                format_id: sorted(format_data)
                for format_id, format_data in models["formats"].items()
            },
            "providers": {
                provider: {
                    "keys": sorted(provider_data),
                    "secret_status_keys": sorted(provider_data["secret_status"]),
                    "preset_keys": {
                        preset: {
                            "keys": sorted(preset_data),
                            "reference_keys": sorted(preset_data["references"]),
                        }
                        for preset, preset_data in provider_data["presets"].items()
                    },
                }
                for provider, provider_data in models["providers"].items()
            },
        }

        self.assertEqual(
            summary,
            {
                "top_level": ["formats", "ok", "providers", "timeout_seconds"],
                "formats": {
                    "landscape": ["aspect_ratio", "description"],
                    "portrait": ["aspect_ratio", "description"],
                    "square": ["aspect_ratio", "description"],
                    "story": ["aspect_ratio", "description"],
                },
                "providers": {
                    "gemini": {
                        "keys": [
                            "default_preset",
                            "explicit_models",
                            "known_models",
                            "presets",
                            "secret",
                            "secret_status",
                            "unsupported_presets",
                        ],
                        "secret_status_keys": [
                            "configured",
                            "env",
                            "required_for_generation",
                        ],
                        "preset_keys": {
                            "sketch": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                            "photoreal": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                        },
                    },
                    "openai": {
                        "keys": [
                            "default_preset",
                            "explicit_models",
                            "known_models",
                            "presets",
                            "secret",
                            "secret_status",
                        ],
                        "secret_status_keys": [
                            "configured",
                            "env",
                            "required_for_generation",
                        ],
                        "preset_keys": {
                            "sketch": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                            "photoreal": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                            "edit": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                        },
                    },
                    "replicate": {
                        "keys": [
                            "aliases",
                            "beta_reason",
                            "default_preset",
                            "explicit_models",
                            "known_models",
                            "presets",
                            "reference_models",
                            "release_status",
                            "secret",
                            "secret_status",
                            "stability",
                        ],
                        "secret_status_keys": [
                            "configured",
                            "env",
                            "required_for_generation",
                        ],
                        "preset_keys": {
                            "sketch": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "rule",
                                    "supported",
                                ],
                            },
                            "photoreal": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "reference_param",
                                    "rule",
                                    "supported",
                                ],
                            },
                            "edit": {
                                "keys": ["active_model", "default_model", "references"],
                                "reference_keys": [
                                    "max_references",
                                    "multi_reference",
                                    "reference_param",
                                    "rule",
                                    "supported",
                                ],
                            },
                        },
                    },
                },
            },
        )

    def test_generate_image_reports_missing_secret_per_provider(self) -> None:
        cases = {
            "gemini": "GEMINI_API_KEY",
            "openai": "OPENAI_API_KEY",
            "replicate": "REPLICATE_API_TOKEN",
        }

        for provider, secret_name in cases.items():
            with self.subTest(provider=provider):
                with without_env(secret_name):
                    with self.assertRaises(ToolError) as raised:
                        asyncio.run(
                            generate_image(
                                {
                                    "provider": provider,
                                    "prompt": "A square social image.",
                                }
                            )
                        )

                self.assertEqual(raised.exception.error_kind, "missing_secret")
                self.assertEqual(raised.exception.details["secret_name"], secret_name)

    def test_generate_image_writes_mocked_success_per_provider(self) -> None:
        for provider in ("gemini", "openai", "replicate"):
            out_path = DEFAULT_OUTPUT_DIR / f"test-generate-{provider}-{uuid.uuid4().hex}.png"
            try:
                with self.subTest(provider=provider):
                    with mock.patch.object(tool_module, "_build_provider", return_value=object()):
                        with mock.patch.object(
                            tool_module,
                            "_call_provider",
                            new=AsyncMock(return_value=png_bytes()),
                        ):
                            result = asyncio.run(
                                generate_image(
                                    {
                                        "provider": provider,
                                        "prompt": "A square social image.",
                                        "out_path": str(out_path),
                                    }
                                )
                            )

                    self.assertTrue(result["ok"])
                    self.assertEqual(result["provider"], provider)
                    self.assertEqual(result["asset_format"], "square")
                    self.assertEqual(result["aspect_ratio"], ASSET_FORMATS["square"]["aspect_ratio"])
                    self.assertEqual(result["format"], "png")
                    self.assertEqual(result["image_format"], "png")
                    self.assertEqual(result["out_path"], str(out_path))
                    self.assertTrue(out_path.exists())
            finally:
                out_path.unlink(missing_ok=True)

    def test_generate_image_rejects_invalid_provider_output_bytes(self) -> None:
        with mock.patch.object(tool_module, "_build_provider", return_value=object()):
            with mock.patch.object(
                tool_module,
                "_call_provider",
                new=AsyncMock(return_value=b"not image bytes"),
            ):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(
                        generate_image(
                            {
                                "provider": "openai",
                                "prompt": "A square social image.",
                            }
                        )
                    )

        self.assertEqual(raised.exception.error_kind, "provider_error")

    def test_generate_image_rejects_unknown_asset_format(self) -> None:
        with self.assertRaises(ToolError) as raised:
            asyncio.run(
                generate_image(
                    {
                        "provider": "openai",
                        "prompt": "A square social image.",
                        "format": "banner",
                    }
                )
            )

        self.assertEqual(raised.exception.error_kind, "validation")
        self.assertEqual(raised.exception.details["field"], "format")

    def test_generate_image_allows_openai_story_format_with_latest_default(self) -> None:
        out_path = DEFAULT_OUTPUT_DIR / f"test-openai-story-{uuid.uuid4().hex}.png"
        try:
            with mock.patch.object(tool_module, "_build_provider", return_value=object()):
                with mock.patch.object(
                    tool_module,
                    "_call_provider",
                    new=AsyncMock(return_value=png_bytes()),
                ) as call_provider:
                    result = asyncio.run(
                        generate_image(
                            {
                                "provider": "openai",
                                "prompt": "A story image.",
                                "format": "story",
                                "out_path": str(out_path),
                            }
                        )
                    )

            self.assertTrue(result["ok"])
            self.assertEqual(result["model"], "gpt-image-2")
            self.assertEqual(result["asset_format"], "story")
            self.assertEqual(result["aspect_ratio"], "9:16")
            self.assertEqual(call_provider.await_args.kwargs["aspect_ratio"], "9:16")
        finally:
            out_path.unlink(missing_ok=True)

    def test_generate_image_rejects_openai_story_format_for_legacy_models(self) -> None:
        with self.assertRaises(ToolError) as raised:
            asyncio.run(
                generate_image(
                    {
                        "provider": "openai",
                        "prompt": "A story image.",
                        "model": "gpt-image-1.5",
                        "format": "story",
                    }
                )
            )

        self.assertEqual(raised.exception.error_kind, "unsupported_combo")
        self.assertEqual(raised.exception.details["format"], "story")

    def test_call_provider_passes_aspect_ratio_to_adapter(self) -> None:
        class FakeProvider:
            def __init__(self) -> None:
                self.aspect_ratio = None

            def generate_image(self, prompt, reference=None, model="photoreal", aspect_ratio=None):
                self.aspect_ratio = aspect_ratio
                return png_bytes()

        provider = FakeProvider()
        image_bytes = asyncio.run(
            _call_provider(
                provider,
                "A portrait social image.",
                [],
                "photoreal",
                aspect_ratio=ASSET_FORMATS["portrait"]["aspect_ratio"],
            )
        )

        self.assertEqual(image_bytes, png_bytes())
        self.assertEqual(provider.aspect_ratio, ASSET_FORMATS["portrait"]["aspect_ratio"])

    def test_generate_image_propagates_provider_timeout(self) -> None:
        with mock.patch.object(tool_module, "_build_provider", return_value=object()):
            with mock.patch.object(
                tool_module,
                "_call_provider",
                new=AsyncMock(
                    side_effect=ToolError(
                        "timeout",
                        "Provider call exceeded 120 seconds.",
                        {"timeout_seconds": 120},
                    )
                ),
            ):
                with self.assertRaises(ToolError) as raised:
                    asyncio.run(
                        generate_image(
                            {
                                "provider": "openai",
                                "prompt": "A square social image.",
                            }
                        )
                    )

        self.assertEqual(raised.exception.error_kind, "timeout")

    def test_compare_providers_enforces_specs_bound(self) -> None:
        specs = ["openai:photoreal"] * (MAX_COMPARE_SPECS + 1)

        with self.assertRaises(ToolError) as raised:
            asyncio.run(
                compare_providers(
                    {
                        "prompt": "A square social image.",
                        "specs": specs,
                    }
                )
            )

        self.assertEqual(raised.exception.error_kind, "validation")
        self.assertEqual(raised.exception.details["max_items"], MAX_COMPARE_SPECS)

    def test_compare_providers_returns_partial_failure_results(self) -> None:
        out_dir = DEFAULT_OUTPUT_DIR / f"test-compare-{uuid.uuid4().hex}"
        try:
            with mock.patch.object(tool_module, "_build_provider", return_value=object()):
                with mock.patch.object(
                    tool_module,
                    "_call_provider",
                    new=AsyncMock(
                        side_effect=[
                            png_bytes(),
                            ToolError(
                                "provider_error",
                                "provider rejected the request",
                                {"provider": "openai"},
                            ),
                        ]
                    ),
                ):
                    result = asyncio.run(
                        compare_providers(
                            {
                                "prompt": "A square social image.",
                                "specs": ["openai:photoreal", "openai:edit"],
                                "out_dir": str(out_dir),
                            }
                        )
                    )
        finally:
            shutil.rmtree(out_dir, ignore_errors=True)

        self.assertTrue(result["ok"])
        self.assertEqual(len(result["results"]), 2)
        self.assertTrue(result["results"][0]["ok"])
        self.assertEqual(result["asset_format"], "square")
        self.assertEqual(result["results"][0]["asset_format"], "square")
        self.assertEqual(result["results"][0]["image_format"], "png")
        self.assertFalse(result["results"][1]["ok"])
        self.assertEqual(
            result["results"][1]["error"]["error_kind"],
            "provider_error",
        )
        self.assertEqual(result["gallery_path"], str(out_dir / "index.html"))

    def test_openai_pil_reference_temp_file_is_removed(self) -> None:
        client = OpenAIClient(api_key="test-key")
        temp_paths: list[Path] = []

        def fake_edit(**kwargs):
            image = kwargs["image"]
            handles = image if isinstance(image, list) else [image]
            temp_paths.extend(Path(handle.name) for handle in handles)
            for temp_path in temp_paths:
                self.assertTrue(temp_path.exists())
            return SimpleNamespace(
                data=[
                    SimpleNamespace(
                        b64_json=base64.b64encode(png_bytes()).decode("ascii")
                    )
                ]
            )

        with mock.patch.object(client._client.images, "edit", side_effect=fake_edit):
            image_bytes = client.generate_image(
                "A square social image.",
                reference=Image.new("RGB", (2, 2), "white"),
                model="edit",
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertTrue(temp_paths)
        for temp_path in temp_paths:
            self.assertFalse(temp_path.exists())

    def test_openai_aspect_ratio_maps_to_supported_size(self) -> None:
        client = OpenAIClient(api_key="test-key")
        sizes: list[str] = []

        def fake_generate(**kwargs):
            sizes.append(kwargs["size"])
            return SimpleNamespace(
                data=[
                    SimpleNamespace(
                        b64_json=base64.b64encode(png_bytes()).decode("ascii")
                    )
                ]
            )

        with mock.patch.object(client._client.images, "generate", side_effect=fake_generate):
            image_bytes = client.generate_image(
                "A portrait social image.",
                model="photoreal",
                aspect_ratio=ASSET_FORMATS["portrait"]["aspect_ratio"],
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertEqual(sizes, ["1024x1536"])

    def test_openai_gpt_image_2_story_maps_to_supported_size(self) -> None:
        client = OpenAIClient(api_key="test-key")
        sizes: list[str] = []

        def fake_generate(**kwargs):
            sizes.append(kwargs["size"])
            return SimpleNamespace(
                data=[
                    SimpleNamespace(
                        b64_json=base64.b64encode(png_bytes()).decode("ascii")
                    )
                ]
            )

        with mock.patch.object(client._client.images, "generate", side_effect=fake_generate):
            image_bytes = client.generate_image(
                "A story social image.",
                model="photoreal",
                aspect_ratio=ASSET_FORMATS["story"]["aspect_ratio"],
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertEqual(sizes, ["1008x1792"])

    def test_gemini_aspect_ratio_is_sent_in_image_config(self) -> None:
        client = GeminiClient(api_key="test-key")
        aspect_ratios: list[str] = []

        def fake_generate_content(**kwargs):
            aspect_ratios.append(kwargs["config"].image_config.aspect_ratio)
            return SimpleNamespace(
                candidates=[
                    SimpleNamespace(
                        content=SimpleNamespace(
                            parts=[
                                SimpleNamespace(
                                    inline_data=SimpleNamespace(data=png_bytes())
                                )
                            ]
                        )
                    )
                ]
            )

        with mock.patch.object(
            client._client.models,
            "generate_content",
            side_effect=fake_generate_content,
        ):
            image_bytes = client.generate_image(
                "A story social image.",
                model="photoreal",
                aspect_ratio=ASSET_FORMATS["story"]["aspect_ratio"],
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertEqual(aspect_ratios, ["9:16"])

    def test_replicate_pil_reference_temp_file_is_removed(self) -> None:
        client = ReplicateClient(api_token="test-token")
        temp_paths: list[Path] = []

        def fake_run(_model_id, input):
            handles = input["input_images"]
            temp_paths.extend(Path(handle.name) for handle in handles)
            for handle in handles:
                self.assertFalse(handle.closed)
                self.assertTrue(Path(handle.name).exists())
            return BytesIO(png_bytes())

        with mock.patch.object(client._client, "run", side_effect=fake_run):
            image_bytes = client.generate_image(
                "A square social image.",
                reference=Image.new("RGB", (2, 2), "white"),
                model="edit",
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertTrue(temp_paths)
        for temp_path in temp_paths:
            self.assertFalse(temp_path.exists())

    def test_replicate_aspect_ratio_is_sent_to_verified_models(self) -> None:
        client = ReplicateClient(api_token="test-token")
        aspect_ratios: list[str] = []

        def fake_run(_model_id, input):
            aspect_ratios.append(input["aspect_ratio"])
            return BytesIO(png_bytes())

        with mock.patch.object(client._client, "run", side_effect=fake_run):
            image_bytes = client.generate_image(
                "A landscape thumbnail.",
                model="photoreal",
                aspect_ratio=ASSET_FORMATS["landscape"]["aspect_ratio"],
            )

        self.assertEqual(image_bytes, png_bytes())
        self.assertEqual(aspect_ratios, ["3:2"])


if __name__ == "__main__":
    unittest.main()
