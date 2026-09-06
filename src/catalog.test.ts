import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertCatalogReferences,
  discoverCatalogPackages,
} from "./catalog.js";

let tmpDir: string;

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function writeDemoStack(id = "demo"): Promise<void> {
  await writeJson(path.join(tmpDir, `catalog/stacks/${id}/manifest.json`), {
    id: `stack:${id}`,
    kind: "stack",
    name: "Demo Stack",
    version: "1.0.0",
    delivery: "remote",
    install: {
      source: "catalog",
      path: `catalog/stacks/${id}`,
    },
    runtime: "node",
    provides: {
      tools: ["demo_tool"],
    },
    mcp: {
      transport: "stdio",
      command: "node",
      args: ["index.js"],
    },
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-registry-catalog-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("catalog package discovery", () => {
  it("rejects an unclassified authored skill while retaining legacy reader compatibility", async () => {
    await writeText(path.join(tmpDir, "catalog/skills/demo/SKILL.md"), [
      "---", "name: Demo", "description: Manage a deployment", "category: automation",
      "tags: [capability:deploy]", "---", "",
    ].join("\n"));
    const packages = await discoverCatalogPackages(tmpDir);
    expect(() => assertCatalogReferences(packages)).not.toThrow();
    expect(() => assertCatalogReferences(packages, { canonicalSkills: true })).toThrow(/primitive category/);
  });

  it("ships same-ID skill folders with one primitive category and capability facets", async () => {
    const packages = await discoverCatalogPackages(path.resolve(import.meta.dirname, ".."));
    const categories = new Set(["web", "code", "data", "documents", "media", "communication", "agents"]);
    const skills = packages.filter(item => item.manifest.kind === "skill");
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      const slug = skill.manifest.id.slice("skill:".length);
      expect(skill.path).toBe(`catalog/skills/${slug}/SKILL.md`);
      expect(skill.manifest.install?.path).toBe(`catalog/skills/${slug}`);
      expect(categories.has(String(skill.manifest.meta?.category))).toBe(true);
      expect((skill.manifest.meta?.tags as string[]).some(tag => /^capability:[a-z0-9-]+$/.test(tag))).toBe(true);
    }
  });

  it("keeps draft-only shortform skills installable without publishing or video stacks", async () => {
    const packages = await discoverCatalogPackages(path.resolve(import.meta.dirname, ".."));
    const byId = new Map(packages.map(item => [item.manifest.id, item.manifest]));
    for (const id of ["shortform-your-words-script", "shortform-publish-copy", "shortform-social-publish-package"]) {
      expect(byId.get(`skill:${id}`)?.requires?.stacks || []).toEqual([]);
      expect(byId.get("stack:video-editor")?.related?.skills).toContain(`skill:${id}`);
    }
    expect(byId.get("skill:inline-editorial-markup")?.requires?.stacks).toContain("stack:editorial-markup");
  });

  it("discovers Markdown skills as v2 catalog packages", async () => {
    await writeDemoStack();
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-skill.md"),
      `---
name: Demo Skill
description: Demonstrates skill package discovery
version: 1.2.3
category: testing
tags: [demo, skill]
requires:
  stacks:
    - demo
---

# Demo Skill
`
    );

    const packages = await discoverCatalogPackages(tmpDir);
    const byId = Object.fromEntries(packages.map((item) => [item.manifest.id, item]));

    expect(byId["skill:demo-skill"].path).toBe("catalog/skills/demo-skill.md");
    expect(byId["skill:demo-skill"].manifest).toMatchObject({
      id: "skill:demo-skill",
      kind: "skill",
      name: "Demo Skill",
      version: "1.2.3",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/skills/demo-skill.md",
      },
      requires: {
        stacks: ["stack:demo"],
      },
      meta: {
        description: "Demonstrates skill package discovery",
        category: "testing",
        tags: ["demo", "skill"],
      },
    });
  });

  it("discovers a bundled skill once and installs the complete bundle directory", async () => {
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-bundle/SKILL.md"),
      `---
name: Demo Bundle
description: Demonstrates bundled skill package discovery
---

# Demo Bundle
`
    );
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-bundle/references/notes.md"),
      "# Reference Notes\n"
    );
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-bundle/scripts/run.js"),
      "console.log('demo');\n"
    );

    const packages = await discoverCatalogPackages(tmpDir);

    expect(packages).toHaveLength(1);
    expect(packages[0].path).toBe("catalog/skills/demo-bundle/SKILL.md");
    expect(packages[0].manifest).toMatchObject({
      id: "skill:demo-bundle",
      kind: "skill",
      install: {
        source: "catalog",
        path: "catalog/skills/demo-bundle",
      },
    });
  });

  it("rejects a published stack without a primary operator skill", async () => {
    await writeDemoStack();

    const packages = await discoverCatalogPackages(tmpDir);

    expect(() => assertCatalogReferences(packages)).toThrow(
      "[stack:demo] related.operatorSkill is required for published stacks"
    );
  });

  it("rejects an operator skill that is absent from related.skills", async () => {
    await writeDemoStack();
    const manifestPath = path.join(tmpDir, "catalog/stacks/demo/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await writeJson(manifestPath, {
      ...manifest,
      related: {
        operatorSkill: "skill:demo-operator",
        skills: [],
      },
    });
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-operator.md"),
      `---
name: Demo Operator
description: Operates the demo stack
requires:
  stacks:
    - stack:demo
---

# Demo Operator
`
    );

    const packages = await discoverCatalogPackages(tmpDir);

    expect(() => assertCatalogReferences(packages)).toThrow(
      "[stack:demo] related.operatorSkill must also appear in related.skills: skill:demo-operator"
    );
  });

  it("rejects an operator skill that does not require its stack", async () => {
    await writeDemoStack();
    const manifestPath = path.join(tmpDir, "catalog/stacks/demo/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await writeJson(manifestPath, {
      ...manifest,
      related: {
        operatorSkill: "skill:demo-operator",
        skills: ["skill:demo-operator"],
      },
    });
    await writeText(
      path.join(tmpDir, "catalog/skills/demo-operator.md"),
      `---
name: Demo Operator
description: Claims to operate the demo stack without requiring it
---

# Demo Operator
`
    );

    const packages = await discoverCatalogPackages(tmpDir);

    expect(() => assertCatalogReferences(packages)).toThrow(
      "[stack:demo] operator skill skill:demo-operator must declare stack:demo in requires.stacks"
    );
  });

  it("rejects stack related.skills references to unknown skills", async () => {
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/manifest.json"), {
      id: "stack:demo",
      kind: "stack",
      name: "Demo Stack",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/demo",
      },
      runtime: "node",
      provides: {
        tools: ["demo_tool"],
      },
      related: {
        skills: ["skill:missing"],
      },
      mcp: {
        transport: "stdio",
        command: "node",
      },
    });

    const packages = await discoverCatalogPackages(tmpDir);

    expect(() => assertCatalogReferences(packages)).toThrow(
      "[stack:demo] related.skills references unknown skill: skill:missing"
    );
  });

  it("rejects skill requires.stacks references to unknown stacks", async () => {
    await writeText(
      path.join(tmpDir, "catalog/skills/orphan-skill.md"),
      `---
name: Orphan Skill
description: References a missing stack
requires:
  stacks:
    - missing-stack
---

# Orphan Skill
`
    );

    const packages = await discoverCatalogPackages(tmpDir);

    expect(() => assertCatalogReferences(packages)).toThrow(
      "[skill:orphan-skill] requires.stacks references unknown stack: stack:missing-stack"
    );
  });

  it("rejects deprecation replacement references to unknown packages", async () => {
    await writeDemoStack();
    const manifestPath = path.join(tmpDir, "catalog/stacks/demo/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await writeJson(manifestPath, {
      ...manifest,
      lifecycle: {
        maturity: "stable",
        support: "maintenance",
        deprecation: {
          announcedAt: "2026-08-02",
          message: "Use the replacement stack.",
          replacementId: "stack:missing",
        },
      },
    });

    const packages = await discoverCatalogPackages(tmpDir);
    expect(() => assertCatalogReferences(packages)).toThrow(
      "[stack:demo] lifecycle.deprecation.replacementId references unknown package: stack:missing"
    );
  });

  it("rejects version-suffixed catalog metadata paths", async () => {
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/manifest.v2.json"), {
      id: "stack:demo",
      kind: "stack",
      name: "Version-Suffixed Demo",
      version: "1.0.0",
      delivery: "remote",
      install: { source: "catalog", path: "catalog/stacks/demo" },
      runtime: "node",
      provides: { tools: [] },
      mcp: { transport: "stdio", command: "node" },
    });

    await expect(discoverCatalogPackages(tmpDir)).rejects.toThrow(
      "Version-suffixed catalog metadata is not allowed"
    );
  });
});
