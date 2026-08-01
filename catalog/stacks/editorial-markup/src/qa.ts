import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import { type QaArgs, type QaCheck, type QaIssue, type QaResult } from "./types.js";

declare global {
  interface Window {
    __editorialMarkup?: {
      getState: () => {
        counts: {
          pending: number;
          accepted: number;
          rejected: number;
          total: number;
        };
      };
    };
  }
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function pass(name: string, details?: string): QaCheck {
  return { name, passed: true, details };
}

function fail(name: string, message: string, viewport?: string): { check: QaCheck; issue: QaIssue } {
  return {
    check: { name, passed: false, details: message },
    issue: { code: name.toUpperCase().replace(/-/g, "_"), message, viewport },
  };
}

async function checkControls(page: Page): Promise<QaCheck[]> {
  const controls = await page.evaluate(() => {
    const required = [
      '[data-action="accept-selected"]',
      '[data-action="reject-selected"]',
      '[data-action="accept-all"]',
      '[data-action="reset"]',
      '[data-action="copy-clean"]',
      '[data-tab-button="source"]',
      '[data-tab-button="notes"]',
      '[data-document]',
      '[data-source-wrap]',
    ];
    return required.map((selector) => ({ selector, present: Boolean(document.querySelector(selector)) }));
  });

  return controls.map((control) => control.present
    ? pass(`control:${control.selector}`)
    : { name: `control:${control.selector}`, passed: false, details: "Missing required control." });
}

async function smokeReviewFlow(page: Page): Promise<{ checks: QaCheck[]; warnings: QaIssue[] }> {
  const totalChanges = await page.evaluate(() => window.__editorialMarkup?.getState().counts.total ?? 0);
  if (totalChanges === 0) {
    return {
      checks: [pass("review-flow-skipped", "No changes are present, so accept/reject flow checks were skipped.")],
      warnings: [{
        code: "NO_CHANGES_FOR_REVIEW_FLOW",
        message: "No changes are present, so accept/reject flow checks were skipped.",
        viewport: "desktop",
      }],
    };
  }

  await page.locator("[data-change-id]").first().click();
  await page.locator('[data-action="accept-selected"]').click();
  const accepted = await page.evaluate(() => window.__editorialMarkup?.getState().counts.accepted ?? 0);

  await page.locator('[data-action="reset"]').click();
  await page.locator("[data-change-id]").first().click();
  await page.locator('[data-action="reject-selected"]').click();
  const rejected = await page.evaluate(() => window.__editorialMarkup?.getState().counts.rejected ?? 0);

  await page.locator('[data-action="accept-all"]').click();
  const pendingAfterAcceptAll = await page.evaluate(() => window.__editorialMarkup?.getState().counts.pending ?? -1);
  await page.locator('[data-action="copy-clean"]').click();
  await page.waitForFunction(() => {
    const statusLine = document.querySelector("[data-status-line]");
    return Boolean(statusLine?.textContent?.trim());
  });
  const status = await page.locator("[data-status-line]").innerText();

  await page.locator('[data-action="reset"]').click();

  return {
    checks: [
      accepted > 0 ? pass("review-accept-selected") : { name: "review-accept-selected", passed: false, details: "Accept selected did not update state." },
      rejected > 0 ? pass("review-reject-selected") : { name: "review-reject-selected", passed: false, details: "Reject selected did not update state." },
      pendingAfterAcceptAll === 0 ? pass("review-accept-all") : { name: "review-accept-all", passed: false, details: "Accept all left pending changes." },
      status.length > 0 ? pass("review-copy-clean", status) : { name: "review-copy-clean", passed: false, details: "Copy clean produced no status." },
    ],
    warnings: [],
  };
}

async function checkLayout(page: Page, viewport: string): Promise<{ checks: QaCheck[]; issues: QaIssue[] }> {
  const result = await page.evaluate((currentViewport) => {
    const bodyWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const viewportWidth = document.documentElement.clientWidth;
    const bodyHorizontalOverflow = bodyWidth > viewportWidth + 1;

    const workspace = document.querySelector("[data-workspace]");
    const sidebarInner = document.querySelector(".sidebar-inner");
    const toolbar = document.querySelector(".toolbar-scroll");
    const sourceButton = document.querySelector('[data-tab-button="source"]');
    if (sourceButton instanceof HTMLButtonElement) sourceButton.click();
    const sourceWrap = document.querySelector("[data-source-wrap]");

    const workspaceStyle = workspace ? getComputedStyle(workspace) : undefined;
    const sidebarStyle = sidebarInner ? getComputedStyle(sidebarInner) : undefined;
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : undefined;
    const sourceStyle = sourceWrap ? getComputedStyle(sourceWrap) : undefined;

    return {
      currentViewport,
      bodyHorizontalOverflow,
      workspaceOverflowY: workspaceStyle?.overflowY,
      sidebarOverflowY: sidebarStyle?.overflowY,
      toolbarOverflowX: toolbarStyle?.overflowX,
      toolbarScrollable: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : false,
      sourceOverflowX: sourceStyle?.overflowX,
      sourceScrollableX: sourceWrap ? sourceWrap.scrollWidth > sourceWrap.clientWidth : false,
    };
  }, viewport);

  const checks: QaCheck[] = [];
  const issues: QaIssue[] = [];

  if (result.bodyHorizontalOverflow) {
    const failed = fail("no-body-horizontal-overflow", "Body has unintended horizontal overflow.", viewport);
    checks.push(failed.check);
    issues.push(failed.issue);
  } else {
    checks.push(pass("no-body-horizontal-overflow", viewport));
  }

  if (viewport === "desktop") {
    const independentScroll = result.workspaceOverflowY === "auto" && result.sidebarOverflowY === "auto";
    if (independentScroll) {
      checks.push(pass("desktop-independent-scroll", "Workspace and sidebar use independent vertical scroll containers."));
    } else {
      const failed = fail(
        "desktop-independent-scroll",
        `Expected workspace/sidebar overflow-y auto; got ${result.workspaceOverflowY}/${result.sidebarOverflowY}.`,
        viewport,
      );
      checks.push(failed.check);
      issues.push(failed.issue);
    }
  }

  if (viewport === "mobile") {
    const toolbarScroll = result.toolbarOverflowX === "auto" && result.toolbarScrollable;
    if (toolbarScroll) {
      checks.push(pass("mobile-toolbar-horizontal-scroll", "Toolbar overflows inside its own horizontal scroller."));
    } else {
      const failed = fail("mobile-toolbar-horizontal-scroll", "Mobile toolbar is not horizontally scrollable.", viewport);
      checks.push(failed.check);
      issues.push(failed.issue);
    }
  }

  const sourceScroll = result.sourceOverflowX === "auto" && result.sourceScrollableX;
  if (sourceScroll) {
    checks.push(pass(`${viewport}-source-horizontal-scroll`, "Source model panel scrolls horizontally."));
  } else {
    const failed = fail(`${viewport}-source-horizontal-scroll`, "Source model panel is not horizontally scrollable.", viewport);
    checks.push(failed.check);
    issues.push(failed.issue);
  }

  return { checks, issues };
}

async function qaViewport(browser: Browser, htmlPath: string, outputDir: string, viewport: typeof VIEWPORTS[number]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });

    const checks: QaCheck[] = [];
    const issues: QaIssue[] = [];
    const warnings: QaIssue[] = [];

    const controlChecks = await checkControls(page);
    checks.push(...controlChecks);
    for (const check of controlChecks) {
      if (!check.passed) {
        issues.push({
          code: "MISSING_CONTROL",
          message: check.details ?? `Missing ${check.name}`,
          viewport: viewport.name,
        });
      }
    }

    if (viewport.name === "desktop") {
      const flow = await smokeReviewFlow(page);
      checks.push(...flow.checks);
      warnings.push(...flow.warnings);
      for (const check of flow.checks) {
        if (!check.passed) {
          issues.push({
            code: "REVIEW_FLOW_FAILED",
            message: check.details ?? `${check.name} failed.`,
            viewport: viewport.name,
          });
        }
      }
    }

    const layout = await checkLayout(page, viewport.name);
    checks.push(...layout.checks);
    issues.push(...layout.issues);

    await page.locator('[data-tab-button="selected"]').first().click();
    const screenshotPath = join(outputDir, `${basename(htmlPath, ".html")}-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: viewport.name !== "desktop" });

    return { screenshotPath, checks, issues, warnings };
  } finally {
    await page.close();
  }
}

export async function runEditorialQa(args: QaArgs): Promise<QaResult> {
  const htmlPath = resolve(args.html_path);
  if (!existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`);
  }

  const outputDir = resolve(args.output_dir ?? join(process.cwd(), "qa"));
  await mkdir(outputDir, { recursive: true });

  const screenshots: string[] = [];
  const checks: QaCheck[] = [];
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      const result = await qaViewport(browser, htmlPath, outputDir, viewport);
      screenshots.push(result.screenshotPath);
      checks.push(...result.checks);
      errors.push(...result.issues);
      warnings.push(...result.warnings);
    }
  } finally {
    await browser.close();
  }

  return {
    success: errors.length === 0,
    htmlPath,
    screenshots,
    checks,
    errors,
    warnings,
  };
}
