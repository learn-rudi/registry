from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


ROOT = Path(__file__).resolve().parents[1]


class SpeechGeneratorMcpStdioTest(unittest.IsolatedAsyncioTestCase):
    async def test_tools_and_static_discovery_over_stdio(self) -> None:
        params = StdioServerParameters(
            command=sys.executable,
            args=["src/server.py"],
            cwd=ROOT,
        )

        with open(os.devnull, "w", encoding="utf-8") as errlog:
            async with stdio_client(params, errlog=errlog) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    tool_names = {tool.name for tool in tools.tools}
                    self.assertEqual(
                        tool_names,
                        {"list_speech_models", "list_speech_voices", "generate_speech"},
                    )
                    for tool in tools.tools:
                        self.assertFalse(tool.inputSchema["additionalProperties"])
                    generate_tool = next(
                        tool for tool in tools.tools if tool.name == "generate_speech"
                    )
                    self.assertIn("voice-use authorization", generate_tool.description)
                    self.assertIn("not verified by this stack", generate_tool.description)

                    result = await session.call_tool("list_speech_models", {})

        self.assertEqual(len(result.content), 1)
        payload = json.loads(result.content[0].text)
        self.assertTrue(payload["ok"])
        self.assertEqual(set(payload["providers"]), {"openai", "elevenlabs", "gemini"})


if __name__ == "__main__":
    unittest.main()
