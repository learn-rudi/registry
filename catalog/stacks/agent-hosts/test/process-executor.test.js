import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMinimalAgentHostEnvironment,
  NodeProcessExecutor,
} from "../src/process-executor.js";
import { RudiInjectedSecretProvider } from "../src/local-registry.js";

test("process executor bounds output and terminates the whole subprocess group", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rudi-agent-host-test-"));
  const marker = join(directory, "late-child-marker");
  try {
    const timedOut = await new NodeProcessExecutor().execute({
      arguments: ["-c", `(sleep 0.35; touch '${marker}') & wait`],
      command: "/bin/sh",
      environment: createMinimalAgentHostEnvironment(),
      maxStdoutBytes: 1_024,
      stdin: "",
      timeoutMs: 100,
      workingDirectory: directory,
    });
    assert.equal(timedOut.timedOut, true);
    assert.equal(timedOut.terminationConfirmed, true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(existsSync(marker), false);

    const overflow = await new NodeProcessExecutor().execute({
      arguments: ["-e", "process.stdout.write('x'.repeat(2048))"],
      command: process.execPath,
      environment: createMinimalAgentHostEnvironment(),
      maxStdoutBytes: 1_024,
      stdin: "",
      timeoutMs: 5_000,
      workingDirectory: directory,
    });
    assert.equal(overflow.stdoutOverflow, true);
    assert.equal(overflow.stdout, "");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("minimal child environment excludes provider keys and arbitrary caller state", () => {
  assert.deepEqual(createMinimalAgentHostEnvironment({
    ANTHROPIC_API_KEY: "must-not-pass",
    CODEX_HOME: "/safe/codex-home",
    DEEPSEEK_API_KEY: "must-not-pass",
    HOME: "/safe/home",
    PATH: "/safe/bin",
    RANDOM_APP_SECRET: "must-not-pass",
    SHELL: "/bin/zsh",
    USER: "agent-user",
  }), {
    CODEX_HOME: "/safe/codex-home",
    HOME: "/safe/home",
    NO_COLOR: "1",
    PATH: "/safe/bin",
    SHELL: "/bin/zsh",
    USER: "agent-user",
  });
});

test("RUDI injected secret provider exposes only the allowlisted DeepSeek key", async () => {
  const secrets = new RudiInjectedSecretProvider({
    DEEPSEEK_API_KEY: "deepseek-test-secret",
    OTHER_SECRET: "must-not-read",
  });
  assert.equal(await secrets.getSecret("DEEPSEEK_API_KEY"), "deepseek-test-secret");
  await assert.rejects(() => secrets.getSecret("OTHER_SECRET"), /not allowlisted/);
});
