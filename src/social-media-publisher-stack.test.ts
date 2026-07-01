import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const stackRoot = path.join(root, "catalog/stacks/social-media-publisher");
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

const spawnedProcesses = new Set<ChildProcessWithoutNullStreams>();

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

function waitForJsonLine(
  child: ChildProcessWithoutNullStreams,
  predicate: (value: Record<string, any>) => boolean,
  stderr: () => string
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response. stderr: ${stderr()}`));
    }, 5000);

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    }

    function onData(chunk: Buffer) {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Record<string, any>;
        if (predicate(value)) {
          cleanup();
          resolve(value);
          return;
        }
      }
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      cleanup();
      reject(new Error(`MCP process exited before response. code=${code} signal=${signal} stderr: ${stderr()}`));
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    child.stdout.on("data", onData);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

async function listMcpTools(): Promise<string[]> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "social-media-publisher-test-"));
  let stderr = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: stackRoot,
    env: {
      ...process.env,
      SOCIAL_MEDIA_PUBLISHER_STACK_ENV_PATH: path.join(tempDir, "missing.env"),
      SOCIAL_MEDIA_CONFIG_DIR: path.join(tempDir, "state"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  spawnedProcesses.add(child);
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "registry-test", version: "1.0.0" },
        },
      }) + "\n"
    );
    await waitForJsonLine(child, (value) => value.id === 1, () => stderr);

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    const response = await waitForJsonLine(child, (value) => value.id === 2, () => stderr);

    return response.result.tools.map((tool: { name: string }) => tool.name);
  } finally {
    child.kill();
    spawnedProcesses.delete(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  for (const child of spawnedProcesses) {
    child.kill();
  }
  spawnedProcesses.clear();
});

describe("social-media-publisher stack package", () => {
  it("exposes staged Instagram Reel tools across install metadata and the MCP tool list", async () => {
    const manifest = await readJson<Record<string, any>>(path.join(stackRoot, "manifest.v2.json"));
    const legacyManifest = await readJson<Record<string, any>>(path.join(stackRoot, "manifest.json"));
    const index = await readJson<Record<string, any>>(path.join(root, "index.json"));
    const mcpTools = await listMcpTools();

    expect(manifest).toMatchObject({
      id: "stack:social-media-publisher",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/social-media-publisher",
      },
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/index.ts"],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);

    expect(legacyManifest).toMatchObject({
      id: "social-media-publisher",
      runtime: "node",
      command: ["npx", "tsx", "src/index.ts"],
    });
    expect(legacyManifest.provides.tools).toEqual(expectedTools);

    const officialStacks = index.packages.stacks.official as Array<Record<string, any>>;
    expect(officialStacks).toContainEqual(
      expect.objectContaining({
        id: "stack:social-media-publisher",
        path: "catalog/stacks/social-media-publisher",
        runtime: "runtime:node",
        provides: {
          tools: expectedTools,
        },
      })
    );

    expect(mcpTools).toEqual(expectedTools);
  });
});
