import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRemoteUrl = "https://mcp-production-5c11.up.railway.app/mcp";
const maximumResponseBytes = 2_000_000;

function parseMcpResponse(contentType, body) {
  if (contentType.includes("application/json")) {
    return JSON.parse(body);
  }

  if (contentType.includes("text/event-stream")) {
    const dataLine = body
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"));
    assert.ok(dataLine, "MCP event stream did not contain a data line");
    return JSON.parse(dataLine.slice("data:".length).trim());
  }

  throw new Error(`Unsupported MCP content type: ${contentType || "missing"}`);
}

async function readBoundedText(response) {
  assert.ok(response.body, "MCP response did not include a body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maximumResponseBytes) {
      await reader.cancel();
      throw new Error(`MCP response exceeded ${maximumResponseBytes} bytes`);
    }
    result += decoder.decode(value, { stream: true });
  }

  return result + decoder.decode();
}

test("parses JSON and event-stream MCP responses", () => {
  const payload = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
  assert.deepEqual(
    parseMcpResponse("application/json", JSON.stringify(payload)),
    payload
  );
  assert.deepEqual(
    parseMcpResponse(
      "text/event-stream",
      `event: message\ndata: ${JSON.stringify(payload)}\n\n`
    ),
    payload
  );
});

test("hosted Dwellow tools/list matches the Registry manifest", {
  skip: process.env.DWELLOW_MCP_LIVE_TEST !== "1",
}, async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  const remoteUrl = new URL(process.env.DWELLOW_MCP_URL || defaultRemoteUrl);
  assert.ok(
    remoteUrl.protocol === "https:" || remoteUrl.protocol === "http:",
    "DWELLOW_MCP_URL must use http or https"
  );

  const response = await fetch(remoteUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readBoundedText(response);
  assert.equal(
    response.ok,
    true,
    `Hosted MCP returned HTTP ${response.status}: ${body.slice(0, 500)}`
  );

  const payload = parseMcpResponse(
    response.headers.get("content-type") || "",
    body
  );
  assert.equal(payload.error, undefined, "Hosted MCP returned a JSON-RPC error");
  assert.ok(Array.isArray(payload.result?.tools), "Hosted MCP did not return tools");
  const liveToolNames = payload.result.tools.map((tool) => {
    assert.equal(typeof tool?.name, "string", "Hosted MCP returned an unnamed tool");
    return tool.name;
  });
  assert.equal(
    new Set(liveToolNames).size,
    liveToolNames.length,
    "Hosted MCP returned duplicate tool names"
  );
  assert.deepEqual(liveToolNames, manifest.provides.tools);
});
