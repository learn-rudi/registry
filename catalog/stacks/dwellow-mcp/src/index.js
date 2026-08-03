#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { dirname, join } = require("node:path");

const REMOTE_URL = process.env.DWELLOW_MCP_URL || "https://mcp-production-5c11.up.railway.app/mcp";
const BRIDGE_PACKAGE = process.env.DWELLOW_MCP_REMOTE_PACKAGE || "mcp-remote@0.1.38";

const nodeBin = process.execPath;
const nodeBinDir = dirname(nodeBin);
const npxCli = join(nodeBinDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");

const child = spawn(nodeBin, [npxCli, "-y", BRIDGE_PACKAGE, REMOTE_URL], {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${nodeBinDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
  },
});

child.on("error", (error) => {
  console.error(`Failed to start Dwellow MCP bridge: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
