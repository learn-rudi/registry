from __future__ import annotations

import base64
import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from http_client import HttpResponse  # noqa: E402
from providers.elevenlabs import generate as generate_elevenlabs, list_voices  # noqa: E402
from providers.gemini import generate as generate_gemini  # noqa: E402
from providers.openai import generate as generate_openai  # noqa: E402
import provider_runtime  # noqa: E402
from provider_types import ProviderAudio  # noqa: E402
from validation import SpeechRequest  # noqa: E402


class SpeechProviderAdaptersTest(unittest.TestCase):
    def test_openai_adapter_maps_the_portable_speech_request(self) -> None:
        captured: dict[str, object] = {}

        def fake_request(**kwargs: object) -> HttpResponse:
            captured.update(kwargs)
            return HttpResponse(
                body=b"ID3" + (b"\x00" * 64),
                headers={"x-request-id": "openai-request-123"},
                status=200,
            )

        request = SpeechRequest(
            provider="openai",
            text="Hello from RUDI.",
            model="gpt-4o-mini-tts",
            voice="marin",
            audio_format="mp3",
            instructions="Warm and conversational.",
            speed=1.1,
            language_code=None,
            out_path=Path("/tmp/not-written.mp3"),
        )

        result = generate_openai(request, "secret-openai-key", request_fn=fake_request)

        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["url"], "https://api.openai.com/v1/audio/speech")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer secret-openai-key")
        self.assertEqual(
            captured["payload"],
            {
                "model": "gpt-4o-mini-tts",
                "input": "Hello from RUDI.",
                "voice": "marin",
                "response_format": "mp3",
                "instructions": "Warm and conversational.",
                "speed": 1.1,
            },
        )
        self.assertEqual(result.request_id, "openai-request-123")

    def test_elevenlabs_adapter_uses_voice_path_and_provider_specific_controls(self) -> None:
        captured: dict[str, object] = {}

        def fake_request(**kwargs: object) -> HttpResponse:
            captured.update(kwargs)
            return HttpResponse(
                body=b"ID3" + (b"\x00" * 64),
                headers={"request-id": "eleven-request-123"},
                status=200,
            )

        request = SpeechRequest(
            provider="elevenlabs",
            text="Hello from RUDI.",
            model="eleven_multilingual_v2",
            voice="voice/id",
            audio_format="mp3",
            instructions=None,
            speed=1.1,
            language_code="en",
            out_path=Path("/tmp/not-written.mp3"),
        )

        result = generate_elevenlabs(request, "secret-eleven-key", request_fn=fake_request)

        self.assertEqual(captured["method"], "POST")
        self.assertEqual(
            captured["url"],
            "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=mp3_44100_128",
        )
        self.assertEqual(captured["headers"]["xi-api-key"], "secret-eleven-key")
        self.assertEqual(
            captured["payload"],
            {
                "text": "Hello from RUDI.",
                "model_id": "eleven_multilingual_v2",
                "language_code": "en",
                "voice_settings": {"speed": 1.1},
            },
        )
        self.assertEqual(result.request_id, "eleven-request-123")

    def test_elevenlabs_voice_discovery_is_paginated_and_sanitized(self) -> None:
        captured: dict[str, object] = {}

        def fake_request(**kwargs: object) -> HttpResponse:
            captured.update(kwargs)
            body = json.dumps(
                {
                    "voices": [
                        {
                            "voice_id": "voice-123",
                            "name": "Narrator",
                            "description": "Warm narration",
                            "category": "premade",
                            "labels": {"accent": "American"},
                            "is_owner": False,
                            "sharing": {"public_owner_id": "must-not-leak"},
                        },
                        {
                            "voice_id": "voice-456",
                            "name": "Malformed owner flag",
                            "is_owner": "false",
                        }
                    ],
                    "has_more": True,
                    "next_page_token": "next-token",
                    "total_count": 101,
                }
            ).encode("utf-8")
            return HttpResponse(body=body, headers={}, status=200)

        result = list_voices(
            "secret-eleven-key",
            page_size=25,
            next_page_token="page-token",
            search="warm",
            request_fn=fake_request,
        )

        self.assertEqual(captured["method"], "GET")
        self.assertIn("page_size=25", captured["url"])
        self.assertIn("next_page_token=page-token", captured["url"])
        self.assertIn("search=warm", captured["url"])
        self.assertEqual(captured["headers"]["xi-api-key"], "secret-eleven-key")
        self.assertEqual(
            result["voices"],
            [
                {
                    "id": "voice-123",
                    "name": "Narrator",
                    "description": "Warm narration",
                    "category": "premade",
                    "labels": {"accent": "American"},
                    "provider_reported_is_owner": False,
                },
                {
                    "id": "voice-456",
                    "name": "Malformed owner flag",
                    "description": None,
                    "category": None,
                    "labels": {},
                    "provider_reported_is_owner": None,
                }
            ],
        )
        self.assertNotIn("sharing", result["voices"][0])
        self.assertEqual(result["next_page_token"], "next-token")

    def test_gemini_adapter_wraps_returned_pcm_as_wav(self) -> None:
        captured: dict[str, object] = {}
        pcm_bytes = b"\x00\x01" * 100

        def fake_request(**kwargs: object) -> HttpResponse:
            captured.update(kwargs)
            body = json.dumps(
                {
                    "steps": [
                        {
                            "type": "model_output",
                            "status": "done",
                            "content": [
                                {
                                    "type": "audio",
                                    "data": base64.b64encode(pcm_bytes).decode("ascii"),
                                    "mime_type": "audio/l16",
                                    "sample_rate": 24_000,
                                    "channels": 1,
                                }
                            ],
                        }
                    ]
                }
            ).encode("utf-8")
            return HttpResponse(
                body=body,
                headers={"x-goog-request-id": "gemini-request-123"},
                status=200,
            )

        request = SpeechRequest(
            provider="gemini",
            text="Hello from RUDI.",
            model="gemini-3.1-flash-tts-preview",
            voice="Kore",
            audio_format="wav",
            instructions="Warm and conversational.",
            speed=None,
            language_code=None,
            out_path=Path("/tmp/not-written.wav"),
        )

        result = generate_gemini(request, "secret-gemini-key", request_fn=fake_request)

        self.assertEqual(captured["method"], "POST")
        self.assertEqual(
            captured["url"],
            "https://generativelanguage.googleapis.com/v1beta/interactions",
        )
        self.assertEqual(captured["headers"]["x-goog-api-key"], "secret-gemini-key")
        self.assertEqual(captured["payload"]["model"], "gemini-3.1-flash-tts-preview")
        self.assertIn("Read only the transcript", captured["payload"]["input"])
        self.assertEqual(
            captured["payload"]["generation_config"],
            {"speech_config": [{"voice": "Kore"}]},
        )
        self.assertEqual(result.audio_bytes[:4], b"RIFF")
        self.assertEqual(result.audio_bytes[8:12], b"WAVE")
        self.assertEqual(result.request_id, "gemini-request-123")


class SpeechProviderRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def test_runtime_dispatches_the_selected_provider_adapter(self) -> None:
        request = SpeechRequest(
            provider="openai",
            text="Hello from RUDI.",
            model="gpt-4o-mini-tts",
            voice="marin",
            audio_format="mp3",
            instructions=None,
            speed=None,
            language_code=None,
            out_path=Path("/tmp/not-written.mp3"),
        )
        fake_adapter = mock.Mock(
            return_value=ProviderAudio(audio_bytes=b"ID3" + (b"\x00" * 64))
        )

        with mock.patch.dict(provider_runtime.ADAPTERS, {"openai": fake_adapter}):
            result = await provider_runtime.generate_with_provider(request, "secret-key")

        fake_adapter.assert_called_once_with(request, "secret-key")
        self.assertTrue(result.audio_bytes.startswith(b"ID3"))


if __name__ == "__main__":
    unittest.main()
