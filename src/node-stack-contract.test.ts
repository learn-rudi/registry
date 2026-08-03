import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-node-stack-contract-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("verify-node-stack", () => {
  it("compares the live MCP tool surface with the stack manifest", async () => {
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({
      id: "stack:fixture",
      kind: "stack",
      runtime: "node",
      install: { source: "catalog", path: "catalog/stacks/fixture" },
      requires: { binaries: [], secrets: [] },
      provides: { tools: ["fixture_ping", "fixture_status"] },
      mcp: { transport: "stdio", command: "node", args: ["server.mjs"], cwd: "." },
    }));
    await fs.writeFile(path.join(tmpDir, "server.mjs"), [
      "import readline from 'node:readline';",
      "const lines = readline.createInterface({ input: process.stdin });",
      "lines.on('line', (line) => {",
      "  const message = JSON.parse(line);",
      "  if (message.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } } }));",
      "  if (message.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'fixture_status', description: 'Status', inputSchema: { type: 'object', properties: {} } }, { name: 'fixture_ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }] } }));",
      "});",
      "",
    ].join("\n"));

    const verifier = path.resolve("scripts/verify-node-stack.mjs");
    const result = await execFileAsync(process.execPath, [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
    });

    expect(result.stdout).toContain("Verified stack:fixture MCP tool surface (2 tools)");
  });

  it("reuses a runner-owned isolated HOME for the live MCP", async () => {
    const sessionHome = path.join(tmpDir, "session-home");
    await fs.mkdir(path.join(sessionHome, ".rudi"), { recursive: true });
    await fs.writeFile(path.join(sessionHome, "prepared"), "yes");
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({
      id: "stack:session-fixture",
      kind: "stack",
      runtime: "node",
      provides: { tools: ["fixture_ping"] },
      mcp: { transport: "stdio", command: "node", args: ["server.mjs"], cwd: "." },
    }));
    await fs.writeFile(path.join(tmpDir, "server.mjs"), [
      "import fs from 'node:fs'; import path from 'node:path'; import readline from 'node:readline';",
      "if (!fs.existsSync(path.join(process.env.HOME, 'prepared'))) process.exit(7);",
      "const lines = readline.createInterface({ input: process.stdin });",
      "lines.on('line', (line) => { const message = JSON.parse(line);",
      "if (message.method === 'initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fixture',version:'1'}}}));",
      "if (message.method === 'tools/list') console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'fixture_ping'}]}})); });",
      "",
    ].join("\n"));

    const verifier = path.resolve("scripts/verify-node-stack.mjs");
    await expect(execFileAsync(process.execPath, [verifier], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: sessionHome,
        RUDI_HOME: path.join(sessionHome, ".rudi"),
        RUDI_VERIFY_SESSION: "1",
      },
    })).resolves.toEqual(expect.objectContaining({
      stdout: expect.stringContaining("Verified stack:session-fixture"),
    }));
  });
});
