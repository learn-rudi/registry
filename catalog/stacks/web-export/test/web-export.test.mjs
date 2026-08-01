import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { htmlToPdf, htmlToPng } from "../dist/index.js";
import { analyzePgmBuffer, isPdfRasterizerAvailable } from "../dist/review-pdf.js";
import { validateExportRequest } from "../dist/validate.js";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "web-export-"));
}

function writeHtml(dir, name, contents) {
  const filePath = join(dir, name);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test("validateExportRequest accepts html_path alias and defaults", () => {
  const dir = makeTempDir();

  try {
    const inputPath = writeHtml(dir, "alias.html", "<!doctype html><html><body>ok</body></html>");
    const request = validateExportRequest({ html_path: inputPath }, "pdf");

    assert.equal(request.inputPath, inputPath);
    assert.equal(request.mode, "auto");
    assert.equal(request.outputProvided, false);
    assert.equal(request.pageSelector, ".artboard, [data-page]");
  } finally {
    cleanup(dir);
  }
});

test("htmlToPdf verifies CSS-print page count from the artifact", async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "css-print.html",
      `<!doctype html>
      <html>
        <head>
          <style>
            @page { size: letter; margin: 0; }
            html, body { margin: 0; padding: 0; }
            .page {
              width: 8.5in;
              min-height: 11in;
              page-break-after: always;
              break-after: page;
              display: flex;
              align-items: center;
              justify-content: center;
              font: 700 48px Georgia, serif;
            }
            .page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
          </style>
        </head>
        <body>
          <section class="page">Page One</section>
          <section class="page">Page Two</section>
        </body>
      </html>`,
    );

    const outputPath = join(dir, "css-print.pdf");
    const result = await htmlToPdf({ input: htmlPath, output: outputPath, preview: false });

    assert.equal(result.actualPageCount, 2);
    assert.equal(result.modeDetected, "css-print");
    assert.ok(existsSync(outputPath));
  } finally {
    cleanup(dir);
  }
});

test("analyzePgmBuffer detects bottom whitespace on underfilled pages", () => {
  const width = 4;
  const height = 4;
  const pixels = Buffer.from([
    0, 0, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  const analysis = analyzePgmBuffer(Buffer.concat([header, pixels]), 1);

  assert.equal(analysis.pageNumber, 1);
  assert.equal(analysis.isBlank, false);
  assert.equal(analysis.bottomWhitespaceRatio, 0.75);
});

test("htmlToPng rejects paginated exports when no explicit pages exist", async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "flow.html",
      `<!doctype html><html><body><main style="height:1200px;font:16px sans-serif;">Flow document</main></body></html>`,
    );

    await assert.rejects(
      () => htmlToPng({ input: htmlPath, output: join(dir, "preview.png"), paginated: true }),
      /page_selector/,
    );
  } finally {
    cleanup(dir);
  }
});

test("htmlToPng exports one PNG per explicit page", async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "artboards.html",
      `<!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 24px; background: #ece8df; }
            .artboards-container { display: grid; gap: 24px; }
            .artboard {
              width: 816px;
              height: 1056px;
              display: flex;
              align-items: center;
              justify-content: center;
              font: 700 48px Georgia, serif;
              color: white;
            }
            .artboard:first-child { background: #31583b; }
            .artboard:last-child { background: #6b4f36; }
          </style>
        </head>
        <body>
          <div class="artboards-container">
            <section class="artboard" data-page="1">Board One</section>
            <section class="artboard" data-page="2">Board Two</section>
          </div>
        </body>
      </html>`,
    );

    const result = await htmlToPng({
      input: htmlPath,
      output: join(dir, "pages"),
      mode: "artboard",
    });

    assert.equal(result.actualPageCount, 2);
    assert.equal(result.modeDetected, "artboard");
    assert.ok(result.artifactPaths.every((path) => existsSync(path)));
  } finally {
    cleanup(dir);
  }
});

test("htmlToPdf merges explicit pages into one verified PDF", async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "deck.html",
      `<!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 24px; background: #ece8df; }
            .artboard {
              width: 816px;
              height: 1056px;
              margin-bottom: 24px;
              display: flex;
              align-items: center;
              justify-content: center;
              font: 700 48px Georgia, serif;
              color: white;
            }
            .artboard:first-child { background: #1f4b99; }
            .artboard:last-child { background: #7b341e; }
          </style>
        </head>
        <body>
          <section class="artboard" data-page="1">One</section>
          <section class="artboard" data-page="2">Two</section>
        </body>
      </html>`,
    );

    const outputPath = join(dir, "deck.pdf");
    const result = await htmlToPdf({
      input: htmlPath,
      output: outputPath,
      mode: "artboard",
      preview: true,
    });

    assert.equal(result.actualPageCount, 2);
    assert.equal(result.artifactPaths.length, 1);
    assert.equal(result.previewPaths.length, 2);
    assert.ok(existsSync(outputPath));
  } finally {
    cleanup(dir);
  }
});

test("htmlToPdf can emit preview PNGs for CSS-print PDFs when pdftoppm is available", {
  skip: !isPdfRasterizerAvailable(),
}, async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "previewable.html",
      `<!doctype html>
      <html>
        <head>
          <style>
            @page { size: letter; margin: 0; }
            html, body { margin: 0; padding: 0; }
            .page {
              width: 8.5in;
              min-height: 11in;
              page-break-after: always;
              break-after: page;
              display: flex;
              align-items: center;
              justify-content: center;
              font: 700 40px Georgia, serif;
            }
            .page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
          </style>
        </head>
        <body>
          <section class="page">Preview One</section>
          <section class="page">Preview Two</section>
        </body>
      </html>`,
    );

    const outputPath = join(dir, "previewable.pdf");
    const result = await htmlToPdf({
      input: htmlPath,
      output: outputPath,
      preview: true,
    });

    assert.equal(result.previewPaths.length, 2);
    assert.ok(result.previewPaths.every((path) => existsSync(path)));
    assert.equal(basename(dirname(result.previewPaths[0])), "previewable-previews");
    assert.equal(basename(result.previewPaths[0]), "page-01.png");
  } finally {
    cleanup(dir);
  }
});

test("htmlToPdf split_output emits one PDF per explicit page", async () => {
  const dir = makeTempDir();

  try {
    const htmlPath = writeHtml(
      dir,
      "split.html",
      `<!doctype html>
      <html>
        <body style="margin:0;padding:0;">
          <section class="artboard" data-page="1" style="width:816px;height:1056px;background:#2d6a4f;"></section>
          <section class="artboard" data-page="2" style="width:816px;height:1056px;background:#bc4749;"></section>
        </body>
      </html>`,
    );

    const outputTarget = join(dir, "split-result.pdf");
    const result = await htmlToPdf({
      input: htmlPath,
      output: outputTarget,
      mode: "artboard",
      split_output: true,
    });

    assert.equal(result.actualPageCount, 2);
    assert.equal(result.artifactPaths.length, 2);
    assert.ok(result.artifactPaths.every((path) => existsSync(path)));
  } finally {
    cleanup(dir);
  }
});

test("manifest no longer advertises phantom tools", () => {
  const manifestPath = new URL("../manifest.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  assert.deepEqual(manifest.provides.tools.sort(), [
    "html_to_pdf",
    "html_to_png",
    "html_to_png_pdf",
  ]);
});

test("MCP tool schemas advertise required inputs and numeric bounds", async () => {
  const client = new Client({ name: "web-export-schema-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js", "--mcp"],
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();

    for (const toolName of ["html_to_pdf", "html_to_png", "html_to_png_pdf"]) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      assert.ok(tool, `Expected ${toolName} to be listed`);

      const schema = tool.inputSchema;
      assert.equal(schema.type, "object");
      assert.ok(Array.isArray(schema.anyOf), `${toolName} should require input or html_path`);
      assert.deepEqual(schema.anyOf, [
        { required: ["input"] },
        { required: ["html_path"] },
      ]);
      assert.equal(schema.properties.dpi.minimum, 72);
      assert.equal(schema.properties.dpi.maximum, 600);
      assert.equal(schema.properties.scale.minimum, 0.25);
      assert.equal(schema.properties.scale.maximum, 4);
      assert.equal(schema.properties.viewport_width.minimum, 320);
      assert.equal(schema.properties.viewport_width.maximum, 7680);
      assert.equal(schema.properties.viewport_height.minimum, 240);
      assert.equal(schema.properties.viewport_height.maximum, 4320);
    }
  } finally {
    await client.close();
  }
});
