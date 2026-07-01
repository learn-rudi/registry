import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const stackRoot = path.join(process.cwd(), "catalog/stacks/supabase-mcp");
const expectedTools = [
  "list_tables",
  "list_extensions",
  "list_migrations",
  "apply_migration",
  "execute_sql",
  "get_logs",
  "get_advisors",
  "get_project_url",
  "get_publishable_keys",
  "generate_typescript_types",
  "list_edge_functions",
  "get_edge_function",
  "deploy_edge_function",
  "list_projects",
  "get_project",
  "create_project",
  "pause_project",
  "restore_project",
  "list_organizations",
  "get_organization",
  "get_cost",
  "confirm_cost",
  "search_docs",
  "create_branch",
  "list_branches",
  "delete_branch",
  "merge_branch",
  "reset_branch",
  "rebase_branch",
  "list_storage_buckets",
  "get_storage_config",
  "update_storage_config",
];
const expectedBridgePackage = "mcp-remote@0.1.38";
const expectedRemoteUrl = "https://mcp.supabase.com/mcp";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("supabase-mcp stack package", () => {
  it("packages Supabase's hosted MCP server through the pinned stdio bridge", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.v2.json")
    );
    const legacyManifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json")
    );
    const index = await readJson<Record<string, any>>(path.join(process.cwd(), "index.json"));
    const wrapper = await fs.readFile(path.join(stackRoot, "src/index.js"), "utf8");

    expect(manifest).toMatchObject({
      id: "stack:supabase-mcp",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/supabase-mcp",
      },
      requires: {
        binaries: [],
        secrets: [],
      },
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["src/index.js"],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);

    expect(legacyManifest).toMatchObject({
      id: "supabase-mcp",
      runtime: "node",
      command: ["node", "src/index.js"],
      requires: {
        binaries: [],
        secrets: [],
      },
    });
    expect(legacyManifest.provides.tools).toEqual(expectedTools);
    expect(wrapper).toContain(expectedBridgePackage);
    expect(wrapper).toContain(expectedRemoteUrl);
    expect(wrapper).toContain("SUPABASE_MCP_PROJECT_REF");
    expect(wrapper).toContain("SUPABASE_MCP_READ_ONLY");
    expect(wrapper).toContain("SUPABASE_MCP_FEATURES");
    expect(wrapper).toContain("process.execPath");

    const officialStacks = index.packages.stacks.official as Array<Record<string, any>>;
    expect(officialStacks).toContainEqual(
      expect.objectContaining({
        id: "stack:supabase-mcp",
        path: "catalog/stacks/supabase-mcp",
        runtime: "runtime:node",
        requires: {
          secrets: [],
        },
      })
    );
  });
});
