"""Static speech model and built-in voice capability metadata."""

from __future__ import annotations


OPENAI_ALL_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
)

OPENAI_LEGACY_VOICES = (
    "alloy",
    "ash",
    "coral",
    "echo",
    "fable",
    "onyx",
    "nova",
    "sage",
    "shimmer",
)

GEMINI_VOICES = {
    "Zephyr": "Bright",
    "Puck": "Upbeat",
    "Charon": "Informative",
    "Kore": "Firm",
    "Fenrir": "Excitable",
    "Leda": "Youthful",
    "Orus": "Firm",
    "Aoede": "Breezy",
    "Callirrhoe": "Easy-going",
    "Autonoe": "Bright",
    "Enceladus": "Breathy",
    "Iapetus": "Clear",
    "Umbriel": "Easy-going",
    "Algieba": "Smooth",
    "Despina": "Smooth",
    "Erinome": "Clear",
    "Algenib": "Gravelly",
    "Rasalgethi": "Informative",
    "Laomedeia": "Upbeat",
    "Achernar": "Soft",
    "Alnilam": "Firm",
    "Schedar": "Even",
    "Gacrux": "Mature",
    "Pulcherrima": "Forward",
    "Achird": "Friendly",
    "Zubenelgenubi": "Casual",
    "Vindemiatrix": "Gentle",
    "Sadachbia": "Lively",
    "Sadaltager": "Knowledgeable",
    "Sulafat": "Warm",
}

MODEL_CONFIG = {
    "openai": {
        "default_model": "gpt-4o-mini-tts",
        "default_voice": "marin",
        "default_format": "mp3",
        "voice_source": "static",
        "models": {
            "gpt-4o-mini-tts": {
                "status": "stable",
                "formats": ("mp3", "wav", "opus", "aac", "flac", "pcm"),
                "voices": OPENAI_ALL_VOICES,
                "supports_instructions": True,
                "speed_range": (0.25, 4.0),
            },
            "tts-1": {
                "status": "legacy",
                "formats": ("mp3", "wav", "opus", "aac", "flac", "pcm"),
                "voices": OPENAI_LEGACY_VOICES,
                "supports_instructions": False,
                "speed_range": (0.25, 4.0),
            },
            "tts-1-hd": {
                "status": "legacy",
                "formats": ("mp3", "wav", "opus", "aac", "flac", "pcm"),
                "voices": OPENAI_LEGACY_VOICES,
                "supports_instructions": False,
                "speed_range": (0.25, 4.0),
            },
        },
    },
    "elevenlabs": {
        "default_model": "eleven_multilingual_v2",
        "default_voice": None,
        "default_format": "mp3",
        "voice_source": "remote",
        "models": {
            "eleven_multilingual_v2": {
                "status": "stable",
                "formats": ("mp3", "wav"),
                "supports_instructions": False,
                "speed_range": (0.7, 1.2),
            },
            "eleven_flash_v2_5": {
                "status": "stable",
                "formats": ("mp3", "wav"),
                "supports_instructions": False,
                "speed_range": (0.7, 1.2),
            },
            "eleven_turbo_v2_5": {
                "status": "stable",
                "formats": ("mp3", "wav"),
                "supports_instructions": False,
                "speed_range": (0.7, 1.2),
            },
            "eleven_v3": {
                "status": "stable",
                "formats": ("mp3", "wav"),
                "supports_instructions": False,
                "speed_range": (0.7, 1.2),
            },
        },
        "format_ids": {
            "mp3": "mp3_44100_128",
            "wav": "wav_44100",
        },
        "format_notes": {
            "wav": "ElevenLabs WAV 44.1 kHz output may require a Pro-tier plan.",
        },
    },
    "gemini": {
        "default_model": "gemini-3.1-flash-tts-preview",
        "default_voice": "Kore",
        "default_format": "wav",
        "voice_source": "static",
        "models": {
            "gemini-3.1-flash-tts-preview": {
                "status": "preview",
                "formats": ("wav",),
                "voices": tuple(GEMINI_VOICES),
                "supports_instructions": True,
                "speed_range": None,
            },
            "gemini-2.5-flash-preview-tts": {
                "status": "preview",
                "formats": ("wav",),
                "voices": tuple(GEMINI_VOICES),
                "supports_instructions": True,
                "speed_range": None,
            },
            "gemini-2.5-pro-preview-tts": {
                "status": "preview",
                "formats": ("wav",),
                "voices": tuple(GEMINI_VOICES),
                "supports_instructions": True,
                "speed_range": None,
            },
        },
        "audio_encoding": {
            "format": "wav",
            "source": "24 kHz, 16-bit signed mono PCM wrapped by the stack",
        },
    },
}
