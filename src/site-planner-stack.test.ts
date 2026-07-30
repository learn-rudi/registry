import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const stackRoot = path.join(process.cwd(), "catalog/stacks/site-planner");
const expectedTools = [
  "site_planner_config_status",
  "site_planner_inspect_concept",
  "site_planner_generate_lot_plan",
  "site_planner_optimize_lot_plan",
  "site_planner_preview_concept_commands",
  "site_planner_fork_concept",
  "site_planner_apply_concept_commands",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("site-planner stack package", () => {
  it("packages the fixed-root adapter and registers the exact tool set", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.v2.json"),
    );
    const legacyManifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json"),
    );
    const index = await readJson<Record<string, any>>(
      path.join(process.cwd(), "index.json"),
    );

    expect(manifest).toMatchObject({
      id: "stack:site-planner",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/site-planner",
      },
      requires: {
        binaries: [],
        secrets: [
          {
            key: "SITE_PLANNER_WRITE_HMAC_V1",
            required: true,
          },
        ],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);
    expect(legacyManifest.provides.tools).toEqual(expectedTools);

    expect(index.packages.stacks.official).toContainEqual(
      expect.objectContaining({
        id: "stack:site-planner",
        path: "catalog/stacks/site-planner",
      }),
    );
  });
});
