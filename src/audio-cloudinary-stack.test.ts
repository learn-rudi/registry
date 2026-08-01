import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const root = process.cwd();
const audioRoot = path.join(root, "catalog/stacks/audio-tools");
const cloudinaryRoot = path.join(root, "catalog/stacks/cloudinary");

const audioTools = [
  "audio_transcribe",
  "audio_enrich",
  "audio_query",
  "audio_sync",
  "audio_stats",
];

const cloudinaryTools = [
  "cloudinary_config_status",
  "cloudinary_upload_video",
  "cloudinary_get_resource",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function readStackFiles(stackRoot: string): Promise<string> {
  const files = await fg("**/*", {
    cwd: stackRoot,
    onlyFiles: true,
    dot: true,
    ignore: ["node_modules/**", "dist/**", "tests/**", "package-lock.json"],
  });
  const content = await Promise.all(
    files.map((file) => fs.readFile(path.join(stackRoot, file), "utf8"))
  );
  return content.join("\n");
}

describe("audio-tools and cloudinary stack packages", () => {
  it("registers audio-tools as a portable remote stack with required media binaries", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(audioRoot, "manifest.json")
    );
    const index = await readJson<Record<string, any>>(path.join(root, "index.json"));

    expect(manifest).toMatchObject({
      id: "stack:audio-tools",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/audio-tools",
      },
      requires: {
        binaries: ["ffmpeg", "ffprobe", "yt-dlp"],
        secrets: [],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/index.ts"],
      },
    });
    expect(manifest.provides.tools).toEqual(audioTools);
    expect(index.packages[manifest.id]).toEqual(manifest);

    const stackContent = await readStackFiles(audioRoot);
    expect(stackContent).not.toContain("/Users/");
    expect(stackContent).not.toContain("/opt/homebrew");
  });

  it("registers cloudinary as a credential-safe remote stack", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(cloudinaryRoot, "manifest.json")
    );
    const index = await readJson<Record<string, any>>(path.join(root, "index.json"));

    expect(manifest).toMatchObject({
      id: "stack:cloudinary",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/cloudinary",
      },
      requires: {
        binaries: [],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/index.ts"],
      },
    });
    expect(manifest.provides.tools).toEqual(cloudinaryTools);
    expect(manifest).not.toHaveProperty("related");

    const secrets = manifest.requires.secrets as Array<Record<string, unknown>>;
    expect(secrets.map((secret) => secret.key)).toEqual([
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "CLOUDINARY_URL",
    ]);
    expect(secrets.every((secret) => secret.required === false)).toBe(true);

    expect(index.packages[manifest.id]).toEqual(manifest);

    const stackContent = await readStackFiles(cloudinaryRoot);
    expect(stackContent).not.toContain("/Users/");
    expect(stackContent).not.toContain("hoffdigital");
  });
});
