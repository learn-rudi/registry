import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const contextScript = path.join(
  repoRoot,
  "catalog/skills/rudi-context-gardener/scripts/audit-agent-context.mjs"
);
const canvasBuildScript = path.join(
  repoRoot,
  "catalog/skills/rudi-decision-canvas/scripts/build-decision-canvas.mjs"
);
const canvasVerifyScript = path.join(
  repoRoot,
  "catalog/skills/rudi-decision-canvas/scripts/verify-decision-canvas.mjs"
);

let tmpDir: string;

async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-portable-skills-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("RUDI Context Gardener", () => {
  it("audits durable instruction files without traversing ignored directories", async () => {
    const repeatedRule =
      "Validate every external input at the system boundary and record explicit failure behavior before implementation.";
    await writeText(
      path.join(tmpDir, "AGENTS.md"),
      [
        "# Repository Instructions",
        "",
        repeatedRule,
        "",
        "## Deployment Workflow",
        "",
        "Use /goal and .codex/config.toml for every deployment operation.",
        ...Array.from({ length: 410 }, (_, index) => `Durable instruction ${index + 1}.`),
      ].join("\n")
    );
    await writeText(
      path.join(tmpDir, "packages/demo/CLAUDE.md"),
      `# Package Instructions\n\n${repeatedRule}\n`
    );
    await writeText(
      path.join(tmpDir, "node_modules/noisy/AGENTS.md"),
      "# This file must not be scanned\n"
    );

    const { stdout } = await execFileAsync("node", [
      contextScript,
      "--root",
      tmpDir,
      "--format",
      "json",
    ]);
    const report = JSON.parse(stdout);

    expect(report.summary.filesScanned).toBe(2);
    expect(report.files.map((file: { path: string }) => file.path)).toEqual([
      "AGENTS.md",
      "packages/demo/CLAUDE.md",
    ]);
    expect(report.duplicateBlocks).toHaveLength(1);
    expect(report.duplicateBlocks[0].files).toEqual([
      "AGENTS.md",
      "packages/demo/CLAUDE.md",
    ]);
    expect(report.signals.largeAlwaysLoadedFiles).toEqual(["AGENTS.md"]);
    expect(report.signals.hostSpecificReferences[0]).toMatchObject({
      file: "AGENTS.md",
    });
    expect(report.signals.conditionalWorkflowCandidates[0]).toMatchObject({
      file: "AGENTS.md",
      heading: "Deployment Workflow",
    });
  });

  it("rejects a missing audit root", async () => {
    await expect(
      execFileAsync("node", [contextScript, "--root", path.join(tmpDir, "missing")])
    ).rejects.toMatchObject({ code: 1 });
  });
});

describe("RUDI Decision Canvas", () => {
  it("builds and verifies a self-contained escaped decision artifact", async () => {
    const specPath = path.join(tmpDir, "decision.json");
    const outputPath = path.join(tmpDir, "decision.html");
    await writeText(
      specPath,
      JSON.stringify({
        title: "Choose <script>alert('bad')</script>",
        context: "Select the safest implementation boundary.",
        constraints: ["No external network dependencies"],
        options: [
          {
            id: "portable-skill",
            label: "Portable skill",
            summary: "Use one host-neutral workflow.",
            pros: ["Works in Codex and Claude"],
            cons: ["Uses host fallbacks"],
            recommended: true,
          },
          {
            id: "new-stack",
            label: "New stack",
            summary: "Add a persistent MCP service.",
            risks: ["Duplicates existing state ownership"],
          },
        ],
        decisions: [
          {
            id: "package-boundary",
            prompt: "Which package boundary should we use?",
            choices: [
              { id: "skill", label: "Skill" },
              { id: "stack", label: "Stack" },
            ],
          },
        ],
        theme: {
          accent: "#7c3aed",
          background: "#f8fafc",
          surface: "#ffffff",
          text: "#172033",
        },
      })
    );

    await execFileAsync("node", [
      canvasBuildScript,
      "--input",
      specPath,
      "--output",
      outputPath,
    ]);
    const html = await fs.readFile(outputPath, "utf8");

    expect(html).toContain("data-rudi-decision-canvas=\"1\"");
    expect(html).toContain("Choose &lt;script&gt;alert(&#39;bad&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert('bad')</script>");
    expect(html).not.toMatch(/https?:\/\//);

    const { stdout } = await execFileAsync("node", [
      canvasVerifyScript,
      "--input",
      outputPath,
      "--format",
      "json",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      valid: true,
      title: "Choose <script>alert('bad')</script>",
      optionCount: 2,
      decisionCount: 1,
    });

    await expect(
      execFileAsync("node", [
        canvasBuildScript,
        "--input",
        specPath,
        "--output",
        outputPath,
      ])
    ).rejects.toMatchObject({ code: 1 });
  });

  it("rejects duplicate option identifiers", async () => {
    const specPath = path.join(tmpDir, "invalid-decision.json");
    await writeText(
      specPath,
      JSON.stringify({
        title: "Invalid",
        options: [
          { id: "duplicate", label: "One" },
          { id: "duplicate", label: "Two" },
        ],
        decisions: [],
      })
    );

    await expect(
      execFileAsync("node", [
        canvasBuildScript,
        "--input",
        specPath,
        "--output",
        path.join(tmpDir, "invalid.html"),
      ])
    ).rejects.toMatchObject({ code: 1 });
  });
});

describe("portable skill contracts", () => {
  it("publishes the accepted cross-host skill baseline", async () => {
    const index = JSON.parse(
      await fs.readFile(path.join(repoRoot, "index.json"), "utf8")
    );

    expect(index.packages["skill:map-change-impact"]).toMatchObject({
      version: "1.0.0",
      install: {
        source: "catalog",
        path: "catalog/skills/map-change-impact",
      },
    });
    expect(index.packages["skill:grill-with-docs-loop"]).toMatchObject({
      version: "2.1.0",
      install: {
        source: "catalog",
        path: "catalog/skills/grill-with-docs-loop.md",
      },
    });
    expect(index.packages["skill:swe-compliance-checklist"]).toMatchObject({
      version: "1.1.0",
      install: {
        source: "catalog",
        path: "catalog/skills/swe-compliance-checklist.md",
      },
    });

    await expect(
      fs.access(
        path.join(
          repoRoot,
          "catalog/skills/map-change-impact/agents/openai.yaml"
        )
      )
    ).resolves.toBeUndefined();
  });

  it.each(["rudi-context-gardener", "rudi-decision-canvas"])(
    "%s keeps its core workflow host-neutral",
    async (skillName) => {
      const skill = await fs.readFile(
        path.join(repoRoot, "catalog/skills", skillName, "SKILL.md"),
        "utf8"
      );

      expect(skill).not.toContain("[TODO");
      expect(skill).not.toMatch(/mcp__rudi__|spawn_agent|\/goal|\/review/);
      expect(skill).toContain("Host adaptation");
    }
  );

  it("keeps the delivery workflow host-neutral and evidence-gated", async () => {
    const [issueLoop, complianceChecklist] = await Promise.all([
      fs.readFile(
        path.join(repoRoot, "catalog/skills/rudi-swe-issue-loop.md"),
        "utf8"
      ),
      fs.readFile(
        path.join(repoRoot, "catalog/skills/swe-compliance-checklist.md"),
        "utf8"
      ),
    ]);

    for (const skill of [issueLoop, complianceChecklist]) {
      expect(skill).toContain("## Host Adaptation");
      expect(skill).toContain("independent review");
      expect(skill).toMatch(/risk tier/i);
      expect(skill).toMatch(/evidence bundle/i);
    }
    expect(issueLoop).not.toContain("RUDI or Codex engineering work");
    expect(issueLoop).toContain("version: 1.1.0");
    expect(complianceChecklist).toContain("version: 1.1.0");
  });
});
