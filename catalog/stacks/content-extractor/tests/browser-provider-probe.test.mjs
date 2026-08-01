import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProbeEvidence,
  parseProviders,
  quoteAppleScriptString,
  summarizeBestProvider,
} from "../scripts/browser-provider-probe.mjs";

test("classifyProbeEvidence identifies success from expected title or text", () => {
  assert.equal(
    classifyProbeEvidence({
      expectedText: "Introducing GeneBench-Pro",
      title: "Introducing GeneBench-Pro | OpenAI",
      textSample: "",
    }),
    "success"
  );

  assert.equal(
    classifyProbeEvidence({
      expectedText: "Introducing GeneBench-Pro",
      title: "OpenAI",
      textSample: "A page that includes Introducing GeneBench-Pro in the rendered body",
    }),
    "success"
  );
});

test("classifyProbeEvidence distinguishes blocked and timeout evidence", () => {
  assert.equal(
    classifyProbeEvidence({
      expectedText: "Introducing GeneBench-Pro",
      title: "Just a moment...",
      textSample: "",
    }),
    "blocked"
  );

  assert.equal(
    classifyProbeEvidence({
      expectedText: "Introducing GeneBench-Pro",
      error: "navigation timeout after 15000ms",
    }),
    "timeout"
  );
});

test("classifyProbeEvidence marks screenshot-only evidence as unclassified", () => {
  assert.equal(
    classifyProbeEvidence({
      expectedText: "Introducing GeneBench-Pro",
      screenshotBytes: 15000,
    }),
    "captured_unclassified"
  );
});

test("parseProviders validates and deduplicates provider names", () => {
  assert.deepEqual(
    parseProviders("fetch,rudi_playwright,fetch,playwright_chrome_channel"),
    ["fetch", "rudi_playwright", "playwright_chrome_channel"]
  );

  assert.throws(
    () => parseProviders("fetch,unknown_provider"),
    /Unsupported provider/
  );
});

test("quoteAppleScriptString escapes URLs for macOS Chrome navigation", () => {
  assert.equal(
    quoteAppleScriptString('https://example.com/path?quoted="yes"&slash=\\'),
    '"https://example.com/path?quoted=\\"yes\\"&slash=\\\\"'
  );
});

test("summarizeBestProvider prefers success over screenshot-only evidence", () => {
  assert.deepEqual(
    summarizeBestProvider([
      { provider: "rudi_playwright", status: "captured_unclassified" },
      { provider: "codex_in_app", status: "success" },
    ]),
    { provider: "codex_in_app", status: "success" }
  );
});
