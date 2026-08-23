import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AGENT_HOST_TOOL_DEFINITIONS } from "../src/tool-contract.js";

test("MCP tools expose only list, explicit probe, and bounded synchronous invoke", () => {
  assert.deepEqual(AGENT_HOST_TOOL_DEFINITIONS.map((tool) => tool.name), [
    "agent_host_list",
    "agent_host_probe",
    "agent_host_invoke",
  ]);
  const invoke = AGENT_HOST_TOOL_DEFINITIONS[2];
  assert.equal(invoke.inputSchema.additionalProperties, false);
  assert.deepEqual(invoke.inputSchema.required, [
    "adapter_id",
    "content_class",
    "correlation_id",
    "invocation_id",
    "output_format",
    "prompt",
    "timeout_ms",
  ]);
  assert.deepEqual(invoke.inputSchema.properties.adapter_id.enum, [
    "deepseek-http-v1",
    "claude-code-cli-v1",
    "codex-cli-v1",
  ]);
  assert.deepEqual(invoke.inputSchema.properties.content_class.enum,
    ["synthetic_nonprivate"]);
  assert.equal(invoke.inputSchema.properties.prompt.maxLength, 200_000);
  assert.equal(invoke.inputSchema.properties.timeout_ms.minimum, 1_000);
  assert.equal(invoke.inputSchema.properties.timeout_ms.maximum, 25_000);
  assert.equal("cwd" in invoke.inputSchema.properties, false);
  assert.equal("environment" in invoke.inputSchema.properties, false);
  assert.equal("model" in invoke.inputSchema.properties, false);
  assert.equal("tools" in invoke.inputSchema.properties, false);
});

test("MCP server version matches the installable stack package", () => {
  const packageMetadata = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  const serverSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

  assert.match(serverSource, new RegExp(`version: "${packageMetadata.version}"`));
});
