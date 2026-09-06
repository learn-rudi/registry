#!/usr/bin/env node
// Deterministic scanner for the mechanical tells in references/generic-ui-tells.md.
// It reports evidence with a severity. It does not decide; a person does.
//
// Usage:
//   node audit-ui-tells.mjs --root <dir-or-file> [--format markdown|json]
//        [--fail-on none|strong|review] [--ignore dir,dir] [--max-per-tell N]

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_IGNORES = [
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "vendor", ".cache", ".turbo", ".svelte-kit", ".nuxt",
];
const DEFAULT_IGNORE_FILES = new Set(["package-lock.json", "npm-shrinkwrap.json"]);

const SCAN_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".vue", ".svelte", ".astro", ".md", ".mdx", ".json", ".txt",
]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte", ".astro", ".jsx", ".tsx", ".md", ".mdx"]);
const PROSE_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte", ".astro", ".jsx", ".tsx", ".md", ".mdx", ".txt", ".json"]);
const RENDERED_MARKUP_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte", ".astro", ".jsx", ".tsx"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro"]);

const FIXES = {
  "em-dash": "Replace with a period, comma, or colon. Keep at most one true aside per page.",
  "emoji-in-heading": "Remove the emoji. If an icon is needed, use one drawn for the product.",
  "badge-above-headline": "Put the news in the headline or drop the badge. An editorial kicker set in the type system is fine.",
  "lucide-icons": "Use fewer icons. Where they remain, choose a set for the product at one consistent weight.",
  "shadcn-defaults": "Retune radius, ring, type, and spacing scale. Change at least the primary and accent colors.",
  "scroll-reveal": "Remove entrance animation. Use motion only to show a state change.",
  "cursor-glow": "Remove the cursor-following effect.",
  "grain-texture": "Remove the noise overlay. Take texture from real photography or print references if the brand needs it.",
  "buzzwords": "Say what the thing does, for whom, in the words a customer would use.",
  "purple-blue-gradient": "Use one flat brand color, or a photograph with a functional scrim.",
  "decorative-gradient": "Keep the gradient only if it aids legibility over an image. Otherwise use a flat color.",
  "gradient-text": "Fill the headline with solid ink. Emphasize with size, weight, or one accent color.",
  "tell-font-pairing": "Choose a typeface pairing for a stated reason and record the reason.",
  "inter-only": "Keep Inter for body text if you like it, but pair it with a display face chosen for the product.",
  "glassmorphism": "Use an opaque surface. Blur is acceptable on one functional floating control over moving content.",
  "low-contrast": "Raise text luminance. Build hierarchy with size and weight rather than dimming.",
  "hover-fade": "Give the control a real hover state: background shift, border, or underline that raises contrast.",
  "serif-italic-accent": "Emphasize with one weight or one color change in the same family.",
  "left-border-card": "Use white space, a heading, or a background tint. If a marker is needed, make it part of the type system.",
  "icon-box-trio": "Give each point a real image or a full sentence, and vary the rhythm across sections.",
};

const BUZZWORDS = [
  "seamless", "seamlessly", "cutting-edge", "next-generation", "next-gen",
  "revolutionize", "revolutionary", "supercharge", "supercharged", "unlock",
  "unleash", "empower", "empowering", "elevate", "effortless", "effortlessly",
  "game-changing", "game changer", "world-class", "state-of-the-art",
  "leverage", "synergy", "streamline", "harness", "redefine", "reimagine",
  "delve", "in today's fast-paced", "best-in-class", "turbocharge",
  "frictionless", "10x", "all-in-one",
];

const GENERIC_FAMILIES = new Set([
  "sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif",
  "ui-monospace", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto",
  "helvetica", "helvetica neue", "arial", "inherit", "initial", "cursive",
  "fantasy", "emoji", "math", "fangsong", "apple color emoji", "segoe ui emoji",
  "segoe ui symbol", "noto color emoji", "sfmono-regular", "menlo", "monaco",
  "consolas", "liberation mono", "courier new", "var", "unset",
]);

const SERIF_FAMILIES = [
  "instrument serif", "playfair", "fraunces", "cormorant", "lora", "merriweather",
  "georgia", "times", "garamond", "baskerville", "dm serif", "newsreader",
  "source serif", "crimson", "spectral", "literata", "gloock", "bodoni",
];

const NAMED_COLORS = {
  purple: [128, 0, 128], violet: [238, 130, 238], indigo: [75, 0, 130],
  blue: [0, 0, 255], blueviolet: [138, 43, 226], mediumpurple: [147, 112, 219],
  royalblue: [65, 105, 225], dodgerblue: [30, 144, 255], slateblue: [106, 90, 205],
  rebeccapurple: [102, 51, 153], orchid: [218, 112, 214], magenta: [255, 0, 255],
  red: [255, 0, 0], orange: [255, 165, 0], green: [0, 128, 0], teal: [0, 128, 128],
  cyan: [0, 255, 255], pink: [255, 192, 203], gold: [255, 215, 0],
};

// ---------- argument parsing ----------

function usage() {
  return [
    "Usage: node audit-ui-tells.mjs --root <dir-or-file> [options]",
    "",
    "Options:",
    "  --format markdown|json   Output format (default markdown)",
    "  --fail-on none|strong|review",
    "                           Exit 1 when findings at or above this level exist (default none)",
    "  --ignore a,b             Extra directory names to skip",
    "  --max-per-tell N         Cap findings per tell per file in the output (default 20)",
    "  --help                   Show this message",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { root: null, format: "markdown", failOn: "none", ignore: [], maxPerTell: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    switch (arg) {
      case "--root": options.root = next(); break;
      case "--format": options.format = next(); break;
      case "--fail-on": options.failOn = next(); break;
      case "--ignore": options.ignore = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--max-per-tell": options.maxPerTell = Number.parseInt(next(), 10); break;
      case "--help": case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.help) return options;
  if (!options.root) throw new Error("--root is required");
  if (!["markdown", "json"].includes(options.format)) throw new Error("--format must be markdown or json");
  if (!["none", "strong", "review"].includes(options.failOn)) throw new Error("--fail-on must be none, strong, or review");
  if (!Number.isInteger(options.maxPerTell) || options.maxPerTell < 1) throw new Error("--max-per-tell must be a positive integer");
  return options;
}

// ---------- file discovery ----------

async function collectFiles(root, ignores) {
  const stat = await fs.stat(root);
  if (stat.isFile()) return [root];
  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignores.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const supported = SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
        if (!DEFAULT_IGNORE_FILES.has(entry.name) && supported) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  }
  await walk(root);
  return results;
}

// ---------- text helpers ----------

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid; else high = mid - 1;
  }
  return low + 1;
}

function snippet(text, limit = 120) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function extractRules(text) {
  // Innermost `selector { body }` blocks. Nested at-rules resolve to their inner rules.
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const selectorRaw = match[1];
    const selector = selectorRaw.split(/[;}]/).pop().trim();
    if (!selector || selector.startsWith("//")) continue;
    rules.push({ selector, body: match[2], index: match.index + selectorRaw.length });
  }
  return rules;
}

function declarations(body) {
  return body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(":");
    if (colon === -1) return null;
    return { property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() };
  }).filter(Boolean);
}

// ---------- color helpers ----------

function hexToRgb(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3 || value.length === 4) value = value.split("").map((c) => c + c).join("");
  if (value.length === 8) {
    const alpha = Number.parseInt(value.slice(6, 8), 16) / 255;
    if (alpha < 0.9) return null;
    value = value.slice(0, 6);
  }
  if (value.length !== 6 || /[^0-9a-f]/i.test(value)) return null;
  const number = Number.parseInt(value, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function parseColorTokens(source) {
  const colors = [];
  const hexPattern = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
  let match;
  while ((match = hexPattern.exec(source)) !== null) {
    const rgb = hexToRgb(match[0]);
    if (rgb) colors.push(rgb);
  }
  const rgbPattern = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;
  while ((match = rgbPattern.exec(source)) !== null) {
    let alpha = 1;
    if (match[4]) alpha = match[4].endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number.parseFloat(match[4]);
    if (alpha < 0.9) continue;
    colors.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  const namedPattern = /\b([a-z]+)\b/gi;
  while ((match = namedPattern.exec(source)) !== null) {
    const named = NAMED_COLORS[match[1].toLowerCase()];
    if (named) colors.push(named);
  }
  return colors;
}

function chroma([r, g, b]) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function hue([r, g, b]) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb); const delta = max - min;
  if (delta === 0) return 0;
  let h;
  if (max === rr) h = ((gg - bb) / delta) % 6;
  else if (max === gg) h = (bb - rr) / delta + 2;
  else h = (rr - gg) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const la = luminance(a); const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function balancedSlice(text, openIndex) {
  // text[openIndex] is "(". Returns the inside of the balanced parentheses.
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return text.slice(openIndex + 1);
}

// ---------- checks ----------

const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_EXCLUDE = /[©®™ℹ]/u;

function hasEmoji(line) {
  for (const ch of line) {
    if (EMOJI.test(ch) && !EMOJI_EXCLUDE.test(ch)) return true;
  }
  return false;
}

function scanFile(relativeFile, text) {
  const ext = path.extname(relativeFile).toLowerCase();
  const findings = [];
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const add = (tell, severity, line, evidence) => {
    findings.push({ tell, severity, file: relativeFile, line, evidence: snippet(evidence), fix: FIXES[tell] });
  };
  const isMarkup = MARKUP_EXTENSIONS.has(ext);
  const isProse = PROSE_EXTENSIONS.has(ext);
  const isRenderedMarkup = RENDERED_MARKUP_EXTENSIONS.has(ext);
  const isStyleBearing = STYLE_EXTENSIONS.has(ext) || isRenderedMarkup;
  const isScript = SCRIPT_EXTENSIONS.has(ext);
  const emDashOccurrences = [];

  // Line-based checks.
  const buzzPattern = new RegExp(`\\b(${BUZZWORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  lines.forEach((line, offset) => {
    const number = offset + 1;
    if (isProse) {
      const count = line.match(/\u2014/g)?.length ?? 0;
      if (count > 0) emDashOccurrences.push({ line: number, evidence: line, count });
    }
    if (isProse && buzzPattern.test(line) && !/^\s*(import|export|\/\/|\*|<script|<style)/.test(line)) {
      add("buzzwords", "review", number, line);
    }
    if (isMarkup) {
      const htmlHeading = /<h[1-6][\s>]/i.test(line);
      const mdHeading = /^\s{0,3}#{1,6}\s/.test(line);
      if ((htmlHeading || mdHeading) && hasEmoji(line)) add("emoji-in-heading", "strong", number, line);
    }
    const lucideImport = isScript && /\bfrom\s*["'][^"']*\blucide(?:-[^"']*)?["']|\brequire\(\s*["'][^"']*\blucide|\bimport\s*\(\s*["'][^"']*\blucide/i
      .test(line);
    const lucideMarkup = isRenderedMarkup && /class(Name)?=["'][^"']*\blucide(?:-[\w-]+)?\b|data-lucide\s*=|<Lucide[A-Z]\w*\b/
      .test(line);
    if (lucideImport || lucideMarkup) add("lucide-icons", "review", number, line);
    const libraryReveal = isRenderedMarkup && /<[^>]*\bdata-aos\s*=|\bwhileInView\s*=/.test(line);
    const scriptedReveal = isScript && /\bAOS\.init\s*\(|\bScrollReveal\s*\(|\bScrollTrigger\.(create|batch)\s*\(/.test(line);
    if (libraryReveal || scriptedReveal) add("scroll-reveal", "strong", number, line);
    const turbulenceTag = "<" + "feTurbulence";
    if ((isRenderedMarkup || isScript) && line.includes(turbulenceTag)) {
      add("grain-texture", "strong", number, line);
    }
    const shadcnImport = isScript && /\bfrom\s*["']@\/components\/ui\/|\bimport\s*\(\s*["']@\/components\/ui\//.test(line);
    const shadcnToken = isStyleBearing && /--radius:\s*0\.5rem|hsl\(var\(--/.test(line);
    if (shadcnImport || shadcnToken) {
      add("shadcn-defaults", "review", number, line);
    }
    if (isStyleBearing && /backdrop-filter\s*:[^;]*blur\(/i.test(line)) add("glassmorphism", "review", number, line);
    if (isRenderedMarkup && /class(Name)?=["'][^"']*\b(grain|noise)(-overlay|-texture)?\b/i.test(line)) {
      add("grain-texture", "review", number, line);
    }
    if (isRenderedMarkup && /class(Name)?=["'][^"']*\b(glow|spotlight|cursor-follow)/i.test(line)) {
      add("cursor-glow", "review", number, line);
    }
  });

  const emDashCount = emDashOccurrences.reduce((total, item) => total + item.count, 0);
  if (emDashCount > 1) {
    const first = emDashOccurrences[0];
    add("em-dash", "strong", first.line, `${emDashCount} em dashes in file. ${first.evidence}`);
  }

  // Whole-file checks.
  const mousemoveListener = isScript && /addEventListener\s*\(\s*["']mousemove["']|\bonmousemove\s*=/.test(text);
  if (mousemoveListener && /(setProperty\(|style\.left|style\.top|translate\(|--mouse|--cursor|--x\b|--y\b)/.test(text)) {
    const index = text.search(/addEventListener\s*\(\s*["']mousemove["']|\bonmousemove\s*=/);
    add("cursor-glow", "strong", lineAt(starts, index), lines[lineAt(starts, index) - 1]);
  }
  if (isScript && /new\s+IntersectionObserver\s*\(/.test(text) && /classList\.(add|toggle)\(/.test(text)) {
    const index = text.search(/new\s+IntersectionObserver\s*\(/);
    add("scroll-reveal", "review", lineAt(starts, index), lines[lineAt(starts, index) - 1]);
  }
  const keyframe = isStyleBearing
    ? /@keyframes\s+(fadeIn|fade-in|fadeUp|fade-up|fadeInUp|slideUp|slide-up|reveal)\b/i.exec(text)
    : null;
  if (keyframe) add("scroll-reveal", "review", lineAt(starts, keyframe.index), keyframe[0]);

  const hasGrotesk = /Space[\s+]Grotesk/i.test(text);
  const hasInstrument = /Instrument[\s+]Serif/i.test(text);
  if ((isStyleBearing || isScript) && (hasGrotesk || hasInstrument)) {
    const index = hasGrotesk ? text.search(/Space[\s+]Grotesk/i) : text.search(/Instrument[\s+]Serif/i);
    const severity = hasGrotesk && hasInstrument ? "strong" : "review";
    add("tell-font-pairing", severity, lineAt(starts, index), lines[lineAt(starts, index) - 1]);
  }

  if (isRenderedMarkup) {
    const badge = /class(Name)?=["'][^"']*\b(badge|pill|chip)\b[^"']*["'][^>]*>[\s\S]{0,240}?<h1\b/i.exec(text);
    if (badge) add("badge-above-headline", "review", lineAt(starts, badge.index), badge[0].split("\n")[0]);
    const iconBoxes = text.match(/<svg[\s\S]{0,2000}?<\/svg>\s*(?:<[^>]+>\s*)*<h[2-6]\b/gi);
    if (iconBoxes && iconBoxes.length >= 3) {
      const index = text.indexOf(iconBoxes[0]);
      add("icon-box-trio", "review", lineAt(starts, index), `${iconBoxes.length} icon-plus-heading blocks`);
    }
  }

  // Gradient checks over every gradient call in the file.
  const gradientPattern = /(linear|radial|conic)-gradient\(/gi;
  let gradientMatch;
  while (isStyleBearing && (gradientMatch = gradientPattern.exec(text)) !== null) {
    const openIndex = gradientMatch.index + gradientMatch[0].length - 1;
    const inside = balancedSlice(text, openIndex);
    const colors = parseColorTokens(inside).filter((rgb) => chroma(rgb) > 0.2);
    if (colors.length < 2) continue;
    const line = lineAt(starts, gradientMatch.index);
    const hues = colors.map(hue);
    const allBluePurple = hues.every((h) => h >= 195 && h <= 300);
    const evidence = `${gradientMatch[0]}${snippet(inside, 80)})`;
    if (allBluePurple) add("purple-blue-gradient", "strong", line, evidence);
    else add("decorative-gradient", "review", line, evidence);
  }

  // Rule-based CSS checks.
  const familyNames = new Set();
  for (const rule of isStyleBearing ? extractRules(text) : []) {
    const line = lineAt(starts, rule.index);
    const decls = declarations(rule.body);
    const bodyLower = rule.body.toLowerCase();
    const get = (name) => decls.filter((d) => d.property === name || d.property === `-webkit-${name}`);

    if (get("background-clip").some((d) => /\btext\b/i.test(d.value)) || get("text-fill-color").some((d) => /transparent/i.test(d.value))) {
      if (/gradient\(/i.test(rule.body)) add("gradient-text", "strong", line, `${rule.selector} { ${snippet(rule.body, 80)} }`);
    }

    const backgrounds = [...get("background"), ...get("background-color")];
    const colorsDecl = get("color");
    if (backgrounds.length && colorsDecl.length) {
      const bg = parseColorTokens(backgrounds[backgrounds.length - 1].value)[0];
      const fg = parseColorTokens(colorsDecl[colorsDecl.length - 1].value)[0];
      if (bg && fg) {
        const ratio = contrastRatio(bg, fg);
        if (ratio < 4.5) add("low-contrast", "review", line, `${rule.selector}: contrast ${ratio.toFixed(2)}:1`);
      }
    }

    if (/:hover\b/.test(rule.selector) && decls.length) {
      const props = decls.map((d) => d.property);
      const onlyOpacity = props.includes("opacity") && props.every((p) => p === "opacity" || p.startsWith("transition") || p === "cursor");
      if (onlyOpacity) add("hover-fade", "review", line, `${rule.selector} { ${snippet(rule.body, 80)} }`);
    }

    const families = get("font-family").map((d) => d.value);
    for (const value of families) {
      for (const raw of value.split(",")) {
        const name = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
        if (name && !name.startsWith("var(") && !GENERIC_FAMILIES.has(name)) familyNames.add(name);
      }
    }
    if (bodyLower.includes("font-style") && /font-style\s*:\s*italic/i.test(rule.body)) {
      const familyValue = families.join(",").toLowerCase();
      const serifFamily = /(^|,)\s*serif\s*(,|$)/.test(familyValue) || SERIF_FAMILIES.some((f) => familyValue.includes(f));
      const headingScope = /\b(h[1-6]|hero|title|headline|display|heading)\b/i.test(rule.selector);
      if (serifFamily || headingScope) add("serif-italic-accent", "review", line, `${rule.selector} { ${snippet(rule.body, 80)} }`);
    }

    const leftBorder = [...get("border-left"), ...get("border-left-width")];
    if (leftBorder.some((d) => /\b([3-9]|\d{2,})px\b/.test(d.value)) && (bodyLower.includes("padding") || bodyLower.includes("border-radius"))) {
      add("left-border-card", "review", line, `${rule.selector} { ${snippet(rule.body, 80)} }`);
    }
  }
  const googleFamilies = isStyleBearing ? text.match(/family=([^&:"')]+)/g) || [] : [];
  for (const param of googleFamilies) {
    const name = decodeURIComponent(param.slice(7)).replace(/\+/g, " ").toLowerCase();
    if (!GENERIC_FAMILIES.has(name)) familyNames.add(name);
  }
  if (familyNames.size === 1 && familyNames.has("inter")) {
    const index = text.search(/inter/i);
    add("inter-only", "review", lineAt(starts, index), lines[lineAt(starts, index) - 1]);
  }

  return findings;
}

// ---------- output ----------

const SEVERITY_RANK = { review: 1, strong: 2 };

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function renderMarkdown(report) {
  const out = [];
  out.push(`# Design rulebook scan: ${report.root}`, "");
  out.push(`Files scanned: ${report.summary.filesScanned}. Findings: ${report.summary.findings} (${report.summary.strong} strong, ${report.summary.review} review).`);
  if (report.summary.omitted > 0) out.push(`Omitted from the table by --max-per-tell: ${report.summary.omitted}.`);
  out.push("");
  if (!report.findings.length) {
    out.push("No mechanical tells found. Manual tells (uniform spacing, untouched component defaults, rendered layout) still need a look.");
    return out.join("\n");
  }
  out.push("| Tell | Severity | Count |", "|---|---|---|");
  for (const [tell, count] of Object.entries(report.summary.byTell)) {
    const severity = report.summary.severityByTell[tell] ?? "";
    out.push(`| ${tell} | ${severity} | ${count} |`);
  }
  out.push("", "## Findings", "", "| Tell | Severity | File:line | Evidence | Fix |", "|---|---|---|---|---|");
  for (const finding of report.findings) {
    out.push(`| ${finding.tell} | ${finding.severity} | ${escapeCell(finding.file)}:${finding.line} | ${escapeCell(finding.evidence)} | ${escapeCell(finding.fix)} |`);
  }
  return out.join("\n");
}

// ---------- main ----------

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exit(1);
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const root = path.resolve(options.root);
  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch {
    process.stderr.write(`Audit root does not exist: ${root}\n`);
    process.exit(1);
  }

  const ignores = new Set([...DEFAULT_IGNORES, ...options.ignore]);
  const files = await collectFiles(root, ignores);
  const baseDir = rootStat.isFile() ? path.dirname(root) : root;

  const allFindings = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const relative = path.relative(baseDir, file).split(path.sep).join("/");
    allFindings.push(...scanFile(relative, text));
  }

  allFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.tell.localeCompare(b.tell));

  const perFileTell = new Map();
  const kept = [];
  let omitted = 0;
  for (const finding of allFindings) {
    const key = `${finding.file}::${finding.tell}`;
    const count = (perFileTell.get(key) ?? 0) + 1;
    perFileTell.set(key, count);
    if (count <= options.maxPerTell) kept.push(finding); else omitted += 1;
  }

  const byTell = {};
  const severityByTell = {};
  for (const finding of allFindings) {
    byTell[finding.tell] = (byTell[finding.tell] ?? 0) + 1;
    const current = severityByTell[finding.tell];
    if (!current || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current]) {
      severityByTell[finding.tell] = finding.severity;
    }
  }

  const report = {
    root,
    summary: {
      filesScanned: files.length,
      findings: allFindings.length,
      strong: allFindings.filter((f) => f.severity === "strong").length,
      review: allFindings.filter((f) => f.severity === "review").length,
      byTell: Object.fromEntries(Object.entries(byTell).sort(([a], [b]) => a.localeCompare(b))),
      severityByTell: Object.fromEntries(
        Object.entries(severityByTell).sort(([a], [b]) => a.localeCompare(b))
      ),
      omitted,
    },
    findings: kept,
  };

  if (options.format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${renderMarkdown(report)}\n`);

  if (options.failOn === "strong" && report.summary.strong > 0) process.exit(1);
  if (options.failOn === "review" && report.summary.findings > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
