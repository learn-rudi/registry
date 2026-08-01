import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const stackRoot = path.join(process.cwd(), "catalog/stacks/agent-hosts");
const expectedTools = [
  "agent_host_list",
  "agent_host_probe",
  "agent_host_invoke",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("agent-hosts stack package", () => {
  it("packages one portable governed fleet without account state or runner authority", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json")
    );
    const packageJson = await readJson<Record<string, any>>(
      path.join(stackRoot, "package.json")
    );
    const index = await readJson<Record<string, any>>(path.join(process.cwd(), "index.json"));

    expect(manifest).toMatchObject({
      id: "stack:agent-hosts",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/agent-hosts",
      },
      requires: {
        binaries: [],
        secrets: [{ key: "DEEPSEEK_API_KEY", required: false }],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);
    expect(packageJson.dependencies).toEqual({
      "@modelcontextprotocol/sdk": "1.0.0",
    });

    expect(index.packages[manifest.id]).toEqual(manifest);

    const files = await fg("**/*", {
      cwd: stackRoot,
      onlyFiles: true,
      dot: true,
      ignore: ["node_modules/**"],
    });
    expect(files).not.toContain(".DS_Store");
    expect(files.some((file) => file.startsWith(".git/"))).toBe(false);
    const source = (await Promise.all(files.map((file) => (
      fs.readFile(path.join(stackRoot, file), "utf8")
    )))).join("\n");
    expect(source).not.toMatch(/\/Users\/admin|dwellow@learnrudi\.com/);
    expect(source).not.toContain("DEEPSEEK_API_KEY=");
    expect(source).not.toContain("rudi serve");
    expect(source).not.toContain("run-group");
  });
});
