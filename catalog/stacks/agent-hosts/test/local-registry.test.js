import assert from "node:assert/strict";
import test from "node:test";

import { isExternalAgentBinaryPath } from "../src/local-registry.js";

test("agent discovery rejects lexical paths inside the RUDI home", () => {
  assert.equal(isExternalAgentBinaryPath(
    "/Users/example/.rudi/bins/codex",
    { home: "/Users/example" }
  ), false);
  assert.equal(isExternalAgentBinaryPath(
    "/Users/example/.rudi/runtimes/node/bin/claude",
    { home: "/Users/example" }
  ), false);
});

test("agent discovery rejects external-looking symlinks resolving into RUDI", () => {
  assert.equal(isExternalAgentBinaryPath(
    "/Users/example/.local/bin/codex",
    {
      home: "/Users/example",
      realpathSyncImpl: (value) => value.endsWith("/.local/bin/codex")
        ? "/Users/example/.rudi/agents/codex/bin/codex"
        : value,
    }
  ), false);
});

test("agent discovery permits vendor-owned paths outside RUDI", () => {
  assert.equal(isExternalAgentBinaryPath(
    "/Users/example/.local/bin/codex",
    { home: "/Users/example", realpathSyncImpl: (value) => value }
  ), true);
});
