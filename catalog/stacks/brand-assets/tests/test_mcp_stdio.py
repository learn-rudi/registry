import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from test_core import ONE_BY_ONE_PNG


ROOT = Path(__file__).resolve().parents[1]


class BrandAssetsMcpStdioTest(unittest.TestCase):
    def test_tool_surface_and_read_only_inspection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "candidate.png"
            source.write_bytes(ONE_BY_ONE_PNG)
            process = subprocess.Popen(
                [sys.executable, "src/server.py"],
                cwd=ROOT,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            def request(request_id: int, method: str, params: dict) -> dict:
                assert process.stdin is not None
                assert process.stdout is not None
                process.stdin.write(
                    json.dumps({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        "params": params,
                    })
                    + "\n"
                )
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                return response["result"]

            try:
                request(
                    1,
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "test", "version": "1"},
                    },
                )
                assert process.stdin is not None
                process.stdin.write(
                    json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})
                    + "\n"
                )
                process.stdin.flush()
                listed = request(2, "tools/list", {})
                self.assertEqual(
                    {tool["name"] for tool in listed["tools"]},
                    {
                        "inspect_brand_source",
                        "trace_brand_asset",
                        "compose_brand_variant",
                        "validate_brand_asset",
                    },
                )
                called = request(
                    3,
                    "tools/call",
                    {
                        "name": "inspect_brand_source",
                        "arguments": {"source_path": str(source)},
                    },
                )
            finally:
                process.terminate()
                process.wait(timeout=2)
                if process.stdin is not None:
                    process.stdin.close()
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()

            payload = json.loads(called["content"][0]["text"])
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["format"], "png")
            self.assertEqual(payload["width"], 1)
            self.assertEqual(source.read_bytes(), ONE_BY_ONE_PNG)


if __name__ == "__main__":
    unittest.main()
