import assert from "node:assert/strict";
import test from "node:test";

import {
  executionExposesRequiredOptions,
  isRuntimeVersionInRange,
} from "../src/runtime-compatibility.js";

const CODEX_PATTERN = /^codex-cli (\d+)\.(\d+)\.(\d+)$/u;

test("runtime range includes its minimum version", () => {
  assert.equal(isRuntimeVersionInRange(
    "codex-cli 0.145.0", CODEX_PATTERN, [0, 145, 0], [0, 150, 0]
  ), true);
});

test("runtime range accepts a reviewed intermediate update", () => {
  assert.equal(isRuntimeVersionInRange(
    "codex-cli 0.147.0", CODEX_PATTERN, [0, 145, 0], [0, 150, 0]
  ), true);
});

test("runtime range excludes its upper boundary", () => {
  assert.equal(isRuntimeVersionInRange(
    "codex-cli 0.150.0", CODEX_PATTERN, [0, 145, 0], [0, 150, 0]
  ), false);
});

test("runtime range rejects versions below its minimum", () => {
  assert.equal(isRuntimeVersionInRange(
    "codex-cli 0.144.9", CODEX_PATTERN, [0, 145, 0], [0, 150, 0]
  ), false);
});

test("runtime range rejects malformed version output", () => {
  assert.equal(isRuntimeVersionInRange(
    "codex-cli latest", CODEX_PATTERN, [0, 145, 0], [0, 150, 0]
  ), false);
});

test("capability check requires exact option names", () => {
  assert.equal(executionExposesRequiredOptions(successfulHelp(
    "--allowed-tools --sandbox"
  ), ["--tools", "--sandbox"]), false);
});

test("capability check accepts all required exact options", () => {
  assert.equal(executionExposesRequiredOptions(successfulHelp(
    "-p, --print --tools <tools...> --permission-mode=<mode>"
  ), ["--print", "--tools", "--permission-mode"]), true);
});

test("capability check rejects a failed help command", () => {
  assert.equal(executionExposesRequiredOptions({
    ...successfulHelp("--sandbox"),
    exitCode: 1,
  }, ["--sandbox"]), false);
});

function successfulHelp(stdout) {
  return {
    cancelled: false,
    exitCode: 0,
    startError: false,
    stdout,
    stdoutOverflow: false,
    terminationConfirmed: true,
    timedOut: false,
  };
}
