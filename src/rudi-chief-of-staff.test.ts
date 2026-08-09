import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(
  repoRoot,
  "catalog/skills/rudi-chief-of-staff"
);

async function readSkillFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(skillRoot, relativePath), "utf8");
}

describe("RUDI Chief of Staff skill", () => {
  it("defines an objective-driven, host-neutral crew workflow", async () => {
    const skill = await readSkillFile("SKILL.md");

    expect(skill).not.toContain("[TODO");
    expect(skill).toContain("## Host adaptation");
    expect(skill).toContain("references/crew-contract.md");
    expect(skill).toContain("references/worktree-isolation.md");
    expect(skill).toContain("references/host-adapters.md");
    expect(skill).toMatch(/one writer per worktree/i);
    expect(skill).toMatch(/independent review/i);
    expect(skill).toMatch(/externally visible/i);
    expect(skill).not.toMatch(/spawn_agent|mcp__rudi__|codex:\/\/threads/);
  });

  it("specifies durable crew and worktree safety contracts", async () => {
    const [crewContract, worktreeIsolation] = await Promise.all([
      readSkillFile("references/crew-contract.md"),
      readSkillFile("references/worktree-isolation.md"),
    ]);

    for (const field of [
      "task_id",
      "owner",
      "status",
      "dependencies",
      "worktree",
      "branch",
      "acceptance_criteria",
      "verification",
      "deliverables",
    ]) {
      expect(crewContract).toContain(field);
    }
    expect(crewContract).toMatch(/needs_input/);
    expect(crewContract).toMatch(/rework/);
    expect(worktreeIsolation).toMatch(/one writer per worktree/i);
    expect(worktreeIsolation).toMatch(/never.*--force/i);
    expect(worktreeIsolation).toMatch(/untracked/i);
    expect(worktreeIsolation).toMatch(/integration worktree/i);
  });

  it("adapts delegation to Codex, Claude, and sequential fallback", async () => {
    const adapters = await readSkillFile("references/host-adapters.md");
    const metadata = await readSkillFile("agents/openai.yaml");

    expect(adapters).toMatch(/## Codex/);
    expect(adapters).toMatch(/## Claude/);
    expect(adapters).toMatch(/## Sequential fallback/);
    expect(adapters).toMatch(/native.*capabilit/i);
    expect(metadata).toContain("$rudi-chief-of-staff");
  });
});
