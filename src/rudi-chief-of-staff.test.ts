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
    expect(skill).toContain("## Prepare before dispatch");
    expect(skill).toContain("references/crew-contract.md");
    expect(skill).toContain("references/project-plan-contract.md");
    expect(skill).toContain("references/worktree-isolation.md");
    expect(skill).toContain("references/host-adapters.md");
    expect(skill).toMatch(/one writer per worktree/i);
    expect(skill).toMatch(/independent review/i);
    expect(skill).toMatch(/rudi-worktree-closeout/i);
    expect(skill).toMatch(/rudi-decision-frontier/i);
    expect(skill).toMatch(/promotion is not readiness or dispatch/i);
    expect(skill).toMatch(/Repo Steward/i);
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
    expect(adapters).toMatch(/## Sequential execution/);
    expect(adapters).toMatch(/native.*capabilit/i);
    expect(adapters).toMatch(/explicit user authorization.*visible desktop task/i);
    expect(adapters).toMatch(/native list-project discovery/i);
    expect(adapters).toMatch(/Do not materialize waiting nodes/i);
    expect(adapters).toMatch(/isolated_worktree/);
    expect(adapters).toMatch(/reversible archive/i);
    expect(adapters).toMatch(/not an automatic fallback/i);
    expect(metadata).toContain("$rudi-chief-of-staff");
  });

  it("makes the portable project DAG authoritative without conflating execution surfaces", async () => {
    const [skill, contract, adapters] = await Promise.all([
      readSkillFile("SKILL.md"),
      readSkillFile("references/project-plan-contract.md"),
      readSkillFile("references/host-adapters.md"),
    ]);

    expect(skill).toMatch(/canonical DAG and acceptance ledger/i);
    expect(skill).toMatch(/grill-with-docs-loop/);
    expect(skill).toMatch(/swe-compliance-checklist/);
    expect(contract).toContain(".rudi/orchestration/plan.json");
    expect(contract).toContain(".rudi/orchestration/");
    expect(contract).toContain("graph.mmd");
    expect(contract).toContain("decisions.json");
    expect(contract).toContain("runs/*.json");
    for (const status of [
      "proposed",
      "ready",
      "running",
      "waiting",
      "needs_input",
      "review",
      "rework",
      "done",
      "failed",
      "cancelled",
    ]) {
      expect(contract).toContain(`\`${status}\``);
    }
    for (const surface of [
      "inline",
      "subagent",
      "desktop_task",
      "human_gate",
      "external_system",
    ]) {
      expect(contract).toContain(`\`${surface}\``);
    }
    expect(contract).toMatch(/native saved-project.*run-transport state/is);
    expect(contract).toMatch(/source-to-destination transport lineage/i);
    expect(adapters).toMatch(/portable project-plan script.*never dispatches or archives/is);
  });

  it("requires durable activation, exact model routing, resource checkpoints, and bounded review", async () => {
    const [skill, contract, adapters] = await Promise.all([
      readSkillFile("SKILL.md"),
      readSkillFile("references/project-plan-contract.md"),
      readSkillFile("references/host-adapters.md"),
    ]);

    expect(skill).toMatch(/initialize and validate.*run record.*before.*first dispatch/is);
    expect(skill).toMatch(/one independent review.*one focused confirmation/is);
    expect(skill).toMatch(/soft checkpoint/i);
    expect(skill).toMatch(/resource.*pause/is);
    expect(adapters).toMatch(/provider.*model.*reasoning profile.*selection source/is);
    expect(adapters).toMatch(/failure.*must\s+not.*switch provider/is);
    for (const field of [
      "resourceEnvelope",
      "reviewPolicy",
      "modelSelection",
      "fallbackAuthorized",
      "fallbackUnresolvedBlockerRef",
      "usageReports",
    ]) {
      expect(contract).toContain(`\`${field}\``);
    }
  });

  it("documents every executable run lifecycle command", async () => {
    const contract = await readSkillFile("references/project-plan-contract.md");
    for (const command of [
      "run-init",
      "validate-run",
      "prepare",
      "record-dispatch",
      "record-termination",
      "record-usage",
      "record-steering",
      "record-archive",
    ]) {
      expect(contract).toContain(`\`${command}\``);
    }
  });

  it("keeps decision promotion inside the authoritative plan contract", async () => {
    const [skill, contract] = await Promise.all([
      readSkillFile("SKILL.md"),
      readSkillFile("references/project-plan-contract.md"),
    ]);

    expect(skill).toMatch(/schema-v2 plan.*authoritative decision frontier/is);
    expect(contract).toMatch(/schema-v1 plans remain valid/i);
    expect(contract).toContain("`decisionFrontier`");
    expect(contract).toContain("`promote`");
    expect(contract).toMatch(/exact replay is idempotent/i);
    expect(contract).toMatch(/promotion is not readiness or dispatch/i);
    expect(contract).toMatch(/distinct implementation authorization/i);
  });
});
