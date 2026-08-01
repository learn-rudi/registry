import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  assertValidModel,
  exportCleanText,
  isChangePart,
  sourceTextToModel,
  validateEditorialModel,
} from "./model.js";
import {
  type BuildEditorialMarkupArgs,
  type BuildEditorialMarkupResult,
  type ChangePart,
  type EditorialBlock,
  type EditorialDocument,
  type EditorialPart,
  type ReviewMode,
  type SourceManifest,
  type SourceManifestSection,
} from "./types.js";

const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "state", "stacks", "editorial-markup", "outputs");

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "editorial-markup";
}

function resolveOutputPath(args: BuildEditorialMarkupArgs, title: string): string {
  if (args.output_path) return resolve(args.output_path);
  const outputDir = resolve(args.output_dir ?? DEFAULT_OUTPUT_DIR);
  const filename = args.filename?.trim() || `${slugify(title)}.html`;
  return join(outputDir, filename.endsWith(".html") ? filename : `${filename}.html`);
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readSourcePath(sourcePath: string): Promise<string> {
  return readFile(resolve(sourcePath), "utf8");
}

function parseSourceManifest(raw: unknown): SourceManifest {
  if (!isRecord(raw) || !Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new Error("source_manifest must be an object with a non-empty sections array.");
  }

  const sections = raw.sections.map((section, index): SourceManifestSection => {
    if (!isRecord(section)) {
      throw new Error(`source_manifest.sections[${index}] must be an object.`);
    }

    const title = typeof section.title === "string" && section.title.trim() ? section.title : undefined;
    const sourceText = typeof section.source_text === "string" ? section.source_text : undefined;
    const sourcePath = typeof section.source_path === "string" && section.source_path.trim() ? section.source_path : undefined;

    if (!sourceText && !sourcePath) {
      throw new Error(`source_manifest.sections[${index}] requires source_text or source_path.`);
    }

    return {
      ...(title ? { title } : {}),
      ...(sourceText !== undefined ? { source_text: sourceText } : {}),
      ...(sourcePath ? { source_path: sourcePath } : {}),
    };
  });

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : undefined,
    sections,
  };
}

async function sourceManifestToModel(raw: unknown, title?: string): Promise<EditorialDocument> {
  const manifest = parseSourceManifest(raw);
  const blocks: EditorialBlock[] = [];

  for (const section of manifest.sections) {
    if (section.title) {
      blocks.push({ type: "heading", level: 2, parts: [section.title] });
    }

    const text = section.source_path
      ? await readSourcePath(section.source_path)
      : section.source_text ?? "";
    const sectionModel = sourceTextToModel(text, undefined, {
      enforceInlineLimit: section.source_path === undefined,
    });
    blocks.push(...sectionModel.blocks);
  }

  return {
    title: manifest.title ?? title,
    blocks,
  };
}

async function resolveModel(args: BuildEditorialMarkupArgs): Promise<EditorialDocument> {
  if (args.edit_model !== undefined) return assertValidModel(args.edit_model);
  if (typeof args.source_text === "string") {
    return assertValidModel(sourceTextToModel(args.source_text, args.title));
  }
  if (typeof args.source_path === "string" && args.source_path.trim()) {
    const sourceText = await readSourcePath(args.source_path);
    return assertValidModel(sourceTextToModel(sourceText, args.title, { enforceInlineLimit: false }));
  }
  if (args.source_manifest !== undefined) {
    return assertValidModel(await sourceManifestToModel(args.source_manifest, args.title));
  }
  throw new Error("editorial_markup_build requires edit_model, source_text, source_path, or source_manifest.");
}

function renderStaticPart(part: EditorialPart): string {
  if (typeof part === "string") return htmlEscape(part);

  const note = part.note || part.noteTitle
    ? `<sup class="note-marker" title="${htmlEscape([part.noteTitle, part.note].filter(Boolean).join(": "))}">note</sup>`
    : "";
  return [
    part.del ? `<del data-change-id="${htmlEscape(part.id)}">${htmlEscape(part.del)}</del>` : "",
    part.ins ? `<ins data-change-id="${htmlEscape(part.id)}">${htmlEscape(part.ins)}</ins>` : "",
    note,
  ].join("");
}

function renderStaticBlock(block: EditorialBlock): string {
  const contents = block.parts.map(renderStaticPart).join("");
  if (block.type === "heading") {
    const level = block.level ?? 2;
    return `<h${level}>${contents}</h${level}>`;
  }
  return `<p>${contents}</p>`;
}

function getAllChanges(model: EditorialDocument): ChangePart[] {
  return model.blocks.flatMap((block) => block.parts.filter(isChangePart));
}

function renderStaticHtml(model: EditorialDocument, title: string): string {
  const validation = validateEditorialModel(model);
  const notes = getAllChanges(model)
    .filter((change) => change.note || change.noteTitle)
    .map((change) => `<li><strong>${htmlEscape(change.noteTitle ?? change.id)}</strong>${change.note ? `: ${htmlEscape(change.note)}` : ""}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; background: #f4f1ea; color: #1d2524; font: 17px/1.58 Georgia, "Times New Roman", serif; }
    main { max-width: 860px; margin: 40px auto; padding: 48px; background: #fffdf8; border: 1px solid #d7d0c1; }
    h1 { margin: 0 0 24px; font: 700 28px/1.2 system-ui, sans-serif; }
    del { color: #9f1d1d; background: #ffe8e8; text-decoration-thickness: 2px; }
    ins { color: #116235; background: #e7f7ed; text-decoration: underline; text-decoration-thickness: 2px; }
    .note-marker { color: #8b5a00; font: 700 11px/1 system-ui, sans-serif; text-transform: uppercase; margin-left: 3px; }
    aside { margin-top: 32px; padding-top: 20px; border-top: 1px solid #d7d0c1; font: 14px/1.45 system-ui, sans-serif; }
    @media print { body { background: white; } main { margin: 0; border: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <article>
      ${model.blocks.map(renderStaticBlock).join("\n")}
    </article>
    <aside>
      <strong>${validation.changeCount} proposed changes</strong>
      ${notes ? `<ol>${notes}</ol>` : "<p>No editorial notes.</p>"}
    </aside>
  </main>
</body>
</html>
`;
}

function renderInteractiveHtml(model: EditorialDocument, title: string): string {
  const validation = validateEditorialModel(model);
  const scriptModel = jsonForScript(model);
  const cleanPreview = validation.pendingCount === 0
    ? jsonForScript(exportCleanText({ edit_model: model }).text)
    : "null";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #182321;
      --muted: #60706b;
      --panel: #fffdf8;
      --line: #d8d0c1;
      --wash: #f4f1ea;
      --accent: #225f68;
      --delete-bg: #ffe7e6;
      --delete: #9a1f1f;
      --insert-bg: #e5f4ea;
      --insert: #16603a;
      --note-bg: #fff2c6;
      --note: #7a4d00;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; min-height: 100%; }
    body {
      overflow: hidden;
      color: var(--ink);
      background: var(--wash);
      font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #ffffff;
      color: var(--ink);
      font: inherit;
      min-height: 36px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); }
    button:disabled { opacity: .48; cursor: not-allowed; }
    .app-shell {
      height: 100vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .topbar {
      border-bottom: 1px solid var(--line);
      background: #fbfaf5;
      min-width: 0;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 14px 20px 10px;
      min-width: 0;
    }
    h1 {
      margin: 0;
      min-width: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .counts { color: var(--muted); white-space: nowrap; font-size: 13px; }
    .toolbar-scroll {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      padding: 0 20px 12px;
      scrollbar-width: thin;
    }
    .toolbar-scroll > button { flex: 0 0 auto; }
    .main-grid {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      overflow: hidden;
    }
    .workspace {
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 28px;
    }
    .document-page {
      width: min(860px, 100%);
      margin: 0 auto;
      padding: 48px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(38, 33, 24, .08);
      font: 18px/1.65 Georgia, "Times New Roman", serif;
    }
    .document-page p { margin: 0 0 1.1em; }
    .document-page h2, .document-page h3 { font-family: system-ui, sans-serif; line-height: 1.25; }
    .change-token {
      display: inline;
      min-height: 0;
      padding: 1px 2px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      font: inherit;
      text-align: left;
    }
    .change-token.is-selected { outline: 2px solid var(--accent); outline-offset: 2px; }
    del { color: var(--delete); background: var(--delete-bg); text-decoration-thickness: 2px; }
    ins { color: var(--insert); background: var(--insert-bg); text-decoration: underline; text-decoration-thickness: 2px; }
    .note-marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--note-bg);
      color: var(--note);
      font: 700 11px/1 system-ui, sans-serif;
      vertical-align: text-top;
    }
    .sidebar {
      min-width: 0;
      min-height: 0;
      border-left: 1px solid var(--line);
      background: #fbfaf5;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      border-bottom: 1px solid var(--line);
    }
    .tabs button {
      border-width: 0 1px 0 0;
      border-radius: 0;
      background: #f6f2e8;
    }
    .tabs button[aria-selected="true"] {
      background: #ffffff;
      color: var(--accent);
      font-weight: 700;
    }
    .sidebar-inner {
      min-height: 0;
      overflow-y: auto;
      padding: 18px;
    }
    .panel[hidden] { display: none; }
    .detail-grid {
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr);
      gap: 8px 10px;
      align-items: start;
      font-size: 13px;
    }
    .detail-grid dt { color: var(--muted); }
    .detail-grid dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .note-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .note-list button {
      width: 100%;
      text-align: left;
      background: #ffffff;
    }
    .source-wrap {
      max-width: 100%;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #111816;
    }
    .source-wrap pre {
      width: max-content;
      min-width: max(100%, 960px);
      margin: 0;
      padding: 14px;
      color: #eef6ef;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre;
    }
    .clean-output {
      width: 100%;
      min-height: 220px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .status-line { margin: 12px 0 0; color: var(--muted); font-size: 13px; }

    @media (max-width: 820px) {
      body { overflow-y: auto; overflow-x: hidden; }
      .app-shell { height: auto; min-height: 100vh; overflow: visible; }
      .topbar { position: sticky; top: 0; z-index: 5; }
      .title-row { align-items: flex-start; flex-direction: column; gap: 6px; padding-inline: 14px; }
      .toolbar-scroll { padding-inline: 14px; }
      .toolbar-scroll > button { min-width: max-content; }
      .main-grid { display: block; overflow: visible; }
      .workspace { overflow: visible; padding: 14px; }
      .document-page { padding: 24px; font-size: 16px; border-radius: 6px; }
      .sidebar { border-left: 0; border-top: 1px solid var(--line); min-height: 420px; }
      .sidebar-inner { max-height: 62vh; }
    }
  </style>
</head>
<body>
  <div class="app-shell" data-editorial-app>
    <header class="topbar">
      <div class="title-row">
        <h1>${htmlEscape(title)}</h1>
        <div class="counts" data-counts>${validation.changeCount} changes / ${validation.noteCount} notes</div>
      </div>
      <nav class="toolbar-scroll editorial-toolbar" aria-label="Review actions">
        <button type="button" data-action="accept-selected">Accept selected</button>
        <button type="button" data-action="reject-selected">Reject selected</button>
        <button type="button" data-action="accept-all">Accept all</button>
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="copy-clean" disabled>Copy clean</button>
        <button type="button" data-tab-button="source">Source</button>
        <button type="button" data-tab-button="notes">Notes</button>
      </nav>
    </header>
    <main class="main-grid">
      <section class="workspace" data-workspace>
        <article class="document-page" data-document></article>
      </section>
      <aside class="sidebar" aria-label="Editorial review sidebar">
        <div class="tabs" role="tablist">
          <button type="button" data-tab-button="selected" aria-selected="true">Selected</button>
          <button type="button" data-tab-button="notes" aria-selected="false">Notes</button>
          <button type="button" data-tab-button="source" aria-selected="false">Source</button>
        </div>
        <div class="sidebar-inner">
          <section class="panel" data-panel="selected"></section>
          <section class="panel" data-panel="notes" hidden></section>
          <section class="panel" data-panel="source" hidden>
            <div class="source-wrap" data-source-wrap><pre data-source></pre></div>
          </section>
          <section class="panel" data-panel="clean" hidden>
            <textarea class="clean-output" data-clean-output readonly>${cleanPreview === "null" ? "" : htmlEscape(JSON.parse(cleanPreview) as string)}</textarea>
          </section>
          <p class="status-line" data-status-line></p>
        </div>
      </aside>
    </main>
  </div>
  <script>
const documentSource = ${scriptModel};
const statusById = new Map();
const changeById = new Map();
let selectedChangeId = null;

function isChange(part) {
  return part && typeof part === "object" && !Array.isArray(part);
}

function walkChanges(callback) {
  documentSource.blocks.forEach((block, blockIndex) => {
    block.parts.forEach((part, partIndex) => {
      if (!isChange(part)) return;
      callback(part, blockIndex, partIndex);
    });
  });
}

walkChanges((change) => {
  statusById.set(change.id, change.status || "pending");
  changeById.set(change.id, change);
});

function cleanParagraph(parts, allowPending) {
  const text = parts.map((part) => {
    if (!isChange(part)) return part;
    const status = statusById.get(part.id) || "pending";
    if (status === "accepted") return part.ins;
    if (status === "rejected") return part.del;
    if (!allowPending) throw new Error("Resolve all pending changes before copying clean text.");
    return part.ins;
  }).join("");
  return text
    .replace(/[ \\t]+/g, " ")
    .replace(/\\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\\s+/g, "$1")
    .trim();
}

function buildCleanText(allowPending = false) {
  return documentSource.blocks
    .map((block) => cleanParagraph(block.parts, allowPending))
    .filter(Boolean)
    .join("\\n\\n");
}

function counts() {
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  statusById.forEach((status) => {
    if (status === "accepted") accepted += 1;
    else if (status === "rejected") rejected += 1;
    else pending += 1;
  });
  return { pending, accepted, rejected, total: statusById.size };
}

function textNode(value) {
  return document.createTextNode(value);
}

function renderChange(change) {
  const status = statusById.get(change.id) || "pending";
  const token = document.createElement("button");
  token.type = "button";
  token.className = "change-token" + (selectedChangeId === change.id ? " is-selected" : "");
  token.dataset.changeId = change.id;
  token.addEventListener("click", () => selectChange(change.id));

  if (status === "accepted") {
    token.append(textNode(change.ins));
    return token;
  }
  if (status === "rejected") {
    token.append(textNode(change.del));
    return token;
  }

  if (change.del) {
    const del = document.createElement("del");
    del.textContent = change.del;
    token.append(del);
  }
  if (change.ins) {
    const ins = document.createElement("ins");
    ins.textContent = change.ins;
    token.append(ins);
  }
  if (change.note || change.noteTitle) {
    const marker = document.createElement("span");
    marker.className = "note-marker";
    marker.textContent = "i";
    marker.title = [change.noteTitle, change.note].filter(Boolean).join(": ");
    token.append(marker);
  }
  return token;
}

function renderBlock(block) {
  const element = block.type === "heading"
    ? document.createElement("h" + (block.level || 2))
    : document.createElement("p");
  block.parts.forEach((part) => element.append(isChange(part) ? renderChange(part) : textNode(part)));
  return element;
}

function renderDocument() {
  const container = document.querySelector("[data-document]");
  container.replaceChildren(...documentSource.blocks.map(renderBlock));
}

function selectedChange() {
  return selectedChangeId ? changeById.get(selectedChangeId) : undefined;
}

function setStatusLine(message) {
  document.querySelector("[data-status-line]").textContent = message || "";
}

function renderSelectedPanel() {
  const panel = document.querySelector('[data-panel="selected"]');
  const change = selectedChange();
  if (!change) {
    panel.innerHTML = "<p>Select a change in the document.</p>";
    return;
  }
  const status = statusById.get(change.id) || "pending";
  const dl = document.createElement("dl");
  dl.className = "detail-grid";
  [
    ["ID", change.id],
    ["Status", status],
    ["Delete", change.del || "(nothing)"],
    ["Insert", change.ins || "(nothing)"],
    ["Note", [change.noteTitle, change.note].filter(Boolean).join(": ") || "(none)"],
  ].forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  });
  panel.replaceChildren(dl);
}

function renderNotesPanel() {
  const panel = document.querySelector('[data-panel="notes"]');
  const list = document.createElement("ol");
  list.className = "note-list";
  walkChanges((change) => {
    if (!change.note && !change.noteTitle) return;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = (change.noteTitle || change.id) + (change.note ? ": " + change.note : "");
    button.addEventListener("click", () => {
      selectChange(change.id);
      showTab("selected");
    });
    item.append(button);
    list.append(item);
  });
  if (!list.children.length) {
    panel.innerHTML = "<p>No editorial notes.</p>";
    return;
  }
  panel.replaceChildren(list);
}

function renderSourcePanel() {
  document.querySelector("[data-source]").textContent = JSON.stringify(documentSource, null, 2);
}

function renderToolbar() {
  const count = counts();
  document.querySelector("[data-counts]").textContent =
    count.total + " changes / " + count.pending + " pending / " + count.accepted + " accepted / " + count.rejected + " rejected";
  document.querySelector('[data-action="copy-clean"]').disabled = count.pending > 0;
  document.querySelector('[data-action="accept-selected"]').disabled = !selectedChangeId;
  document.querySelector('[data-action="reject-selected"]').disabled = !selectedChangeId;
}

function renderAll() {
  renderDocument();
  renderSelectedPanel();
  renderNotesPanel();
  renderSourcePanel();
  renderToolbar();
}

function selectChange(id) {
  selectedChangeId = id;
  renderAll();
}

function showTab(name) {
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  document.querySelectorAll("[data-tab-button]").forEach((button) => {
    if (button.dataset.tabButton) button.setAttribute("aria-selected", button.dataset.tabButton === name ? "true" : "false");
  });
}

function acceptSelected() {
  if (!selectedChangeId) return;
  statusById.set(selectedChangeId, "accepted");
  renderAll();
}

function rejectSelected() {
  if (!selectedChangeId) return;
  statusById.set(selectedChangeId, "rejected");
  renderAll();
}

function acceptAll() {
  statusById.forEach((_, id) => statusById.set(id, "accepted"));
  renderAll();
}

function resetAll() {
  walkChanges((change) => statusById.set(change.id, change.status || "pending"));
  selectedChangeId = null;
  showTab("selected");
  setStatusLine("");
  renderAll();
}

async function copyClean() {
  const text = buildCleanText(false);
  const output = document.querySelector("[data-clean-output]");
  output.value = text;
  try {
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable.");
    await navigator.clipboard.writeText(text);
    setStatusLine("Copied " + text.length + " characters.");
  } catch (error) {
    showTab("clean");
    output.focus();
    output.select();
    setStatusLine("Clipboard blocked. Clean text is selected for manual copy.");
  }
}

document.querySelector('[data-action="accept-selected"]').addEventListener("click", acceptSelected);
document.querySelector('[data-action="reject-selected"]').addEventListener("click", rejectSelected);
document.querySelector('[data-action="accept-all"]').addEventListener("click", acceptAll);
document.querySelector('[data-action="reset"]').addEventListener("click", resetAll);
document.querySelector('[data-action="copy-clean"]').addEventListener("click", copyClean);
document.querySelectorAll("[data-tab-button]").forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tabButton));
});

window.__editorialMarkup = {
  getState: () => ({ selectedChangeId, counts: counts(), statuses: Object.fromEntries(statusById) }),
  cleanText: buildCleanText,
  acceptAll,
  resetAll,
};

renderAll();
</script>
</body>
</html>
`;
}

export async function buildEditorialMarkup(args: BuildEditorialMarkupArgs): Promise<BuildEditorialMarkupResult> {
  const mode: ReviewMode = args.mode === "static" ? "static" : "interactive";
  const model = await resolveModel(args);
  const validation = validateEditorialModel(model);
  if (!validation.valid) {
    throw new Error(validation.errors.map((error) => error.message).join("; "));
  }

  const title = model.title ?? args.title ?? "Editorial Markup";
  const html = mode === "static"
    ? renderStaticHtml(model, title)
    : renderInteractiveHtml(model, title);
  const htmlPath = resolveOutputPath(args, title);

  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, html, "utf8");

  return {
    htmlPath,
    mode,
    title,
    validation,
    blockCount: validation.blockCount,
    changeCount: validation.changeCount,
    noteCount: validation.noteCount,
  };
}
