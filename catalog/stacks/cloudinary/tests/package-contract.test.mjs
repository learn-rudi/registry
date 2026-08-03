import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));

async function collectTextFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "node_modules", "tests"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(target));
    else if (entry.isFile() && entry.name !== "package-lock.json") files.push(target);
  }
  return files;
}

test("package contract declares a credential-safe Cloudinary MCP surface", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );

  assert.equal(manifest.id, "stack:cloudinary");
  assert.equal(manifest.runtime, "node");
  assert.deepEqual(manifest.provides.tools, [
    "cloudinary_config_status",
    "cloudinary_upload_video",
    "cloudinary_get_resource",
  ]);
  assert.deepEqual(
    manifest.requires.secrets.map((secret) => secret.key),
    [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "CLOUDINARY_URL",
    ]
  );
  assert.equal(manifest.requires.secrets.every((secret) => secret.required === false), true);

  const files = await collectTextFiles(stackRoot);
  const content = (await Promise.all(files.map((file) => fs.readFile(file, "utf8"))))
    .join("\n");
  assert.equal(content.includes("/Users/"), false);
  assert.equal(content.toLowerCase().includes("hoffdigital"), false);
});
