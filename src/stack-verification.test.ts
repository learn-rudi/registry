import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildVerificationEnvironment,
  discoverStackVerification,
  runStackVerifications,
  selectChangedStackIds,
} from "./stack-verification.js";

let tmpDir: string;

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-stack-verify-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("discoverStackVerification", () => {
  it("requires every published stack to own a repository verification contract", async () => {
    const stacksRoot = path.resolve("catalog/stacks");
    const entries = await fs.readdir(stacksRoot, { withFileTypes: true });
    const stackDirectories: string[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const stackDirectory = path.join(stacksRoot, entry.name);
      try {
        await fs.access(path.join(stackDirectory, "manifest.json"));
        stackDirectories.push(stackDirectory);
      } catch {
        // An untracked/empty directory is not a published stack.
      }
    }
    stackDirectories.sort();

    await expect(Promise.all(
      stackDirectories.map((stackDirectory) => discoverStackVerification(stackDirectory))
    )).resolves.toHaveLength(stackDirectories.length);
  });

  it("discovers a Node stack's repository-owned verify script", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/demo");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:demo",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      name: "@rudi/stack-demo",
      scripts: { verify: "npm test" },
    });

    await expect(discoverStackVerification(stackDir)).resolves.toEqual({
      packageId: "stack:demo",
      runtime: "node",
      cwd: stackDir,
      executable: "npm",
      args: ["run", "verify"],
      source: "package.json#scripts.verify",
    });
  });

  it("discovers a Python stack's repository-owned verify module", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/demo-python");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:demo-python",
      kind: "stack",
      runtime: "python",
    });
    await writeText(path.join(stackDir, "verify.py"), "raise SystemExit(0)\n");

    await expect(discoverStackVerification(stackDir)).resolves.toEqual({
      packageId: "stack:demo-python",
      runtime: "python",
      cwd: stackDir,
      executable: "python3",
      args: ["verify.py"],
      source: "verify.py",
    });
  });

  it("reports a missing contract with package and source context", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/unverified");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:unverified",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      name: "@rudi/stack-unverified",
      scripts: {},
    });

    await expect(discoverStackVerification(stackDir)).rejects.toThrow(
      "[stack:unverified] Missing repository verification contract: " +
        "package.json must define a non-empty scripts.verify"
    );

    const pythonDir = path.join(tmpDir, "catalog/stacks/unverified-python");
    await writeJson(path.join(pythonDir, "manifest.json"), {
      id: "stack:unverified-python",
      kind: "stack",
      runtime: "python",
    });
    await expect(discoverStackVerification(pythonDir)).rejects.toThrow(
      "[stack:unverified-python] Missing repository verification contract: " +
        "Python stacks require verify.py"
    );
  });
});

describe("selectChangedStackIds", () => {
  it("selects unique changed stack IDs in deterministic order", () => {
    expect(selectChangedStackIds([
      "README.md",
      "catalog/stacks/zulu/src/index.ts",
      "catalog/stacks/alpha/manifest.json",
      "catalog/stacks/zulu/tests/core.test.ts",
      "catalog/skills/demo.md",
    ])).toEqual(["stack:alpha", "stack:zulu"]);
  });
});

describe("buildVerificationEnvironment", () => {
  it("isolates user state and does not forward tokens or provider secrets", () => {
    expect(buildVerificationEnvironment({
      PATH: "/usr/bin",
      HOME: "/Users/example",
      GITHUB_TOKEN: "secret",
      OPENAI_API_KEY: "secret",
      LANG: "en_US.UTF-8",
    }, "/tmp/rudi-verify-home")).toEqual({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      HOME: "/tmp/rudi-verify-home",
      RUDI_HOME: "/tmp/rudi-verify-home/.rudi",
      CI: "true",
      RUDI_VERIFY_OFFLINE: "1",
      RUDI_VERIFY_SESSION: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    });
  });
});

describe("runStackVerifications", () => {
  it("fails a verification contract that exceeds its execution timeout", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/slow-python");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:slow-python",
      kind: "stack",
      runtime: "python",
    });
    await writeText(
      path.join(stackDir, "verify.py"),
      "import time\ntime.sleep(2)\n"
    );

    const results = await runStackVerifications(tmpDir, ["stack:slow-python"], {
      timeoutMs: 50,
    });

    expect(results).toEqual([
      expect.objectContaining({
        packageId: "stack:slow-python",
        status: "failed",
        error: "verification timed out after 50ms",
      }),
    ]);
  });

  it("executes a selected stack contract without constructing a shell command", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/demo");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:demo",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      scripts: { verify: "npm test" },
    });
    const observed: unknown[] = [];

    const results = await runStackVerifications(tmpDir, ["stack:demo"], {
      execute: async (command) => {
        observed.push(command);
      },
    });

    expect(observed).toEqual([
      expect.objectContaining({
        executable: "npm",
        args: ["run", "verify"],
        cwd: stackDir,
      }),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ packageId: "stack:demo", status: "passed" }),
    ]);
  });

  it("prepares locked Node dependencies before running the contract", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/demo");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:demo",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      dependencies: { example: "1.0.0" },
      scripts: { verify: "npm test" },
    });
    await writeJson(path.join(stackDir, "package-lock.json"), {
      lockfileVersion: 3,
    });
    const observed: unknown[] = [];

    await runStackVerifications(tmpDir, ["stack:demo"], {
      prepare: true,
      execute: async (command) => {
        observed.push(command);
      },
    });

    expect(observed).toEqual([
      expect.objectContaining({
        executable: "npm",
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        source: "package-lock.json",
      }),
      expect.objectContaining({
        executable: "npm",
        args: ["run", "verify"],
      }),
    ]);
  });

  it("runs a package-owned preparation hook in the same isolated session", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/prepared-session");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:prepared-session",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      scripts: {
        "verify:prepare": "node prepare.mjs",
        verify: "node verify.mjs",
      },
    });
    await writeText(
      path.join(stackDir, "prepare.mjs"),
      "import fs from 'node:fs'; import path from 'node:path'; " +
        "fs.writeFileSync(path.join(process.env.HOME, 'prepared'), 'yes');\n"
    );
    await writeText(
      path.join(stackDir, "verify.mjs"),
      "import fs from 'node:fs'; import path from 'node:path'; " +
        "if (!fs.existsSync(path.join(process.env.HOME, 'prepared'))) process.exit(2);\n"
    );

    const results = await runStackVerifications(
      tmpDir,
      ["stack:prepared-session"],
      { prepare: true }
    );

    expect(results).toEqual([
      expect.objectContaining({
        packageId: "stack:prepared-session",
        status: "passed",
      }),
    ]);
  });

  it("fails closed when a Node stack declares unlocked dependencies", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/unlocked");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:unlocked",
      kind: "stack",
      runtime: "node",
    });
    await writeJson(path.join(stackDir, "package.json"), {
      dependencies: { example: "^1.0.0" },
      scripts: { verify: "npm test" },
    });

    const results = await runStackVerifications(tmpDir, ["stack:unlocked"], {
      prepare: true,
      execute: async () => undefined,
    });

    expect(results).toEqual([
      expect.objectContaining({
        packageId: "stack:unlocked",
        status: "failed",
        error: "[stack:unlocked] Node dependency preparation requires package-lock.json",
      }),
    ]);
  });

  it("runs Python verification inside an isolated prepared environment", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/demo-python");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:demo-python",
      kind: "stack",
      runtime: "python",
    });
    await writeText(path.join(stackDir, "verify.py"), "raise SystemExit(0)\n");
    await writeText(path.join(stackDir, "requirements.txt"), "mcp>=1,<2\n");
    const observed: Array<{ executable: string; args: string[]; source: string }> = [];

    await runStackVerifications(tmpDir, ["stack:demo-python"], {
      prepare: true,
      execute: async (command) => {
        observed.push(command);
      },
    });

    expect(observed).toHaveLength(3);
    expect(observed[0]).toEqual(expect.objectContaining({
      executable: "python3",
      args: ["-m", "venv", expect.stringContaining("rudi-stack-venv-")],
      source: "python-venv",
    }));
    expect(observed[1]).toEqual(expect.objectContaining({
      executable: expect.stringMatching(/rudi-stack-venv-.*\/bin\/python$/),
      args: [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "-r",
        path.join(stackDir, "requirements.txt"),
      ],
      source: "requirements.txt",
    }));
    expect(observed[2]).toEqual(expect.objectContaining({
      executable: observed[1].executable,
      args: ["verify.py"],
      source: "verify.py",
    }));
  });

  it("prepares a single runtime-directory Python requirements file", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/nested-python");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:nested-python",
      kind: "stack",
      runtime: "python",
    });
    await writeText(path.join(stackDir, "verify.py"), "raise SystemExit(0)\n");
    await writeText(path.join(stackDir, "python/requirements.txt"), "mcp>=1,<2\n");
    const observed: Array<{ args: string[]; source: string }> = [];

    await runStackVerifications(tmpDir, ["stack:nested-python"], {
      prepare: true,
      execute: async (command) => {
        observed.push(command);
      },
    });

    expect(observed).toHaveLength(3);
    expect(observed[1]).toEqual(expect.objectContaining({
      args: [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "-r",
        path.join(stackDir, "python/requirements.txt"),
      ],
      source: "python/requirements.txt",
    }));
  });

  it("rejects ambiguous Python requirements layouts", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/ambiguous-python");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:ambiguous-python",
      kind: "stack",
      runtime: "python",
    });
    await writeText(path.join(stackDir, "verify.py"), "raise SystemExit(0)\n");
    await writeText(path.join(stackDir, "requirements.txt"), "mcp>=1,<2\n");
    await writeText(path.join(stackDir, "python/requirements.txt"), "mcp>=1,<2\n");

    const results = await runStackVerifications(
      tmpDir,
      ["stack:ambiguous-python"],
      { prepare: true, execute: async () => undefined }
    );

    expect(results).toEqual([
      expect.objectContaining({
        packageId: "stack:ambiguous-python",
        status: "failed",
        error: "[stack:ambiguous-python] Multiple Python requirements files " +
          "require an explicit layout",
      }),
    ]);
  });

  it("does not treat arbitrary child requirements as the Python runtime layout", async () => {
    const stackDir = path.join(tmpDir, "catalog/stacks/docs-requirements");
    await writeJson(path.join(stackDir, "manifest.json"), {
      id: "stack:docs-requirements",
      kind: "stack",
      runtime: "python",
    });
    await writeText(path.join(stackDir, "verify.py"), "raise SystemExit(0)\n");
    await writeText(path.join(stackDir, "docs/requirements.txt"), "sphinx>=1\n");
    const observed: unknown[] = [];

    const results = await runStackVerifications(
      tmpDir,
      ["stack:docs-requirements"],
      {
        prepare: true,
        execute: async (command) => {
          observed.push(command);
        },
      }
    );

    expect(results).toEqual([
      expect.objectContaining({ status: "passed" }),
    ]);
    expect(observed).toHaveLength(2);
  });
});
