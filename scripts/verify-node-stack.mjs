#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RESPONSE_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 1_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const FORWARDED_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
];

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function childEnvironment(isolatedHome, rudiHome) {
  const env = {};
  for (const key of FORWARDED_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: isolatedHome,
    RUDI_HOME: rudiHome,
    CI: "true",
    RUDI_VERIFY_OFFLINE: "1",
    RUDI_VERIFY_SESSION: "1",
  };
}

async function verificationState() {
  if (process.env.RUDI_VERIFY_SESSION === "1") {
    const home = path.resolve(requireString(process.env.HOME, "session HOME"));
    const rudiHome = path.resolve(
      requireString(process.env.RUDI_HOME, "session RUDI_HOME")
    );
    if (rudiHome !== path.resolve(home, ".rudi")) {
      throw new Error("session RUDI_HOME must be HOME/.rudi");
    }
    return { home, rudiHome, owned: false };
  }

  const home = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-node-contract-"));
  return { home, rudiHome: path.join(home, ".rudi"), owned: true };
}

function assertContainedCwd(stackRoot, configuredCwd) {
  const cwd = path.resolve(stackRoot, configuredCwd);
  const relative = path.relative(stackRoot, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`MCP cwd escapes the stack package: ${configuredCwd}`);
  }
  return cwd;
}

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}

function signalChildTree(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
      return;
    }
  }
  child.kill(signal);
}

async function stopChildTree(child, closed) {
  if (!child) return;
  child.stdin?.end();
  if (await Promise.race([closed, delay(SHUTDOWN_GRACE_MS, false)])) return;

  signalChildTree(child, "SIGTERM");
  if (await Promise.race([closed, delay(SHUTDOWN_GRACE_MS, false)])) return;

  signalChildTree(child, "SIGKILL");
  await Promise.race([closed, delay(SHUTDOWN_GRACE_MS, false)]);
}

async function verify() {
  const stackRoot = process.cwd();
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  const packageId = requireString(manifest.id, "manifest.id");
  if (manifest.kind !== "stack" || manifest.runtime !== "node") {
    throw new Error(`[${packageId}] Expected a Node stack manifest`);
  }
  if (manifest.mcp?.transport !== "stdio") {
    throw new Error(`[${packageId}] Generic Node verification requires stdio MCP`);
  }

  const expectedTools = manifest.provides?.tools;
  if (
    !Array.isArray(expectedTools) ||
    expectedTools.length === 0 ||
    expectedTools.some((tool) => typeof tool !== "string" || tool.length === 0)
  ) {
    throw new Error(`[${packageId}] Manifest requires a non-empty provides.tools array`);
  }

  const command = requireString(manifest.mcp.command, "manifest.mcp.command");
  const configuredArgs = manifest.mcp.args;
  if (!Array.isArray(configuredArgs) || configuredArgs.some((arg) => typeof arg !== "string")) {
    throw new Error(`[${packageId}] manifest.mcp.args must be a string array`);
  }
  const args = command === "npx" ? ["--no-install", ...configuredArgs] : [...configuredArgs];
  const cwd = assertContainedCwd(stackRoot, manifest.mcp.cwd ?? ".");
  const state = await verificationState();
  let child;
  let childClosed = Promise.resolve(true);

  try {
    child = spawn(command, args, {
      cwd,
      env: childEnvironment(state.home, state.rudiHome),
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    childClosed = new Promise((resolve) => child.once("close", () => resolve(true)));
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_OUTPUT_BYTES);
    });

    let nextId = 1;
    const request = (method, params) => {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        let stdout = "";
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(
            `[${packageId}] Timed out waiting for ${method}. stderr: ${stderr}`
          ));
        }, RESPONSE_TIMEOUT_MS);

        function cleanup() {
          clearTimeout(timeout);
          child.stdout.off("data", onData);
          child.off("close", onClose);
          child.off("error", onError);
        }
        function onData(chunk) {
          stdout += chunk.toString("utf8");
          if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
            cleanup();
            reject(new Error(`[${packageId}] MCP stdout exceeded ${MAX_OUTPUT_BYTES} bytes`));
            return;
          }
          const lines = stdout.split(/\r?\n/);
          stdout = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let message;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }
            if (message.id !== id) continue;
            cleanup();
            if (message.error) {
              reject(new Error(
                `[${packageId}] ${method} failed: ${JSON.stringify(message.error)}`
              ));
            } else {
              resolve(message.result);
            }
            return;
          }
        }
        function onClose(code, signal) {
          cleanup();
          reject(new Error(
            `[${packageId}] MCP exited before ${method}; code=${code} signal=${signal}. ` +
              `stderr: ${stderr}`
          ));
        }
        function onError(error) {
          cleanup();
          reject(error);
        }

        child.stdout.on("data", onData);
        child.on("close", onClose);
        child.on("error", onError);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    };

    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rudi-stack-verifier", version: "1.0.0" },
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n");
    const listed = await request("tools/list", {});
    const actualTools = listed?.tools?.map((tool) => tool?.name);
    if (
      !Array.isArray(actualTools) ||
      actualTools.some((tool) => typeof tool !== "string" || tool.length === 0) ||
      new Set(actualTools).size !== actualTools.length
    ) {
      throw new Error(`[${packageId}] Live MCP returned invalid or duplicate tool names`);
    }
    const expectedToolSet = [...expectedTools].sort();
    const actualToolSet = [...actualTools].sort();
    if (JSON.stringify(actualToolSet) !== JSON.stringify(expectedToolSet)) {
      throw new Error(
        `[${packageId}] Live MCP tools do not match manifest. ` +
          `expected=${JSON.stringify(expectedToolSet)} actual=${JSON.stringify(actualToolSet)}`
      );
    }

    console.log(
      `Verified ${packageId} MCP tool surface (${expectedTools.length} ` +
        `${expectedTools.length === 1 ? "tool" : "tools"}).`
    );
  } finally {
    await stopChildTree(child, childClosed);
    if (state.owned) {
      await fs.rm(state.home, { recursive: true, force: true });
    }
  }
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
