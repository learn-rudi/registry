import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

async function loadAgent(name: string): Promise<Record<string, any>> {
  const file = path.resolve(import.meta.dirname, `../catalog/agents/${name}.json`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

describe("frontier agent catalog", () => {
  it("contains exactly the native Agent Hosts implemented by the CLI", async () => {
    const directory = path.resolve(import.meta.dirname, "../catalog/agents");
    const files = (await fs.readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .sort();

    expect(files).toEqual([
      "antigravity.json",
      "claude.json",
      "codex.json",
      "gemini.json",
    ]);
  });

  it("uses current native authentication commands", async () => {
    const [claude, codex, gemini] = await Promise.all([
      loadAgent("claude"),
      loadAgent("codex"),
      loadAgent("gemini"),
    ]);

    expect(claude.auth.command).toBe("claude auth login");
    expect(codex.auth.command).toBe("codex login");
    expect(gemini.auth.instructions).toMatch(/API key|Vertex AI|enterprise/i);
    expect(gemini.auth.instructions).toMatch(/Antigravity/i);
  });

  it("catalogs Claude as an Anthropic-managed native installation", async () => {
    const claude = await loadAgent("claude");

    expect(claude).toMatchObject({
      id: "agent:claude",
      kind: "agent",
      version: "system",
      delivery: "system",
      install: { source: "system" },
      bins: ["claude"],
      detect: { command: "claude --version" },
    });
    expect(claude.installHints.manual).toContain("https://claude.ai/install.sh");
  });

  it("catalogs Google's subscription-backed native agent host as system-installed", async () => {
    const antigravity = await loadAgent("antigravity");

    expect(antigravity).toMatchObject({
      id: "agent:antigravity",
      kind: "agent",
      version: "system",
      delivery: "system",
      install: { source: "system" },
      bins: ["agy"],
      detect: { command: "agy --version" },
    });
    expect(antigravity.installHints.manual).toContain("https://antigravity.google/cli/install.sh");
  });

  it("catalogs every agent host as an externally managed system prerequisite", async () => {
    const agents = await Promise.all(
      ["antigravity", "claude", "codex", "gemini"].map(loadAgent)
    );

    for (const agent of agents) {
      expect(agent).toMatchObject({
        kind: "agent",
        version: "system",
        delivery: "system",
        install: { source: "system" },
      });
      expect(agent.detect?.command).toBeTypeOf("string");
      expect(agent.installHints?.manual).toBeTypeOf("string");
      expect(agent.installHints.manual.length).toBeGreaterThan(0);
    }
  });
});
