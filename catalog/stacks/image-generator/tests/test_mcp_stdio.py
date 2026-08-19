from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


ROOT = Path(__file__).resolve().parents[1]


class ImageGeneratorMcpStdioTest(unittest.IsolatedAsyncioTestCase):
    async def test_list_tools_and_list_models_over_stdio(self) -> None:
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
                        {
                            "generate_image",
                            "compare_providers",
                            "list_models",
                            "midjourney_session_status",
                            "midjourney_login",
                            "midjourney_generate",
                            "midjourney_export_job",
                        },
                    )
                    midjourney_generate = next(
                        tool for tool in tools.tools if tool.name == "midjourney_generate"
                    )
                    midjourney_login = next(
                        tool for tool in tools.tools if tool.name == "midjourney_login"
                    )
                    self.assertIn(
                        "return as soon as the browser is ready",
                        midjourney_login.description,
                    )
                    self.assertIn(
                        "backward compatibility",
                        midjourney_login.inputSchema["properties"]["timeout_seconds"][
                            "description"
                        ],
                    )
                    properties = midjourney_generate.inputSchema["properties"]
                    self.assertTrue(
                        {
                            "aspect_ratio",
                            "stylization",
                            "weirdness",
                            "variety",
                            "model_version",
                            "resolution",
                            "raw",
                            "speed",
                            "image_prompts",
                            "style_references",
                            "omni_reference",
                            "image_weight",
                            "style_weight",
                            "omni_weight",
                        }.issubset(properties)
                    )
                    self.assertEqual(properties["stylization"]["maximum"], 1000)
                    self.assertEqual(properties["weirdness"]["maximum"], 3000)
                    self.assertEqual(properties["variety"]["maximum"], 100)
                    self.assertEqual(properties["resolution"]["enum"], ["sd", "hd"])
                    self.assertEqual(
                        properties["speed"]["enum"],
                        ["fast", "relax", "turbo"],
                    )
                    self.assertEqual(properties["image_prompts"]["maxItems"], 4)
                    self.assertEqual(properties["style_references"]["maxItems"], 4)
                    self.assertEqual(properties["image_weight"]["maximum"], 3)
                    self.assertEqual(properties["style_weight"]["maximum"], 1000)
                    self.assertEqual(properties["omni_weight"]["minimum"], 1)

                    result = await session.call_tool("list_models", {})

        self.assertEqual(len(result.content), 1)
        payload = json.loads(result.content[0].text)
        self.assertTrue(payload["ok"])
        self.assertIn("gemini", payload["providers"])
        self.assertIn("secret_status", payload["providers"]["openai"])


if __name__ == "__main__":
    unittest.main()
