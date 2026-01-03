#!/usr/bin/env python3
"""
Google AI Studio MCP Server

Exposes Gemini, Imagen, and Veo as tools for Claude Code.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Initialize server
server = Server("google-ai")

# Stack directory
STACK_DIR = Path(__file__).parent
OUTPUT_DIR = STACK_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="generate_image",
            description="Generate an image using Google AI (Gemini/Imagen). Returns the file path of the generated image.",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Text description of the image to generate"},
                    "model": {
                        "type": "string",
                        "description": "Model to use: nano-banana (fast), nano-banana-pro (quality), imagen4-fast, imagen4-standard, imagen4-ultra (best)",
                        "enum": ["nano-banana", "nano-banana-pro", "imagen4-fast", "imagen4-standard", "imagen4-ultra"],
                        "default": "nano-banana",
                    },
                    "aspect": {
                        "type": "string",
                        "description": "Aspect ratio",
                        "enum": ["1:1", "3:4", "4:3", "9:16", "16:9"],
                        "default": "16:9",
                    },
                    "output": {"type": "string", "description": "Output file path (optional, auto-generated if not provided)"},
                },
                "required": ["prompt"],
            },
        ),
        Tool(
            name="generate_video",
            description="Generate a video using Google AI (Veo). Returns the file path of the generated video.",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Text description of the video to generate"},
                    "fast": {"type": "boolean", "description": "Use fast generation mode", "default": False},
                    "output": {"type": "string", "description": "Output file path (optional, auto-generated if not provided)"},
                },
                "required": ["prompt"],
            },
        ),
    ]


# =============================================================================
# TOOL HANDLERS
# =============================================================================

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        if name == "generate_image":
            prompt = arguments["prompt"]
            model = arguments.get("model", "nano-banana")
            aspect = arguments.get("aspect", "16:9")

            # Generate output path if not provided
            output = arguments.get("output")
            if not output:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                safe_prompt = "".join(c if c.isalnum() else "_" for c in prompt[:30])
                output = str(OUTPUT_DIR / f"{safe_prompt}_{timestamp}.png")

            # Run the generation command
            cmd = [
                "node",
                str(STACK_DIR / "src" / "commands" / "generateImage.js"),
                prompt,
                "--model", model,
                "--aspect", aspect,
                "--output", output,
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(STACK_DIR),
                env={**os.environ},
            )

            if result.returncode == 0:
                return [TextContent(
                    type="text",
                    text=f"Image generated successfully!\nFile: {output}\nModel: {model}\nPrompt: {prompt}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"Image generation failed:\n{result.stderr or result.stdout}"
                )]

        elif name == "generate_video":
            prompt = arguments["prompt"]
            fast = arguments.get("fast", False)

            # Generate output path if not provided
            output = arguments.get("output")
            if not output:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                safe_prompt = "".join(c if c.isalnum() else "_" for c in prompt[:30])
                output = str(OUTPUT_DIR / f"{safe_prompt}_{timestamp}.mp4")

            # Run the generation command
            cmd = [
                "node",
                str(STACK_DIR / "src" / "commands" / "generateVideo.js"),
                prompt,
                "--output", output,
            ]
            if fast:
                cmd.append("--fast")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(STACK_DIR),
                env={**os.environ},
            )

            if result.returncode == 0:
                return [TextContent(
                    type="text",
                    text=f"Video generated successfully!\nFile: {output}\nPrompt: {prompt}"
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"Video generation failed:\n{result.stderr or result.stdout}"
                )]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


# =============================================================================
# MAIN
# =============================================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
