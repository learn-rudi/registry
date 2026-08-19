import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(repoRoot, "catalog/skills/map-change-impact");

async function readSkillFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(skillRoot, relativePath), "utf8");
}

describe("Map Change Impact skill", () => {
  it("defines an evidence-backed, read-only change-impact workflow", async () => {
    const skill = await readSkillFile("SKILL.md");

    expect(skill).not.toContain("[TODO");
    expect(skill).toMatch(/what file paths.*impacted/i);
    expect(skill).toMatch(/read-only/i);
    expect(skill).toMatch(/generated/i);
    expect(skill).toMatch(/dirty worktree/i);
    expect(skill).toContain("Confirmed");
    expect(skill).toContain("Likely");
    expect(skill).toContain("Conditional");
  });

  it("requires exact paths, ordered actions, risks, and proof commands", async () => {
    const skill = await readSkillFile("SKILL.md");

    expect(skill).toContain("## Required output");
    expect(skill).toContain("| Priority | Path | Action | Why | Evidence | Risk |");
    expect(skill).toContain("## Ordered actions");
    expect(skill).toContain("## Verification plan");
    expect(skill).toContain("## Assumptions and open questions");
    expect(skill).toMatch(/exact file paths/i);
    expect(skill).toMatch(/out of scope/i);
  });

  it("ships matching Codex interface metadata", async () => {
    const metadata = await readSkillFile("agents/openai.yaml");

    expect(metadata).toContain('display_name: "Map Change Impact"');
    expect(metadata).toContain("$map-change-impact");
  });
});
