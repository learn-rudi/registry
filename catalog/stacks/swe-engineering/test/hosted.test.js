import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  HOSTED_ADAPTER_ID,
  HOSTED_ADAPTER_VERSION,
  HOSTED_TOOL_DEFINITIONS,
  callHostedTool,
} from "../src/hosted.js";

test("hosted adapter exposes only the three read-only manual tools", () => {
  assert.equal(HOSTED_ADAPTER_ID, "@rudi/swe-engineering-stack");
  assert.equal(HOSTED_ADAPTER_VERSION, "0.2.0");
  assert.deepEqual(
    HOSTED_TOOL_DEFINITIONS.map((tool) => tool.name),
    ["swe_manual_list", "swe_manual_read", "swe_manual_search"]
  );
  assert.equal(
    HOSTED_TOOL_DEFINITIONS.some((tool) => tool.name === "swe_debt_scan"),
    false
  );
});

test("hosted adapter invokes manual tools and refuses local-only tools", async () => {
  const listed = await callHostedTool("swe_manual_list", {});
  assert.equal(listed.documents.length, 13);
  assert.equal("manualRoot" in listed, false);

  await assert.rejects(
    () => callHostedTool("swe_debt_scan", { repo: process.cwd() }),
    /Hosted tool is not allowlisted/
  );
  await assert.rejects(
    () => callHostedTool("unknown", {}),
    /Hosted tool is not allowlisted/
  );
});

test("hosted adapter import slice excludes the local process scanner", async () => {
  const sources = await Promise.all([
    fs.readFile(new URL("../src/hosted.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/manual.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /child_process|agent-debt-scan|\.\/core\.js/);
});
