#!/usr/bin/env python3
"""
Local Whisper MCP Server

Transcribe audio locally using faster-whisper.
No API key needed - runs entirely on your machine.

Models download automatically on first use (~75MB - 1.5GB depending on size).
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime

# MCP protocol
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

# Whisper
from faster_whisper import WhisperModel

# ============================================================================
# CONFIGURATION
# ============================================================================

DEFAULT_OUTPUT_DIR = Path.home() / ".prompt-stack" / "output"
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")  # int8, float16, float32

# Model sizes and approximate VRAM/RAM requirements
MODELS = {
    "tiny": {"params": "39M", "english_only": "tiny.en", "multilingual": "tiny", "vram": "~1GB"},
    "base": {"params": "74M", "english_only": "base.en", "multilingual": "base", "vram": "~1GB"},
    "small": {"params": "244M", "english_only": "small.en", "multilingual": "small", "vram": "~2GB"},
    "medium": {"params": "769M", "english_only": "medium.en", "multilingual": "medium", "vram": "~5GB"},
    "large-v3": {"params": "1550M", "english_only": None, "multilingual": "large-v3", "vram": "~10GB"},
}

# Cached model instance
_model_cache: dict = {}


def get_model(model_size: str = DEFAULT_MODEL) -> WhisperModel:
    """Get or load a Whisper model (cached)."""
    if model_size not in _model_cache:
        print(f"Loading Whisper model: {model_size} (compute_type={COMPUTE_TYPE})", file=sys.stderr)
        _model_cache[model_size] = WhisperModel(
            model_size,
            device="auto",  # Use GPU if available, else CPU
            compute_type=COMPUTE_TYPE,
        )
    return _model_cache[model_size]


def expand_path(p: str) -> Path:
    """Expand ~ and make absolute."""
    return Path(p).expanduser().resolve()


def generate_filename(prefix: str, ext: str) -> str:
    """Generate timestamped filename."""
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    return f"{prefix}-{ts}.{ext}"


def ensure_output_dir():
    """Ensure output directory exists."""
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================================
# TRANSCRIPTION
# ============================================================================

def transcribe_audio(
    audio_path: str,
    model_size: str = DEFAULT_MODEL,
    language: str | None = None,
    task: str = "transcribe",  # or "translate" to translate to English
    word_timestamps: bool = False,
    output: str | None = None,
    output_format: str = "txt",  # txt, srt, vtt, json
) -> dict:
    """
    Transcribe an audio file using faster-whisper.

    Returns:
        dict with text, segments, language, duration, output_path
    """
    path = expand_path(audio_path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {path}")

    model = get_model(model_size)

    # Transcribe
    segments, info = model.transcribe(
        str(path),
        language=language,
        task=task,
        word_timestamps=word_timestamps,
        vad_filter=True,  # Filter out silence
    )

    # Collect segments
    segment_list = []
    full_text_parts = []

    for segment in segments:
        seg_data = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        if word_timestamps and segment.words:
            seg_data["words"] = [
                {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                for w in segment.words
            ]
        segment_list.append(seg_data)
        full_text_parts.append(segment.text.strip())

    full_text = " ".join(full_text_parts)

    result = {
        "text": full_text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": segment_list,
        "model": model_size,
    }

    # Save output if requested
    if output:
        ensure_output_dir()
        output_path = expand_path(output)

        # If output is a directory, generate filename
        if output_path.is_dir():
            output_path = output_path / generate_filename("transcript", output_format)

        if output_format == "txt":
            output_path.write_text(full_text, encoding="utf-8")
        elif output_format == "json":
            output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        elif output_format == "srt":
            output_path.write_text(segments_to_srt(segment_list), encoding="utf-8")
        elif output_format == "vtt":
            output_path.write_text(segments_to_vtt(segment_list), encoding="utf-8")

        result["output_path"] = str(output_path)

    return result


def segments_to_srt(segments: list) -> str:
    """Convert segments to SRT subtitle format."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = format_timestamp_srt(seg["start"])
        end = format_timestamp_srt(seg["end"])
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def segments_to_vtt(segments: list) -> str:
    """Convert segments to WebVTT subtitle format."""
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = format_timestamp_vtt(seg["start"])
        end = format_timestamp_vtt(seg["end"])
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def format_timestamp_srt(seconds: float) -> str:
    """Format seconds as SRT timestamp (HH:MM:SS,mmm)."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_timestamp_vtt(seconds: float) -> str:
    """Format seconds as WebVTT timestamp (HH:MM:SS.mmm)."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


# ============================================================================
# MCP SERVER
# ============================================================================

server = Server("whisper")


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="whisper_transcribe",
            description="Transcribe audio/video to text using local Whisper. Supports many formats (mp3, wav, m4a, mp4, webm, etc). Models download automatically on first use.",
            inputSchema={
                "type": "object",
                "properties": {
                    "audio_path": {
                        "type": "string",
                        "description": "Path to audio/video file to transcribe",
                    },
                    "model": {
                        "type": "string",
                        "enum": ["tiny", "base", "small", "medium", "large-v3"],
                        "description": "Model size (default: base). Larger = more accurate but slower. tiny/base for quick transcription, medium/large for accuracy.",
                    },
                    "language": {
                        "type": "string",
                        "description": "Language code (e.g., 'en', 'es', 'fr'). Auto-detected if not specified.",
                    },
                    "task": {
                        "type": "string",
                        "enum": ["transcribe", "translate"],
                        "description": "transcribe = keep original language, translate = translate to English",
                    },
                    "word_timestamps": {
                        "type": "boolean",
                        "description": "Include word-level timestamps (useful for subtitles)",
                    },
                    "output": {
                        "type": "string",
                        "description": "Path to save transcript (optional)",
                    },
                    "output_format": {
                        "type": "string",
                        "enum": ["txt", "srt", "vtt", "json"],
                        "description": "Output format: txt (plain text), srt/vtt (subtitles), json (full data)",
                    },
                },
                "required": ["audio_path"],
            },
        ),
        types.Tool(
            name="whisper_list_models",
            description="List available Whisper models with their sizes and requirements",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    try:
        if name == "whisper_transcribe":
            result = transcribe_audio(
                audio_path=arguments["audio_path"],
                model_size=arguments.get("model", DEFAULT_MODEL),
                language=arguments.get("language"),
                task=arguments.get("task", "transcribe"),
                word_timestamps=arguments.get("word_timestamps", False),
                output=arguments.get("output"),
                output_format=arguments.get("output_format", "txt"),
            )

            # Format response
            text_parts = [
                f"Transcription ({result['model']} model):",
                f"Language: {result['language']} ({result['language_probability']:.0%} confidence)",
                f"Duration: {result['duration']:.1f}s",
                "",
                result["text"],
            ]

            if result.get("output_path"):
                text_parts.insert(0, f"Saved to: {result['output_path']}")
                text_parts.insert(1, "")

            return [types.TextContent(type="text", text="\n".join(text_parts))]

        elif name == "whisper_list_models":
            lines = ["Available Whisper Models:", ""]
            for name, info in MODELS.items():
                lines.append(f"  {name}:")
                lines.append(f"    Parameters: {info['params']}")
                lines.append(f"    VRAM/RAM: {info['vram']}")
                if info['english_only']:
                    lines.append(f"    English-only: {info['english_only']}")
                lines.append(f"    Multilingual: {info['multilingual']}")
                lines.append("")

            lines.append(f"Current default: {DEFAULT_MODEL}")
            lines.append(f"Compute type: {COMPUTE_TYPE}")
            lines.append("")
            lines.append("Set WHISPER_MODEL env var to change default.")
            lines.append("Set WHISPER_COMPUTE_TYPE to: int8 (fast), float16 (GPU), float32 (CPU accurate)")

            return [types.TextContent(type="text", text="\n".join(lines))]

        else:
            return [types.TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [types.TextContent(type="text", text=f"Error: {str(e)}")]


# ============================================================================
# MAIN
# ============================================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
