import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

test("MCP server exposes the read-only Brave web search tool", async (context) => {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, BRAVE_SEARCH_API_KEY: "test-key" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => child.kill("SIGTERM"));
  const responses = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    responses.set(value.id, value);
  });

  child.stdin.write(`${JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
      protocolVersion: "2024-11-05",
    },
  })}\n`);
  await waitForResponse(responses, 1);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    id: 2,
    jsonrpc: "2.0",
    method: "tools/list",
    params: {},
  })}\n`);
  const response = await waitForResponse(responses, 2);

  assert.deepEqual(response.result.tools.map((tool) => tool.name), ["brave_web_search"]);
  assert.deepEqual(response.result.tools[0].inputSchema.required, ["query"]);
  assert.equal(response.result.tools[0].inputSchema.additionalProperties, false);

  child.stdin.write(`${JSON.stringify({
    id: 3,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "brave_web_search",
      arguments: { count: 21, query: "AI news" },
    },
  })}\n`);
  const invalidCall = await waitForResponse(responses, 3);
  assert.equal(invalidCall.result.isError, true);
  assert.deepEqual(invalidCall.result.structuredContent.error, {
    code: "invalid_arguments",
    message: "count must be an integer between 1 and 20.",
    retryable: false,
    status: null,
  });
  assert.match(
    JSON.parse(invalidCall.result.content[0].text).error.message,
    /count must be an integer between 1 and 20/,
  );
});

async function waitForResponse(responses, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = responses.get(id);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for MCP response ${id}`);
}
