import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pins the offline Dwellow hosted-MCP bridge contract", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  const wrapper = await fs.readFile(path.join(stackRoot, "src/index.js"), "utf8");

  assert.equal(manifest.provides.tools.length, 19);
  assert.deepEqual(manifest.mcp, {
    transport: "stdio",
    command: "node",
    args: ["src/index.js"],
    cwd: ".",
  });
  assert.match(wrapper, /mcp-remote@0\.1\.38/);
  assert.match(wrapper, /mcp-production-5c11\.up\.railway\.app\/mcp/);
  assert.match(wrapper, /process\.execPath/);
});
