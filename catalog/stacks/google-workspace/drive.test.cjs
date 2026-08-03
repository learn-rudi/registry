#!/usr/bin/env node
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  await testDriveUpdateHandlerUpdatesInPlace();
  await testDriveToolSchemas();
}

async function testDriveUpdateHandlerUpdatesInPlace() {
  const source = readFileSync("./src/index.ts", "utf8");
  const caseStart = source.indexOf('case "drive_update"');
  assert(caseStart >= 0, "drive_update handler case must exist");
  const caseBody = source.slice(caseStart, source.indexOf("case ", caseStart + 10));
  assert(
    caseBody.includes("drive.files.update"),
    "drive_update must call drive.files.update so the file ID and shared links are preserved"
  );
  assert(
    caseBody.includes("media"),
    "drive_update must send a media body to replace the file's content"
  );
  assert(
    !caseBody.includes("drive.files.create"),
    "drive_update must never create a new file"
  );
}

async function testDriveToolSchemas() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-tools-"));
  const client = new Client(
    { name: "google-workspace-drive-test", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: { RUDI_STACK_STATE_DIR: stateDir },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    assert(byName.drive_update, "drive_update tool must be exposed");
    const props = byName.drive_update.inputSchema.properties;
    assert(props.file_id, "drive_update must accept file_id");
    assert(props.file_path, "drive_update must accept file_path");
    assert(props.name, "drive_update must accept an optional new name");
    assert.deepEqual(
      byName.drive_update.inputSchema.required.sort(),
      ["file_id", "file_path"],
      "drive_update must require file_id and file_path"
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
