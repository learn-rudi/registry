import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildEditorialMarkup,
  exportCleanText,
  runEditorialQa,
  validateEditorialModel,
} from "../dist/index.js";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "editorial-markup-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

const sampleModel = {
  title: "AI Ethics Draft",
  blocks: [
    {
      type: "paragraph",
      parts: [
        "People say ",
        {
          id: "c001",
          del: "all forms of artificial intelligence is unethical",
          ins: "all forms of artificial intelligence are unethical",
          noteTitle: "Subject-verb agreement",
          note: "This is a grammar fix, not a claim change.",
        },
        ".",
      ],
    },
    {
      type: "paragraph",
      parts: [
        {
          id: "c002",
          del: "I see this as broad",
          ins: "I think that framing is too broad",
          status: "accepted",
        },
        ".",
      ],
    },
  ],
};

test("validateEditorialModel reports counts, readiness, and duplicate IDs", () => {
  const result = validateEditorialModel(sampleModel);

  assert.equal(result.valid, true);
  assert.equal(result.changeCount, 2);
  assert.equal(result.noteCount, 1);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.cleanExportReady, false);

  const duplicate = structuredClone(sampleModel);
  duplicate.blocks[1].parts[0].id = "c001";
  const invalid = validateEditorialModel(duplicate);

  assert.equal(invalid.valid, false);
  assert.match(invalid.errors[0].message, /Duplicate change id/);
});

test("buildEditorialMarkup writes self-contained interactive HTML", async () => {
  const dir = makeTempDir();

  try {
    const result = await buildEditorialMarkup({
      edit_model: sampleModel,
      output_dir: dir,
      filename: "draft.html",
      mode: "interactive",
    });

    assert.equal(result.mode, "interactive");
    assert.equal(result.validation.valid, true);
    assert.equal(result.changeCount, 2);
    assert.ok(existsSync(result.htmlPath));

    const html = readFileSync(result.htmlPath, "utf8");
    assert.match(html, /editorial-toolbar/);
    assert.match(html, /documentSource/);
    assert.match(html, /Accept all/);
    assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ""));
  } finally {
    cleanup(dir);
  }
});

test("buildEditorialMarkup accepts source_path and source_manifest inputs", async () => {
  const dir = makeTempDir();

  try {
    const sourcePath = join(dir, "source.md");
    writeFileSync(sourcePath, "Source path paragraph.\n\nSecond paragraph.", "utf8");

    const fromPath = await buildEditorialMarkup({
      source_path: sourcePath,
      title: "Path Source",
      output_dir: dir,
      filename: "from-path.html",
    });
    assert.ok(existsSync(fromPath.htmlPath));
    assert.match(readFileSync(fromPath.htmlPath, "utf8"), /Source path paragraph/);

    const fromManifest = await buildEditorialMarkup({
      source_manifest: {
        title: "Manifest Source",
        sections: [
          { title: "Inline Section", source_text: "Inline manifest paragraph." },
          { title: "File Section", source_path: sourcePath },
        ],
      },
      output_dir: dir,
      filename: "from-manifest.html",
    });

    const html = readFileSync(fromManifest.htmlPath, "utf8");
    assert.match(html, /Inline Section/);
    assert.match(html, /File Section/);
    assert.match(html, /Source path paragraph/);
  } finally {
    cleanup(dir);
  }
});

test("exportCleanText requires resolved changes unless explicitly allowed", () => {
  assert.throws(
    () => exportCleanText({ edit_model: sampleModel }),
    /pending changes/,
  );

  const resolved = structuredClone(sampleModel);
  resolved.blocks[0].parts[1].status = "rejected";

  const result = exportCleanText({ edit_model: resolved });
  assert.equal(
    result.text,
    "People say all forms of artificial intelligence is unethical.\n\nI think that framing is too broad.",
  );
  assert.equal(result.pendingCount, 0);
});

test("runEditorialQa verifies controls, scrolling, and screenshots", async () => {
  const dir = makeTempDir();

  try {
    const build = await buildEditorialMarkup({
      edit_model: sampleModel,
      output_dir: dir,
      filename: "draft.html",
      mode: "interactive",
    });

    const qa = await runEditorialQa({
      html_path: build.htmlPath,
      output_dir: join(dir, "qa"),
    });

    assert.equal(qa.success, true, qa.errors.map((item) => item.message).join("\n"));
    assert.equal(qa.screenshots.length, 3);
    assert.ok(qa.screenshots.every((path) => existsSync(path)));
    assert.ok(qa.checks.some((check) => check.name === "desktop-independent-scroll"));
    assert.ok(qa.checks.some((check) => check.name === "mobile-toolbar-horizontal-scroll"));
  } finally {
    cleanup(dir);
  }
});

test("runEditorialQa handles zero-change source-only documents", async () => {
  const dir = makeTempDir();

  try {
    const build = await buildEditorialMarkup({
      source_text: "Plain source-only paragraph.",
      output_dir: dir,
      filename: "source-only.html",
      mode: "interactive",
    });

    const qa = await runEditorialQa({
      html_path: build.htmlPath,
      output_dir: join(dir, "qa"),
    });

    assert.equal(qa.success, true, qa.errors.map((item) => item.message).join("\n"));
    assert.ok(qa.warnings.some((item) => item.code === "NO_CHANGES_FOR_REVIEW_FLOW"));
    assert.ok(qa.checks.some((check) => check.name === "review-flow-skipped"));
  } finally {
    cleanup(dir);
  }
});
