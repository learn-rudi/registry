from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from errors import ToolError  # noqa: E402
from provider_runtime import ProviderAudio  # noqa: E402
from tools import generate_speech, list_speech_models, list_speech_voices  # noqa: E402
import outputs as output_module  # noqa: E402


class SpeechGeneratorToolsTest(unittest.TestCase):
    def test_model_discovery_is_static_and_reports_secret_readiness(self) -> None:
        secret_names = (
            "OPENAI_API_KEY",
            "ELEVENLABS_API_KEY",
            "GEMINI_API_KEY",
        )

        with mock.patch.dict(os.environ, {}, clear=False):
            for name in secret_names:
                os.environ.pop(name, None)
            result = list_speech_models({})

        self.assertTrue(result["ok"])
        self.assertEqual(set(result["providers"]), {"openai", "elevenlabs", "gemini"})
        self.assertEqual(
            result["providers"]["openai"]["default_model"],
            "gpt-4o-mini-tts",
        )
        self.assertEqual(
            result["providers"]["elevenlabs"]["default_model"],
            "eleven_multilingual_v2",
        )
        self.assertEqual(
            result["providers"]["gemini"]["default_model"],
            "gemini-3.1-flash-tts-preview",
        )
        for provider in result["providers"].values():
            self.assertFalse(provider["secret_status"]["configured"])

    def test_static_voice_discovery_does_not_require_provider_keys(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            os.environ.pop("GEMINI_API_KEY", None)
            openai = asyncio.run(list_speech_voices({"provider": "openai"}))
            gemini = asyncio.run(list_speech_voices({"provider": "gemini"}))

        self.assertTrue(openai["ok"])
        self.assertEqual(len(openai["voices"]), 13)
        self.assertIn("marin", {voice["id"] for voice in openai["voices"]})
        self.assertEqual(openai["source"], "static")
        self.assertEqual(len(gemini["voices"]), 30)
        kore = next(voice for voice in gemini["voices"] if voice["id"] == "Kore")
        self.assertEqual(kore["description"], "Firm")


class SpeechGeneratorAsyncToolsTest(unittest.IsolatedAsyncioTestCase):
    async def test_generation_rejects_output_outside_rudi_outputs_before_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            unsafe_path = Path(tmp) / "speech.mp3"

            with self.assertRaises(ToolError) as raised:
                await generate_speech(
                    {
                        "provider": "openai",
                        "text": "Hello from RUDI.",
                        "out_path": str(unsafe_path),
                    }
                )

        self.assertEqual(raised.exception.error_kind, "validation")
        self.assertIn("~/.rudi/outputs", raised.exception.message)

    async def test_elevenlabs_voice_discovery_uses_remote_paginated_inventory(self) -> None:
        page = {
            "voices": [{"id": "voice-123", "name": "Narrator"}],
            "has_more": True,
            "next_page_token": "next-token",
            "total_count": 101,
        }
        with (
            mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-eleven-key"}),
            mock.patch("tools.list_remote_voices", new=mock.AsyncMock(return_value=page)) as remote,
        ):
            result = await list_speech_voices(
                {
                    "provider": "elevenlabs",
                    "page_size": 25,
                    "next_page_token": "page-token",
                    "search": "warm",
                }
            )

        remote.assert_awaited_once_with(
            "test-eleven-key",
            page_size=25,
            next_page_token="page-token",
            search="warm",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["source"], "remote")
        self.assertEqual(result["next_page_token"], "next-token")

    async def test_generation_reports_actionable_provider_secret_requirement(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            with self.assertRaises(ToolError) as raised:
                await generate_speech({"provider": "openai", "text": "Hello from RUDI."})

        self.assertEqual(raised.exception.error_kind, "missing_secret")
        self.assertEqual(raised.exception.details["secret_name"], "OPENAI_API_KEY")
        self.assertIn("rudi secrets set OPENAI_API_KEY", raised.exception.details["remediation"])

    async def test_generation_writes_validated_audio_and_returns_stable_metadata(self) -> None:
        mp3_bytes = b"ID3" + (b"\x00" * 64)
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp)
            out_path = output_root / "narration.mp3"
            with (
                mock.patch.object(output_module, "DEFAULT_OUTPUT_DIR", output_root),
                mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}),
                mock.patch(
                    "tools.generate_with_provider",
                    new=mock.AsyncMock(
                        return_value=ProviderAudio(
                            audio_bytes=mp3_bytes,
                            request_id="request-123",
                        )
                    ),
                ),
            ):
                result = await generate_speech(
                    {
                        "provider": "openai",
                        "text": "Hello from RUDI.",
                        "out_path": str(out_path),
                    }
                )

            self.assertEqual(out_path.read_bytes(), mp3_bytes)

        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "openai")
        self.assertEqual(result["model"], "gpt-4o-mini-tts")
        self.assertEqual(result["voice"], "marin")
        self.assertEqual(result["format"], "mp3")
        self.assertEqual(result["provider_request_id"], "request-123")
        self.assertTrue(result["ai_generated"])
        self.assertEqual(result["disclosure_policy"], "context_dependent")
        self.assertTrue(result["disclosure_review_required"])
        self.assertNotIn("disclosure_required", result)

    async def test_provider_specific_capabilities_fail_before_dispatch(self) -> None:
        cases = [
            (
                {"provider": "gemini", "text": "Hello.", "format": "mp3"},
                "unsupported_combo",
            ),
            (
                {"provider": "elevenlabs", "text": "Hello."},
                "validation",
            ),
            (
                {
                    "provider": "openai",
                    "text": "Hello.",
                    "model": "tts-1",
                    "instructions": "Whisper.",
                },
                "unsupported_combo",
            ),
        ]
        dispatch = mock.AsyncMock()
        with (
            mock.patch.dict(
                os.environ,
                {
                    "OPENAI_API_KEY": "test-openai-key",
                    "ELEVENLABS_API_KEY": "test-eleven-key",
                    "GEMINI_API_KEY": "test-gemini-key",
                },
            ),
            mock.patch("tools.generate_with_provider", new=dispatch),
        ):
            for arguments, expected_kind in cases:
                with self.subTest(arguments=arguments):
                    with self.assertRaises(ToolError) as raised:
                        await generate_speech(arguments)
                    self.assertEqual(raised.exception.error_kind, expected_kind)

        dispatch.assert_not_awaited()

    async def test_invalid_provider_audio_is_not_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp)
            out_path = output_root / "invalid.mp3"
            with (
                mock.patch.object(output_module, "DEFAULT_OUTPUT_DIR", output_root),
                mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}),
                mock.patch(
                    "tools.generate_with_provider",
                    new=mock.AsyncMock(return_value=ProviderAudio(audio_bytes=b"not audio")),
                ),
            ):
                with self.assertRaises(ToolError) as raised:
                    await generate_speech(
                        {
                            "provider": "openai",
                            "text": "Hello from RUDI.",
                            "out_path": str(out_path),
                        }
                    )

            self.assertFalse(out_path.exists())

        self.assertEqual(raised.exception.error_kind, "invalid_audio")


if __name__ == "__main__":
    unittest.main()
