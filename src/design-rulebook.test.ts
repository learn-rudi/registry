import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
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

describe("RUDI Design Rulebook", () => {
  const skillRoot = path.join(repoRoot, "catalog/skills/rudi-design-rulebook");
  const auditScript = path.join(
    skillRoot,
    "scripts/audit-ui-tells.mjs"
  );

  function numberedSections(markdown: string): string[] {
    return markdown
      .split(/(?=^## \d+\.)/m)
      .filter((section) => /^## \d+\./.test(section));
  }

  async function writeFixtureSite(root: string): Promise<void> {
    await writeText(
      path.join(root, "index.html"),
      [
        "<!doctype html>",
        "<html><head><title>Demo</title></head><body>",
        '<span class="badge">New</span>',
        "<h1>Ship faster</h1>",
        "<h2>\u{1F680} Launch day</h2>",
        "<p>We built this for teams — not for demos.</p>",
        "<p>A seamless, cutting-edge experience.</p>",
        '<i class="lucide lucide-arrow-right"></i>',
        '<section data-aos="fade-up">Later</section>',
        "</body></html>",
      ].join("\n")
    );
    await writeText(
      path.join(root, "styles.css"),
      [
        '@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk&family=Instrument+Serif&display=swap");',
        ".hero { background: linear-gradient(135deg, #7c3aed, #3b82f6); }",
        ".title { background: linear-gradient(90deg, #8b5cf6, #2563eb); -webkit-background-clip: text; color: transparent; }",
        ".card { backdrop-filter: blur(12px); }",
        ".dark { background: #0a0a0a; color: #3a3a3a; }",
        ".btn:hover { opacity: .8; }",
        'h1 em { font-family: "Instrument Serif", serif; font-style: italic; }',
      ].join("\n")
    );
    await writeText(
      path.join(root, "app.js"),
      [
        "const glow = document.querySelector('.glow');",
        "window.addEventListener('mousemove', (e) => glow.style.setProperty('--x', `${e.clientX}px`));",
        "const noise = '<filter id=\"grain\"><feTurbulence baseFrequency=\"0.8\"/></filter>';",
      ].join("\n")
    );
    await writeText(
      path.join(root, "clean.html"),
      [
        "<!doctype html>",
        "<html><head><title>Plain</title></head><body>",
        "<h1>Invoices</h1>",
        "<p>Upload a PDF. We match it to the purchase order and flag anything that does not line up.</p>",
        "</body></html>",
      ].join("\n")
    );
    await writeText(
      path.join(root, "node_modules/noisy/index.js"),
      "// lucide — must not be scanned\n"
    );
  }

  it("reports evidence for each mechanical tell and skips ignored directories", async () => {
    const site = path.join(tmpDir, "site");
    await writeFixtureSite(site);

    const { stdout } = await execFileAsync("node", [
      auditScript,
      "--root",
      site,
      "--format",
      "json",
    ]);
    const report = JSON.parse(stdout);

    expect(report.summary.filesScanned).toBe(4);

    const tells = new Set(report.findings.map((f: { tell: string }) => f.tell));
    for (const expected of [
      "emoji-in-heading",
      "badge-above-headline",
      "lucide-icons",
      "scroll-reveal",
      "buzzwords",
      "purple-blue-gradient",
      "gradient-text",
      "tell-font-pairing",
      "glassmorphism",
      "low-contrast",
      "hover-fade",
      "serif-italic-accent",
      "cursor-glow",
      "grain-texture",
    ]) {
      expect(tells, `missing tell ${expected}`).toContain(expected);
    }

    expect(tells).not.toContain("em-dash");
    const emoji = report.findings.find((f: { tell: string }) => f.tell === "emoji-in-heading");
    expect(emoji).toMatchObject({ file: "index.html", line: 5 });
    const lucide = report.findings.find((f: { tell: string }) => f.tell === "lucide-icons");
    expect(lucide).toMatchObject({ file: "index.html", line: 8, severity: "review" });

    const files = report.findings.map((f: { file: string }) => f.file);
    expect(files).not.toContain("clean.html");
    expect(files.some((file: string) => file.includes("node_modules"))).toBe(false);

    for (const finding of report.findings) {
      expect(["strong", "review"]).toContain(finding.severity);
      expect(typeof finding.fix).toBe("string");
      expect(finding.fix.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes repeated prose dashes and actual Lucide use from dependency metadata", async () => {
    const site = path.join(tmpDir, "classification");
    await writeText(
      path.join(site, "single.html"),
      "<p>One true aside — allowed by the rulebook.</p>\n"
    );
    await writeText(
      path.join(site, "repeated.html"),
      [
        "<p>First clause — first aside.</p>",
        "<p>Second clause — repeated pattern.</p>",
      ].join("\n")
    );
    await writeText(
      path.join(site, "component.tsx"),
      [
        'import { ArrowRight } from "lucide-react";',
        "export const Next = () => <ArrowRight aria-hidden />;",
      ].join("\n")
    );
    await writeText(
      path.join(site, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/lucide-react": { version: "1.0.0" } } })
    );

    const { stdout } = await execFileAsync("node", [
      auditScript,
      "--root",
      site,
      "--format",
      "json",
    ]);
    const report = JSON.parse(stdout);

    expect(report.summary.filesScanned).toBe(3);
    expect(report.findings.filter((f: { tell: string }) => f.tell === "em-dash")).toEqual([
      expect.objectContaining({ file: "repeated.html", line: 1, severity: "strong" }),
    ]);
    expect(report.findings.filter((f: { tell: string }) => f.tell === "lucide-icons")).toEqual([
      expect.objectContaining({ file: "component.tsx", line: 1, severity: "review" }),
    ]);
  });

  it("summarizes a tell at its highest observed severity", async () => {
    const site = path.join(tmpDir, "mixed-severity");
    await writeText(
      path.join(site, "a.html"),
      '<div class="glow">Functional status</div>\n'
    );
    await writeText(
      path.join(site, "z.js"),
      'window.addEventListener("mousemove", (event) => node.style.setProperty("--x", event.clientX));\n'
    );

    const { stdout } = await execFileAsync("node", [
      auditScript,
      "--root",
      site,
      "--format",
      "markdown",
    ]);

    expect(stdout).toContain("Findings: 2 (1 strong, 1 review).");
    expect(stdout).toContain("| cursor-glow | strong | 2 |");
  });

  it("publishes the complete sourced rulebook contract", async () => {
    const [skill, tells, laws] = await Promise.all([
      fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      fs.readFile(path.join(skillRoot, "references/generic-ui-tells.md"), "utf8"),
      fs.readFile(path.join(skillRoot, "references/laws-of-ux.md"), "utf8"),
    ]);
    const tellSections = numberedSections(tells);
    const lawSections = numberedSections(laws);

    expect(tellSections).toHaveLength(20);
    expect(lawSections).toHaveLength(21);
    for (const section of tellSections) {
      expect(section).toMatch(/^- \*\*Rule:\*\*/m);
      expect(section).toMatch(/^- \*\*Why(?: it reads as generated)?:\*\*/m);
      expect(section).toMatch(/^- \*\*Detect:\*\*/m);
      expect(section).toMatch(/^- \*\*Fix:\*\*/m);
    }
    for (const section of lawSections) {
      expect(section).toMatch(/^- \*\*Rule:\*\*/m);
      expect(section).toMatch(/^- \*\*Mechanism:\*\*/m);
      expect(section).toMatch(/^- \*\*Check:\*\*/m);
      expect(section).toMatch(/^- \*\*Fix:\*\*/m);
    }
    for (const source of [
      "https://www.tiktok.com/t/ZP8c22okY/",
      "https://www.tiktok.com/t/ZP8cYccuT/",
    ]) {
      expect(skill).toContain(source);
    }
    expect(laws).toMatch(/source reconciliation/i);
    expect(laws).toMatch(/duplicated Postel/i);
    expect(laws).toMatch(/goal-gradient.*Pareto|Pareto.*goal-gradient/is);
  });

  it("does not treat its own rule definitions as strong UI evidence", async () => {
    const { stdout } = await execFileAsync("node", [
      auditScript,
      "--root",
      skillRoot,
      "--format",
      "json",
    ]);
    const report = JSON.parse(stdout);

    expect(report.summary.filesScanned).toBe(4);
    expect(report.summary.strong).toBe(0);
  });

  it("fails on strong findings only when asked, and passes a clean tree", async () => {
    const site = path.join(tmpDir, "site");
    await writeFixtureSite(site);

    await expect(
      execFileAsync("node", [auditScript, "--root", site, "--fail-on", "strong"])
    ).rejects.toMatchObject({ code: 1 });

    const clean = path.join(tmpDir, "clean");
    await writeText(
      path.join(clean, "index.html"),
      "<!doctype html><html><body><h1>Invoices</h1><p>Upload a PDF.</p></body></html>\n"
    );
    const { stdout } = await execFileAsync("node", [
      auditScript,
      "--root",
      clean,
      "--fail-on",
      "strong",
      "--format",
      "json",
    ]);
    expect(JSON.parse(stdout).findings).toEqual([]);
  });

  it("rejects a missing audit root", async () => {
    try {
      await execFileAsync("node", [auditScript, "--root", path.join(tmpDir, "missing")]);
      throw new Error("expected missing audit root to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { stderr: string }).stderr).toContain("Audit root does not exist");
    }
  });
});
