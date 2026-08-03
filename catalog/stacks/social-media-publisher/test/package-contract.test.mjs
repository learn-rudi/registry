import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedTools = [
  "social_list_supported_platforms",
  "social_validate_post",
  "social_check_publish_ready",
  "social_publish_direct",
  "twitter_post",
  "twitter_thread",
  "linkedin_post",
  "facebook_post",
  "facebook_list_pages",
  "instagram_post",
  "instagram_reel_create_container",
  "instagram_container_status",
  "instagram_publish_container",
  "instagram_list_accounts",
  "tiktok_creator_info",
  "tiktok_direct_post",
  "tiktok_video_upload",
  "tiktok_fetch_status",
  "youtube_video_upload",
];

function waitForJsonLine(child, id, stderr) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response. stderr: ${stderr()}`));
    }, 10_000);

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    }
    function onData(chunk) {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === id) {
          cleanup();
          resolve(message);
          return;
        }
      }
    }
    function onClose(code, signal) {
      cleanup();
      reject(new Error(
        `MCP process exited before response. code=${code} signal=${signal} stderr: ${stderr()}`
      ));
    }
    function onError(error) {
      cleanup();
      reject(error);
    }

    child.stdout.on("data", onData);
    child.on("close", onClose);
    child.on("error", onError);
  });
}

test("package contract and live MCP surface stay aligned", async (context) => {
  const isolatedHome = await fs.mkdtemp(
    path.join(os.tmpdir(), "social-media-publisher-contract-")
  );
  context.after(() => fs.rm(isolatedHome, { recursive: true, force: true }));
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  assert.equal(manifest.id, "stack:social-media-publisher");
  assert.deepEqual(manifest.provides.tools, expectedTools);

  let stderr = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: stackRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: isolatedHome,
      RUDI_HOME: path.join(isolatedHome, ".rudi"),
      CI: "true",
      SOCIAL_MEDIA_PUBLISHER_STACK_ENV_PATH: path.join(isolatedHome, "missing.env"),
      SOCIAL_MEDIA_CONFIG_DIR: path.join(isolatedHome, "state"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "package-contract", version: "1.0.0" },
    },
  }) + "\n");
  await waitForJsonLine(child, 1, () => stderr);
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }) + "\n");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  }) + "\n");
  const response = await waitForJsonLine(child, 2, () => stderr);

  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    expectedTools
  );
});
