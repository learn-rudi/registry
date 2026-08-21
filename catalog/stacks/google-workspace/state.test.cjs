#!/usr/bin/env node
const assert = require("node:assert/strict");
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function connectMcpClient(stateDir) {
  const client = new Client(
    { name: "google-workspace-state-test", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      RUDI_STACK_STATE_DIR: stateDir,
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name} should not return an MCP error`);
  return result.content?.[0]?.text || "";
}

async function main() {
  await testLegacyMigration();
  await testMcpUsesExternalState();
  testAuthSourceDoesNotUsePackageLocalCredentialFallback();
}

function testAuthSourceDoesNotUsePackageLocalCredentialFallback() {
  const authSource = readFileSync(path.join(process.cwd(), "src", "auth.ts"), "utf8");
  assert.equal(
    authSource.includes("brandonzhoff@gmail.com"),
    false,
    "auth must not use a personal default credentials path"
  );
  assert.equal(
    authSource.includes("DEFAULT_CREDENTIALS"),
    false,
    "auth must not copy credentials from a default package-local account"
  );
}

async function testLegacyMigration() {
  const { getWorkspacePaths, migrateLegacyStateIfNeeded } = await import("./src/state.ts");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "google-workspace-migrate-"));
  const packageRoot = path.join(tempRoot, "package");
  const stateDir = path.join(tempRoot, "state");
  const legacyAccountDir = path.join(packageRoot, "accounts", "legacy@example.com");

  try {
    mkdirSync(legacyAccountDir, { recursive: true });
    writeFileSync(path.join(packageRoot, "state.json"), JSON.stringify({ currentAccount: "legacy@example.com" }));
    writeFileSync(path.join(packageRoot, "token.json"), JSON.stringify({ token: "legacy-default" }));
    writeFileSync(path.join(legacyAccountDir, "token.json"), JSON.stringify({ token: "legacy-account" }));
    writeFileSync(
      path.join(legacyAccountDir, "credentials.json"),
      JSON.stringify({ installed: { client_id: "client", client_secret: "secret" } })
    );

    const paths = getWorkspacePaths({ packageRoot, stateDir, env: {} });
    migrateLegacyStateIfNeeded(paths);

    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "state.json"), "utf8")).currentAccount,
      "legacy@example.com"
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "token.json"), "utf8")).token,
      "legacy-default"
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "accounts", "legacy@example.com", "token.json"), "utf8")).token,
      "legacy-account"
    );

    writeFileSync(path.join(stateDir, "token.json"), JSON.stringify({ token: "existing" }));
    mkdirSync(path.join(packageRoot, "accounts", "extra@example.com"), { recursive: true });
    writeFileSync(
      path.join(packageRoot, "accounts", "extra@example.com", "token.json"),
      JSON.stringify({ token: "extra" })
    );
    migrateLegacyStateIfNeeded(paths);
    assert.equal(
      JSON.parse(readFileSync(path.join(stateDir, "token.json"), "utf8")).token,
      "existing",
      "legacy migration must not overwrite existing state"
    );
    assert.equal(
      existsSync(path.join(stateDir, "accounts", "extra@example.com")),
      false,
      "legacy migration must not add package-local accounts after state has accounts"
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testMcpUsesExternalState() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "google-workspace-state-"));
  const stateDir = path.join(tempRoot, "state");
  const account = "external-state@example.com";
  const accountDir = path.join(stateDir, "accounts", account);
  mkdirSync(accountDir, { recursive: true });
  writeFileSync(
    path.join(accountDir, "token.json"),
    JSON.stringify({ token: "test-token", refresh_token: "test-refresh" }, null, 2)
  );
  writeFileSync(
    path.join(stateDir, "state.json"),
    JSON.stringify({ currentAccount: "../external-state@example.com" }, null, 2)
  );

  const legacyStateFile = path.join(process.cwd(), "state.json");
  const legacyStateBefore = existsSync(legacyStateFile)
    ? readFileSync(legacyStateFile, "utf8")
    : null;

  const client = await connectMcpClient(stateDir);
  try {
    const currentText = await callTool(client, "account_current");
    assert.equal(
      currentText,
      "No account selected (using default state token)",
      "invalid persisted account values must be ignored before resolving account paths"
    );

    const listText = await callTool(client, "account_list");
    assert(
      listText.includes(account),
      "account_list must read configured accounts from RUDI_STACK_STATE_DIR"
    );

    await callTool(client, "account_switch", { account: account.toUpperCase() });
    const state = JSON.parse(readFileSync(path.join(stateDir, "state.json"), "utf8"));
    assert.equal(state.currentAccount, account);

    const legacyStateAfter = existsSync(legacyStateFile)
      ? readFileSync(legacyStateFile, "utf8")
      : null;
    assert.equal(
      legacyStateAfter,
      legacyStateBefore,
      "account_switch must not write mutable state into the package directory"
    );
  } finally {
    await client.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
