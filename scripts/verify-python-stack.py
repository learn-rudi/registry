#!/usr/bin/env python3

import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time

RESPONSE_TIMEOUT_SECONDS = 15
MAX_STDERR_CHARS = 1024 * 1024
FORWARDED_ENV_KEYS = (
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
)


def require_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def child_environment(isolated_home, rudi_home):
    environment = {
        key: os.environ[key]
        for key in FORWARDED_ENV_KEYS
        if key in os.environ
    }
    environment.update(
        {
            "HOME": isolated_home,
            "RUDI_HOME": rudi_home,
            "CI": "true",
            "RUDI_VERIFY_OFFLINE": "1",
            "RUDI_VERIFY_SESSION": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return environment


def verification_state():
    if os.environ.get("RUDI_VERIFY_SESSION") == "1":
        home = Path(require_string(os.environ.get("HOME"), "session HOME")).resolve()
        rudi_home = Path(
            require_string(os.environ.get("RUDI_HOME"), "session RUDI_HOME")
        ).resolve()
        if rudi_home != home / ".rudi":
            raise ValueError("session RUDI_HOME must be HOME/.rudi")
        return str(home), str(rudi_home), None

    temporary_home = tempfile.TemporaryDirectory(prefix="rudi-python-contract-")
    home = Path(temporary_home.name).resolve()
    return str(home), str(home / ".rudi"), temporary_home


UNITTEST_RUNNER = """
import sys
import unittest

package_id = sys.argv[1]
suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
if suite.countTestCases() == 0:
    print(f"[{package_id}] Python package tests contain zero discoverable test cases", file=sys.stderr)
    raise SystemExit(5)
result = unittest.TextTestRunner().run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
"""


def contained_cwd(stack_root, configured_cwd):
    cwd = (stack_root / configured_cwd).resolve()
    if os.path.commonpath((str(stack_root), str(cwd))) != str(stack_root):
        raise ValueError(f"MCP cwd escapes the stack package: {configured_cwd}")
    return cwd


def stream_lines(stream, output_queue):
    for line in stream:
        output_queue.put(line)


def capture_stderr(stream, chunks):
    for chunk in stream:
        chunks.append(chunk)
        while sum(len(value) for value in chunks) > MAX_STDERR_CHARS:
            chunks.pop(0)


def verify():
    stack_root = Path.cwd().resolve()
    manifest = json.loads((stack_root / "manifest.json").read_text(encoding="utf-8"))
    package_id = require_string(manifest.get("id"), "manifest.id")
    if manifest.get("kind") != "stack" or manifest.get("runtime") != "python":
        raise ValueError(f"[{package_id}] Expected a Python stack manifest")

    mcp = manifest.get("mcp") or {}
    if mcp.get("transport") != "stdio":
        raise ValueError(f"[{package_id}] Generic Python verification requires stdio MCP")
    expected_tools = (manifest.get("provides") or {}).get("tools")
    if (
        not isinstance(expected_tools, list)
        or not expected_tools
        or any(not isinstance(tool, str) or not tool for tool in expected_tools)
        or len(set(expected_tools)) != len(expected_tools)
    ):
        raise ValueError(f"[{package_id}] Manifest requires unique provides.tools names")

    command = require_string(mcp.get("command"), "manifest.mcp.command")
    configured_args = mcp.get("args")
    if not isinstance(configured_args, list) or any(
        not isinstance(arg, str) for arg in configured_args
    ):
        raise ValueError(f"[{package_id}] manifest.mcp.args must be a string array")
    executable = sys.executable if command in ("python", "python3") else command
    cwd = contained_cwd(stack_root, mcp.get("cwd", "."))

    isolated_home, rudi_home, temporary_home = verification_state()
    try:
        tests_dir = stack_root / "tests"
        if tests_dir.is_dir() and any(tests_dir.rglob("test_*.py")):
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    UNITTEST_RUNNER,
                    package_id,
                ],
                cwd=stack_root,
                env=child_environment(isolated_home, rudi_home),
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError(
                    f"[{package_id}] Python package tests exited with "
                    f"code {completed.returncode}"
                )

        process = subprocess.Popen(
            [executable, *configured_args],
            cwd=cwd,
            env=child_environment(isolated_home, rudi_home),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        stdout_lines = queue.Queue()
        stderr_chunks = []
        threading.Thread(
            target=stream_lines,
            args=(process.stdout, stdout_lines),
            daemon=True,
        ).start()
        threading.Thread(
            target=capture_stderr,
            args=(process.stderr, stderr_chunks),
            daemon=True,
        ).start()
        next_id = 1

        def request(method, params):
            nonlocal next_id
            request_id = next_id
            next_id += 1
            process.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        "params": params,
                    }
                )
                + "\n"
            )
            process.stdin.flush()
            deadline = time.monotonic() + RESPONSE_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                try:
                    line = stdout_lines.get(timeout=0.1)
                except queue.Empty:
                    if process.poll() is not None:
                        raise RuntimeError(
                            f"[{package_id}] MCP exited before {method}; "
                            f"code={process.returncode}. stderr: {''.join(stderr_chunks)}"
                        )
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if message.get("id") != request_id:
                    continue
                if message.get("error"):
                    raise RuntimeError(
                        f"[{package_id}] {method} failed: "
                        f"{json.dumps(message['error'], separators=(',', ':'))}"
                    )
                return message.get("result")
            raise TimeoutError(
                f"[{package_id}] Timed out waiting for {method}. "
                f"stderr: {''.join(stderr_chunks)}"
            )

        try:
            request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "rudi-stack-verifier",
                        "version": "1.0.0",
                    },
                },
            )
            process.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "notifications/initialized",
                    }
                )
                + "\n"
            )
            process.stdin.flush()
            listed = request("tools/list", {}) or {}
            tools = listed.get("tools") if isinstance(listed, dict) else None
            actual_tools = (
                [tool.get("name") for tool in tools]
                if isinstance(tools, list)
                and all(isinstance(tool, dict) for tool in tools)
                else None
            )
            if (
                not isinstance(actual_tools, list)
                or any(not isinstance(tool, str) or not tool for tool in actual_tools)
                or len(set(actual_tools)) != len(actual_tools)
            ):
                raise ValueError(
                    f"[{package_id}] Live MCP returned invalid or duplicate tool names"
                )
            if sorted(actual_tools) != sorted(expected_tools):
                raise ValueError(
                    f"[{package_id}] Live MCP tools do not match manifest. "
                    f"expected={json.dumps(sorted(expected_tools))} "
                    f"actual={json.dumps(sorted(actual_tools))}"
                )
            noun = "tool" if len(expected_tools) == 1 else "tools"
            print(
                f"Verified {package_id} MCP tool surface "
                f"({len(expected_tools)} {noun})."
            )
        finally:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
    finally:
        if temporary_home is not None:
            temporary_home.cleanup()


if __name__ == "__main__":
    try:
        verify()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
