#!/usr/bin/env node
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  await testSlidesToolSchemas();
  await testSlidesValidationRunsBeforeAuth();
}

async function connectMcpClient(stateDir) {
  const client = new Client(
    { name: "google-workspace-slides-test", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: { RUDI_STACK_STATE_DIR: stateDir },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}

async function testSlidesToolSchemas() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-slides-tools-"));
  const client = await connectMcpClient(stateDir);

  try {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "slides_get_presentation",
      "slides_get_slide",
      "slides_get_thumbnail",
      "slides_batch_update",
    ]) {
      assert(byName[name], `${name} must be exposed`);
      assert(byName[name].inputSchema.properties.account, `${name} must support account`);
      assert(
        byName[name].inputSchema.required.includes("presentation_id"),
        `${name} must require presentation_id`
      );
    }

    assert(byName.slides_get_presentation.inputSchema.properties.fields);
    assert(byName.slides_get_slide.inputSchema.properties.slide_id);
    assert(byName.slides_get_slide.inputSchema.required.includes("slide_id"));
    assert(byName.slides_get_thumbnail.inputSchema.properties.thumbnail_size);
    assert(byName.slides_get_thumbnail.inputSchema.required.includes("slide_id"));
    assert(byName.slides_batch_update.inputSchema.properties.requests);
    assert(byName.slides_batch_update.inputSchema.properties.write_control);
    assert(byName.slides_batch_update.inputSchema.required.includes("requests"));
  } finally {
    await client.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function testSlidesValidationRunsBeforeAuth() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-slides-validation-"));
  const client = await connectMcpClient(stateDir);

  try {
    const invalidRequests = await client.callTool({
      name: "slides_batch_update",
      arguments: {
        presentation_id: "15v_IAHyyWGpyy0nHC1PJZLJ8poYK71HSOpG1y5Rm8jM",
        requests: { createSlide: {} },
      },
    });
    assert.equal(invalidRequests.isError, true);
    assert.match(invalidRequests.content?.[0]?.text || "", /requests must be an array/);

    const invalidThumbnailSize = await client.callTool({
      name: "slides_get_thumbnail",
      arguments: {
        presentation_id: "15v_IAHyyWGpyy0nHC1PJZLJ8poYK71HSOpG1y5Rm8jM",
        slide_id: "g3e7fd8d1bce_0_0",
        thumbnail_size: "HUGE",
      },
    });
    assert.equal(invalidThumbnailSize.isError, true);
    assert.match(
      invalidThumbnailSize.content?.[0]?.text || "",
      /thumbnail_size must be one of: SMALL, MEDIUM, LARGE/
    );
  } finally {
    await client.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
