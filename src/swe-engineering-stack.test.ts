import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const stackRoot = path.join(process.cwd(), "catalog/stacks/swe-engineering");
const expectedTools = [
  "swe_manual_list",
  "swe_manual_read",
  "swe_manual_search",
  "swe_debt_scan",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("swe-engineering stack package", () => {
  it("packages the SWE manual as portable registry content with related skill wiring", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json")
    );
    const index = await readJson<Record<string, any>>(path.join(process.cwd(), "index.json"));

    expect(manifest).toMatchObject({
      id: "stack:swe-engineering",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/swe-engineering",
      },
      related: {
        skills: ["skill:swe-compliance-checklist"],
      },
      requires: {
        binaries: [],
        secrets: [],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);
    expect(index.packages[manifest.id]).toEqual(manifest);

    const manualFiles = await fg("src/manual/*", {
      cwd: stackRoot,
      onlyFiles: true,
      dot: true,
    });
    expect(manualFiles.sort()).toEqual([
      "src/manual/01-Master-Engineering-Doctrine.txt",
      "src/manual/02-Engineering-Quick-Reference.txt",
      "src/manual/03-Testing-Doctrine-Source.txt",
      "src/manual/04-Debugging-Doctrine-Source.txt",
      "src/manual/05-API-Engineering-Standard.md",
      "src/manual/06-Security-Engineering-Standard.md",
      "src/manual/07-Backend-Application-Engineering-Standard.md",
      "src/manual/08-Infrastructure-and-Deployment-Engineering-Standard.md",
      "src/manual/09-Build-Order-and-Engineering-System.md",
      "src/manual/10-Engineering-Operating-Manual-Index.md",
    ]);

    const stackFiles = await fg("**/*", {
      cwd: stackRoot,
      onlyFiles: true,
      dot: true,
      ignore: ["node_modules/**", "dist/**"],
    });
    expect(stackFiles).not.toContain(".DS_Store");
    expect(stackFiles).not.toContain("AGENTS.md");
    expect(stackFiles).not.toContain("CLAUDE.md");
    expect(stackFiles.some((file) => file.startsWith(".git/"))).toBe(false);

    const manualContent = await Promise.all(
      manualFiles.map((file) => fs.readFile(path.join(stackRoot, file), "utf8"))
    );
    expect(manualContent.join("\n")).not.toContain("/Users/");
  });
});
