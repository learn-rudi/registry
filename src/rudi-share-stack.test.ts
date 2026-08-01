import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const stackRoot = path.join(process.cwd(), "catalog/stacks/rudi-share");
const skillPath = path.join(process.cwd(), "catalog/skills/share-web-app.md");
const expectedTools = [
  "rudi_share_preflight",
  "rudi_share_publish",
  "rudi_share_get",
  "rudi_share_unpublish",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("rudi-share stack package", () => {
  it("packages and indexes a portable MCP surface with its companion workflow", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json")
    );
    const index = await readJson<Record<string, any>>(path.join(process.cwd(), "index.json"));
    const skill = await fs.readFile(skillPath, "utf8");

    expect(manifest).toMatchObject({
      id: "stack:rudi-share",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/rudi-share",
      },
      related: { skills: ["skill:share-web-app"] },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);
    expect(manifest.requires.secrets.map((secret: any) => secret.key)).toEqual([
      "RUDI_SHARE_API_URL",
      "RUDI_SHARE_TOKEN",
    ]);

    expect(skill).toContain("name: Share Web App");
    expect(skill).toContain("- stack:rudi-share");
    expect(skill).toContain("Anyone with the link");
    expect(skill).toContain("rudi_share_publish");
    expect(skill).toContain("rudi_share_unpublish");

    expect(index.packages[manifest.id]).toEqual(manifest);

    const packageFiles = await fg("**/*", {
      cwd: stackRoot,
      onlyFiles: true,
      dot: true,
      ignore: ["node_modules/**", "dist/**"],
    });
    expect(packageFiles).toContain("package-lock.json");
    expect(packageFiles).toContain("README.md");
    const contents = await Promise.all(
      packageFiles.map((file) => fs.readFile(path.join(stackRoot, file), "utf8"))
    );
    expect(contents.join("\n")).not.toContain("/Users/");
  });
});
