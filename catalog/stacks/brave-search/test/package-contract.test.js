import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stackRoot = new URL("..", import.meta.url);

test("manifest, package, and operator contracts stay aligned", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", stackRoot), "utf8"));
  const packageJson = JSON.parse(await readFile(new URL("package.json", stackRoot), "utf8"));

  assert.equal(manifest.id, "stack:brave-search");
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.provides.tools, ["brave_web_search"]);
  assert.equal(manifest.related.operatorSkill, "skill:brave-search");
  assert.deepEqual(manifest.related.skills, ["skill:brave-search"]);
  assert.deepEqual(manifest.mcp, {
    args: ["src/index.js"],
    command: "node",
    cwd: ".",
    transport: "stdio",
  });
  assert.deepEqual(manifest.requires.secrets, [{
    helpUrl: "https://api-dashboard.search.brave.com/app/keys",
    key: "BRAVE_SEARCH_API_KEY",
    label: "Brave Search API key",
    required: true,
  }]);
});
