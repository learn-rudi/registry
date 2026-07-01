#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { dirname, join } = require("node:path");

const REMOTE_URL = "https://mcp.supabase.com/mcp";
const BRIDGE_PACKAGE = "mcp-remote@0.1.38";
const FEATURE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{1,64}$/;

function trimmedEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function truthyFlag(name) {
  const value = trimmedEnv(name).toLowerCase();
  if (!value) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function buildRemoteUrl() {
  const url = new URL(REMOTE_URL);
  const projectRef = trimmedEnv("SUPABASE_MCP_PROJECT_REF");
  const features = trimmedEnv("SUPABASE_MCP_FEATURES");

  if (projectRef) {
    if (!PROJECT_REF_PATTERN.test(projectRef)) {
      throw new Error("SUPABASE_MCP_PROJECT_REF must contain only lowercase letters and numbers");
    }
    url.searchParams.set("project_ref", projectRef);
  }

  if (truthyFlag("SUPABASE_MCP_READ_ONLY")) {
    url.searchParams.set("read_only", "true");
  }

  if (features) {
    const featureList = features.split(",").map((feature) => feature.trim()).filter(Boolean);
    if (featureList.length === 0 || featureList.some((feature) => !FEATURE_PATTERN.test(feature))) {
      throw new Error(
        "SUPABASE_MCP_FEATURES must be a comma-separated list of lowercase feature group names"
      );
    }
    url.searchParams.set("features", featureList.join(","));
  }

  return url.toString();
}

let remoteUrl;
try {
  remoteUrl = buildRemoteUrl();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid Supabase MCP configuration: ${message}`);
  process.exit(1);
}

const nodeBin = process.execPath;
const nodeBinDir = dirname(nodeBin);
const npxCli = join(nodeBinDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");

const child = spawn(nodeBin, [npxCli, "-y", BRIDGE_PACKAGE, remoteUrl], {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${nodeBinDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
  },
});

child.on("error", (error) => {
  console.error(`Failed to start Supabase MCP bridge: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
