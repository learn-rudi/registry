#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const COLOR_PATTERN = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu;
const DEFAULT_THEME = {
  accent: "#7c3aed",
  background: "#f8fafc",
  surface: "#ffffff",
  text: "#172033",
};

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "title",
  "context",
  "constraints",
  "assumptions",
  "options",
  "decisions",
  "theme",
]);
const OPTION_FIELDS = new Set([
  "id",
  "label",
  "summary",
  "pros",
  "cons",
  "risks",
  "evidence",
  "recommended",
]);
const DECISION_FIELDS = new Set(["id", "prompt", "choices", "selected"]);
const CHOICE_FIELDS = new Set(["id", "label", "description"]);
const THEME_FIELDS = new Set(["accent", "background", "surface", "text"]);

function usage() {
  return [
    "Usage: build-decision-canvas.mjs --input <spec.json> --output <canvas.html> [--force]",
    "",
    "Options:",
    "  --input <path>   Decision specification JSON",
    "  --output <path>  Standalone HTML artifact",
    "  --force          Replace an existing regular output file",
    "  --help           Show this help",
  ].join("\n");
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(flag + " requires a value");
  return value;
}

export function parseArgs(args) {
  const options = { input: null, output: null, force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--input" || arg === "--output") {
      options[arg.slice(2)] = readValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + arg);
  }
  if (!options.help && (!options.input || !options.output)) {
    throw new Error("--input and --output are required");
  }
  return options;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(label + " contains unknown field: " + field);
  }
}

function requiredString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(label + " must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(label + " must be at most " + maxLength + " characters");
  }
  return normalized;
}

function optionalString(value, label, maxLength) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(label + " must be a string");
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(label + " must be at most " + maxLength + " characters");
  }
  return normalized;
}

function stringList(value, label, maxItems = 20, maxLength = 400) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(label + " must be an array with at most " + maxItems + " entries");
  }
  return value.map((item, index) =>
    requiredString(item, label + "[" + index + "]", maxLength)
  );
}

function identifier(value, label) {
  const normalized = requiredString(value, label, 64);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(label + " must be lowercase kebab-case");
  }
  return normalized;
}

function assertUniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(label + " contains duplicate id: " + item.id);
    seen.add(item.id);
  }
}

function validateOptions(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    throw new Error("options must contain between 2 and 8 entries");
  }
  const options = value.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error("options[" + index + "] must be an object");
    assertKnownFields(raw, OPTION_FIELDS, "options[" + index + "]");
    if (raw.recommended !== undefined && typeof raw.recommended !== "boolean") {
      throw new Error("options[" + index + "].recommended must be a boolean");
    }
    return {
      id: identifier(raw.id, "options[" + index + "].id"),
      label: requiredString(raw.label, "options[" + index + "].label", 100),
      summary: optionalString(raw.summary, "options[" + index + "].summary", 800),
      pros: stringList(raw.pros, "options[" + index + "].pros", 10),
      cons: stringList(raw.cons, "options[" + index + "].cons", 10),
      risks: stringList(raw.risks, "options[" + index + "].risks", 10),
      evidence: stringList(raw.evidence, "options[" + index + "].evidence", 10),
      recommended: raw.recommended === true,
    };
  });
  assertUniqueIds(options, "options");
  if (options.filter((option) => option.recommended).length > 1) {
    throw new Error("at most one option may be recommended");
  }
  return options;
}

function validateDecisions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error("decisions must contain between 1 and 12 entries");
  }
  const decisions = value.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error("decisions[" + index + "] must be an object");
    assertKnownFields(raw, DECISION_FIELDS, "decisions[" + index + "]");
    if (!Array.isArray(raw.choices) || raw.choices.length < 2 || raw.choices.length > 8) {
      throw new Error("decisions[" + index + "].choices must contain between 2 and 8 entries");
    }
    const choices = raw.choices.map((choice, choiceIndex) => {
      if (!isPlainObject(choice)) {
        throw new Error(
          "decisions[" + index + "].choices[" + choiceIndex + "] must be an object"
        );
      }
      assertKnownFields(
        choice,
        CHOICE_FIELDS,
        "decisions[" + index + "].choices[" + choiceIndex + "]"
      );
      return {
        id: identifier(
          choice.id,
          "decisions[" + index + "].choices[" + choiceIndex + "].id"
        ),
        label: requiredString(
          choice.label,
          "decisions[" + index + "].choices[" + choiceIndex + "].label",
          100
        ),
        description: optionalString(
          choice.description,
          "decisions[" + index + "].choices[" + choiceIndex + "].description",
          300
        ),
      };
    });
    assertUniqueIds(choices, "decisions[" + index + "].choices");
    const selected =
      raw.selected === undefined || raw.selected === ""
        ? ""
        : identifier(raw.selected, "decisions[" + index + "].selected");
    if (selected && !choices.some((choice) => choice.id === selected)) {
      throw new Error("decisions[" + index + "].selected must name one of its choices");
    }
    return {
      id: identifier(raw.id, "decisions[" + index + "].id"),
      prompt: requiredString(raw.prompt, "decisions[" + index + "].prompt", 300),
      choices,
      selected,
    };
  });
  assertUniqueIds(decisions, "decisions");
  return decisions;
}

function validateTheme(value) {
  if (value === undefined) return { ...DEFAULT_THEME };
  if (!isPlainObject(value)) throw new Error("theme must be an object");
  assertKnownFields(value, THEME_FIELDS, "theme");
  const theme = { ...DEFAULT_THEME };
  for (const field of THEME_FIELDS) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || !COLOR_PATTERN.test(value[field])) {
      throw new Error("theme." + field + " must be a three- or six-digit hex color");
    }
    theme[field] = value[field].toLowerCase();
  }
  return theme;
}

export function validateDecisionSpec(raw) {
  if (!isPlainObject(raw)) throw new Error("decision specification must be an object");
  assertKnownFields(raw, TOP_LEVEL_FIELDS, "decision specification");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1 when provided");
  }
  return {
    schemaVersion: 1,
    title: requiredString(raw.title, "title", 120),
    context: optionalString(raw.context, "context", 2000),
    constraints: stringList(raw.constraints, "constraints"),
    assumptions: stringList(raw.assumptions, "assumptions"),
    options: validateOptions(raw.options),
    decisions: validateDecisions(raw.decisions),
    theme: validateTheme(raw.theme),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeEmbeddedJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function renderList(title, items) {
  if (items.length === 0) return "";
  return [
    "<section class=\"detail-list\">",
    "<h4>" + escapeHtml(title) + "</h4>",
    "<ul>",
    items.map((item) => "<li>" + escapeHtml(item) + "</li>").join(""),
    "</ul>",
    "</section>",
  ].join("");
}

function renderOption(option) {
  return [
    "<article class=\"option-card\" data-option-id=\"" + escapeHtml(option.id) + "\">",
    "<div class=\"option-heading\">",
    "<h3>" + escapeHtml(option.label) + "</h3>",
    option.recommended ? "<span class=\"badge\">Recommended</span>" : "",
    "</div>",
    option.summary ? "<p class=\"summary\">" + escapeHtml(option.summary) + "</p>" : "",
    renderList("Benefits", option.pros),
    renderList("Tradeoffs", option.cons),
    renderList("Risks", option.risks),
    renderList("Evidence", option.evidence),
    "<label for=\"note-" + escapeHtml(option.id) + "\">Notes on this option</label>",
    "<textarea id=\"note-" + escapeHtml(option.id) + "\" data-option-note=\"" +
      escapeHtml(option.id) + "\" rows=\"3\" placeholder=\"What should change or be preserved?\"></textarea>",
    "</article>",
  ].join("");
}

function renderDecision(decision) {
  const choices = decision.choices
    .map((choice) => {
      const checked = decision.selected === choice.id ? " checked" : "";
      return [
        "<label class=\"choice\">",
        "<input type=\"radio\" name=\"decision-" + escapeHtml(decision.id) +
          "\" value=\"" + escapeHtml(choice.id) + "\"" + checked + ">",
        "<span><strong>" + escapeHtml(choice.label) + "</strong>",
        choice.description ? "<small>" + escapeHtml(choice.description) + "</small>" : "",
        "</span>",
        "</label>",
      ].join("");
    })
    .join("");
  return [
    "<fieldset class=\"decision\" data-decision-id=\"" + escapeHtml(decision.id) + "\">",
    "<legend>" + escapeHtml(decision.prompt) + "</legend>",
    choices,
    "</fieldset>",
  ].join("");
}

export function buildDecisionCanvasHtml(spec) {
  const embedded = safeEmbeddedJson(spec);
  const constraints = renderList("Constraints", spec.constraints);
  const assumptions = renderList("Assumptions", spec.assumptions);
  const optionCards = spec.options.map(renderOption).join("");
  const decisions = spec.decisions.map(renderDecision).join("");
  const styles = [
    ":root{--accent:" + spec.theme.accent + ";--background:" + spec.theme.background +
      ";--surface:" + spec.theme.surface + ";--text:" + spec.theme.text + ";}",
    "*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;line-height:1.5}",
    "main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}",
    "header{max-width:820px;margin-bottom:32px}.eyebrow{color:var(--accent);font-size:.78rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}",
    "h1{font-size:clamp(2rem,5vw,4rem);line-height:1.03;margin:.25rem 0 1rem}h2{margin:2.5rem 0 1rem}h3,h4,p{margin-top:0}",
    ".context{font-size:1.1rem;max-width:72ch}.meta-grid,.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}",
    ".detail-list,.option-card,.decision,.feedback{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:18px;padding:20px;box-shadow:0 12px 36px color-mix(in srgb,var(--text) 8%,transparent)}",
    ".option-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.badge{background:var(--accent);color:white;border-radius:999px;padding:4px 9px;font-size:.72rem;font-weight:800}",
    ".summary{color:color-mix(in srgb,var(--text) 72%,transparent)}ul{padding-left:20px}.detail-list{box-shadow:none;margin:12px 0;padding:14px}.detail-list h4{font-size:.86rem;margin-bottom:6px}",
    "label{display:block;font-weight:700;margin:14px 0 6px}textarea{width:100%;resize:vertical;border:1px solid color-mix(in srgb,var(--text) 22%,transparent);border-radius:10px;padding:10px;background:var(--background);color:var(--text)}",
    ".decisions{display:grid;gap:14px}.decision{margin:0;border-width:1px}.decision legend{font-weight:800;padding:0 8px}.choice{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;margin:6px 0;background:var(--background)}.choice input{margin-top:5px}.choice small{display:block;font-weight:400;opacity:.72}",
    ".actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}button{border:0;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer;background:var(--accent);color:white}button.secondary{background:var(--text)}#status{min-height:1.5rem;font-weight:700;color:var(--accent);margin-top:10px}",
    "@media(max-width:640px){main{width:min(100% - 20px,1180px);padding-top:28px}.option-card,.decision,.feedback{padding:16px}}",
  ].join("");
  const behavior = [
    "(function(){",
    "\"use strict\";",
    "var spec=JSON.parse(document.getElementById(\"rudi-decision-spec\").textContent);",
    "function feedback(){",
    "var decisions={};document.querySelectorAll(\"[data-decision-id]\").forEach(function(field){var chosen=field.querySelector(\"input:checked\");decisions[field.dataset.decisionId]=chosen?chosen.value:null;});",
    "var optionNotes={};document.querySelectorAll(\"[data-option-note]\").forEach(function(note){if(note.value.trim())optionNotes[note.dataset.optionNote]=note.value.trim();});",
    "return {schemaVersion:1,canvasTitle:spec.title,decisions:decisions,optionNotes:optionNotes,generalNotes:document.getElementById(\"general-notes\").value.trim(),exportedAt:new Date().toISOString()};",
    "}",
    "function serialized(){return JSON.stringify(feedback(),null,2);}",
    "document.getElementById(\"copy-feedback\").addEventListener(\"click\",async function(){var status=document.getElementById(\"status\");try{await navigator.clipboard.writeText(serialized());status.textContent=\"Feedback copied.\";}catch(error){status.textContent=\"Clipboard unavailable. Use Export feedback.\";}});",
    "document.getElementById(\"export-feedback\").addEventListener(\"click\",function(){var blob=new Blob([serialized()],{type:\"application/json\"});var link=document.createElement(\"a\");link.href=URL.createObjectURL(blob);link.download=\"decision-feedback.json\";link.click();URL.revokeObjectURL(link.href);document.getElementById(\"status\").textContent=\"Feedback exported.\";});",
    "})();",
  ].join("");

  return [
    "<!doctype html>",
    "<html lang=\"en\" data-rudi-decision-canvas=\"1\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;\">",
    "<title>" + escapeHtml(spec.title) + "</title>",
    "<style>" + styles + "</style>",
    "</head>",
    "<body><main>",
    "<header><div class=\"eyebrow\">Decision Canvas</div><h1>" + escapeHtml(spec.title) +
      "</h1>" + (spec.context ? "<p class=\"context\">" + escapeHtml(spec.context) + "</p>" : "") + "</header>",
    constraints || assumptions ? "<div class=\"meta-grid\">" + constraints + assumptions + "</div>" : "",
    "<h2>Options</h2><section class=\"options\">" + optionCards + "</section>",
    "<h2>Decisions</h2><section class=\"decisions\">" + decisions + "</section>",
    "<h2>Feedback</h2><section class=\"feedback\"><label for=\"general-notes\">General guidance</label><textarea id=\"general-notes\" rows=\"5\" placeholder=\"What should the implementation preserve, change, or avoid?\"></textarea><div class=\"actions\"><button id=\"copy-feedback\" type=\"button\">Copy feedback</button><button id=\"export-feedback\" class=\"secondary\" type=\"button\">Export feedback</button></div><div id=\"status\" role=\"status\" aria-live=\"polite\"></div></section>",
    "</main>",
    "<script id=\"rudi-decision-spec\" type=\"application/json\">" + embedded + "</script>",
    "<script>" + behavior + "</script>",
    "</body></html>",
    "",
  ].join("\n");
}

async function readSpec(inputPath) {
  const absolute = path.resolve(inputPath);
  const stats = await fs.stat(absolute);
  if (!stats.isFile()) throw new Error("Input is not a regular file: " + inputPath);
  if (stats.size > MAX_INPUT_BYTES) {
    throw new Error("Input exceeds " + MAX_INPUT_BYTES + " bytes");
  }
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(
      "Input is not valid JSON: " + (error instanceof Error ? error.message : String(error))
    );
  }
  return validateDecisionSpec(parsed);
}

async function writeArtifact(outputPath, content, force) {
  const absolute = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  try {
    const existing = await fs.lstat(absolute);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error("Output target must be a regular file: " + outputPath);
    }
    if (!force) throw new Error("Output already exists; pass --force to replace it");
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  await fs.writeFile(absolute, content, { encoding: "utf8", flag: force ? "w" : "wx" });
  return absolute;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage() + "\n");
    return;
  }
  if (path.resolve(options.input) === path.resolve(options.output)) {
    throw new Error("Input and output paths must differ");
  }
  const spec = await readSpec(options.input);
  const output = await writeArtifact(
    options.output,
    buildDecisionCanvasHtml(spec),
    options.force
  );
  process.stdout.write(
    JSON.stringify(
      {
        output,
        title: spec.title,
        optionCount: spec.options.length,
        decisionCount: spec.decisions.length,
      },
      null,
      2
    ) + "\n"
  );
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    process.stderr.write("ERROR: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
