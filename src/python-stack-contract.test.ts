import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-python-stack-contract-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("verify-python-stack", () => {
  it("compares the live Python MCP tool surface with the stack manifest", async () => {
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({
      id: "stack:python-fixture",
      kind: "stack",
      runtime: "python",
      install: { source: "catalog", path: "catalog/stacks/python-fixture" },
      requires: { binaries: [], secrets: [] },
      provides: { tools: ["fixture_ping", "fixture_status"] },
      mcp: { transport: "stdio", command: "python", args: ["server.py"], cwd: "." },
    }));
    await fs.writeFile(path.join(tmpDir, "server.py"), [
      "import json, sys",
      "for line in sys.stdin:",
      "    message = json.loads(line)",
      "    if message.get('method') == 'initialize':",
      "        print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'serverInfo': {'name': 'fixture', 'version': '1.0.0'}}}), flush=True)",
      "    if message.get('method') == 'tools/list':",
      "        print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': {'tools': [{'name': 'fixture_status'}, {'name': 'fixture_ping'}]}}), flush=True)",
      "",
    ].join("\n"));

    const verifier = path.resolve("scripts/verify-python-stack.py");
    const result = await execFileAsync("python3", [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
    });

    expect(result.stdout).toContain(
      "Verified stack:python-fixture MCP tool surface (2 tools)"
    );

    await fs.mkdir(path.join(tmpDir, "tests"));
    await fs.writeFile(
      path.join(tmpDir, "tests/test_failure.py"),
      "import unittest\n\nclass Failure(unittest.TestCase):\n" +
        "    def test_failure(self):\n        self.fail('package test was executed')\n"
    );
    await expect(execFileAsync("python3", [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
    })).rejects.toThrow("package test was executed");
  });

  it("fails explicitly when test files contain zero discoverable cases", async () => {
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({
      id: "stack:zero-tests",
      kind: "stack",
      runtime: "python",
      provides: { tools: ["fixture_ping"] },
      mcp: { transport: "stdio", command: "python", args: ["server.py"], cwd: "." },
    }));
    await fs.writeFile(path.join(tmpDir, "server.py"), "raise SystemExit(0)\n");
    await fs.mkdir(path.join(tmpDir, "tests"));
    await fs.writeFile(
      path.join(tmpDir, "tests/test_empty.py"),
      "def helper():\n    return True\n"
    );

    const verifier = path.resolve("scripts/verify-python-stack.py");
    await expect(execFileAsync("python3", [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
    })).rejects.toThrow("zero discoverable test cases");
  });

  it("reuses a runner-owned isolated HOME for Python tests and the live MCP", async () => {
    const sessionHome = path.join(tmpDir, "session-home");
    await fs.mkdir(path.join(sessionHome, ".rudi"), { recursive: true });
    await fs.writeFile(path.join(sessionHome, "prepared"), "yes");
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({
      id: "stack:python-session",
      kind: "stack",
      runtime: "python",
      provides: { tools: ["fixture_ping"] },
      mcp: { transport: "stdio", command: "python", args: ["server.py"], cwd: "." },
    }));
    await fs.writeFile(path.join(tmpDir, "server.py"), [
      "import json, os, pathlib, sys",
      "if not (pathlib.Path(os.environ['HOME']) / 'prepared').exists(): sys.exit(7)",
      "for line in sys.stdin:",
      "    message = json.loads(line)",
      "    if message.get('method') == 'initialize': print(json.dumps({'jsonrpc':'2.0','id':message['id'],'result':{'protocolVersion':'2024-11-05','capabilities':{},'serverInfo':{'name':'fixture','version':'1'}}}), flush=True)",
      "    if message.get('method') == 'tools/list': print(json.dumps({'jsonrpc':'2.0','id':message['id'],'result':{'tools':[{'name':'fixture_ping'}]}}), flush=True)",
      "",
    ].join("\n"));

    const verifier = path.resolve("scripts/verify-python-stack.py");
    await expect(execFileAsync("python3", [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: sessionHome,
        RUDI_HOME: path.join(sessionHome, ".rudi"),
        RUDI_VERIFY_SESSION: "1",
      },
    })).resolves.toEqual(expect.objectContaining({
      stdout: expect.stringContaining("Verified stack:python-session"),
    }));
  });
});
