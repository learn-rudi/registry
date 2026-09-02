import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

import type { Package } from "./resolver.js";

export interface CatalogPackageFile {
  path: string;
  manifest: Package;
}

export class CatalogPackageError extends Error {
  constructor(
    message: string,
    public file?: string,
    public packageId?: string
  ) {
    super(packageId ? `[${packageId}] ${message}` : message);
    this.name = "CatalogPackageError";
  }
}

type FrontmatterValue = string | string[] | boolean | FrontmatterObject;
interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

const CATALOG_PACKAGE_PATTERNS = [
  "catalog/agents/*.json",
  "catalog/binaries/*.json",
  "catalog/runtimes/*.json",
  "catalog/stacks/*/manifest.json",
  "catalog/skills/**/*.md",
];

const VERSION_SUFFIXED_METADATA_PATTERNS = [
  "catalog/**/v2/**/*.json",
  "catalog/**/manifest.v2.json",
];

const SKILL_FRONTMATTER_KEYS = new Set([
  "id",
  "name",
  "description",
  "kind",
  "version",
  "category",
  "tags",
  "icon",
  "author",
  "requires",
  "disable-model-invocation",
]);

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function isCanonicalManifestPath(file: string): boolean {
  const normalized = toPosixPath(file);
  return (
    /^catalog\/(agents|binaries|runtimes)\/[^/]+\.json$/.test(normalized) ||
    /^catalog\/stacks\/[^/]+\/manifest\.json$/.test(normalized)
  );
}

function isSkillMarkdownPath(file: string): boolean {
  const normalized = toPosixPath(file);
  if (!normalized.startsWith("catalog/skills/")) return false;

  const relativePath = normalized.slice("catalog/skills/".length);
  const segments = relativePath.split("/");
  return (
    (segments.length === 1 && relativePath.endsWith(".md")) ||
    (segments.length === 2 && segments[1] === "SKILL.md")
  );
}

async function readJson(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CatalogPackageError(`Invalid JSON in ${file}: ${message}`, file);
  }
}

function countIndent(line: string, file: string): number {
  if (line.includes("\t")) {
    throw new CatalogPackageError(
      "Skill frontmatter must use spaces for indentation, not tabs",
      file
    );
  }
  return line.match(/^ */)?.[0].length ?? 0;
}

function isIgnorableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function nextDataLine(lines: string[], start: number): number {
  let index = start;
  while (index < lines.length && isIgnorableLine(lines[index])) index += 1;
  return index;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string, file: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new CatalogPackageError(`Invalid inline list: ${value}`, file);
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
}

function parseScalar(value: string, file: string): string | string[] | boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
    return parseInlineList(trimmed, file);
  }
  const quoted =
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (!quoted && trimmed === "true") return true;
  if (!quoted && trimmed === "false") return false;
  return stripQuotes(trimmed);
}

function parseArray(
  lines: string[],
  start: number,
  indent: number,
  file: string
): { value: string[]; nextIndex: number } {
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    if (isIgnorableLine(lines[index])) {
      index += 1;
      continue;
    }

    const lineIndent = countIndent(lines[index], file);
    if (lineIndent < indent) break;
    if (lineIndent !== indent || !lines[index].trim().startsWith("- ")) {
      throw new CatalogPackageError(
        `Unsupported skill frontmatter array syntax: ${lines[index].trim()}`,
        file
      );
    }

    const value = lines[index].trim().slice(2).trim();
    if (!value) {
      throw new CatalogPackageError("Skill frontmatter arrays require scalar items", file);
    }
    items.push(stripQuotes(value));
    index += 1;
  }

  return { value: items, nextIndex: index };
}

function parseObject(
  lines: string[],
  start: number,
  indent: number,
  file: string
): { value: FrontmatterObject; nextIndex: number } {
  const value: FrontmatterObject = {};
  let index = start;

  while (index < lines.length) {
    if (isIgnorableLine(lines[index])) {
      index += 1;
      continue;
    }

    const line = lines[index];
    const lineIndent = countIndent(line, file);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw new CatalogPackageError(
        `Unexpected skill frontmatter indentation: ${line.trim()}`,
        file
      );
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      throw new CatalogPackageError(
        `Unexpected skill frontmatter array item: ${trimmed}`,
        file
      );
    }

    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(trimmed);
    if (!match) {
      throw new CatalogPackageError(
        `Unsupported skill frontmatter line: ${trimmed}`,
        file
      );
    }

    const [, key, rawValue] = match;
    const scalarValue = rawValue.trim();
    if (scalarValue) {
      value[key] = parseScalar(scalarValue, file);
      index += 1;
      continue;
    }

    const childIndex = nextDataLine(lines, index + 1);
    if (childIndex >= lines.length || countIndent(lines[childIndex], file) <= indent) {
      value[key] = {};
      index += 1;
      continue;
    }

    const childIndent = countIndent(lines[childIndex], file);
    if (lines[childIndex].trim().startsWith("- ")) {
      const parsed = parseArray(lines, childIndex, childIndent, file);
      value[key] = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    const parsed = parseObject(lines, childIndex, childIndent, file);
    value[key] = parsed.value;
    index = parsed.nextIndex;
  }

  return { value, nextIndex: index };
}

function parseFrontmatter(content: string, file: string): FrontmatterObject {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) {
    throw new CatalogPackageError("Skill Markdown must start with YAML frontmatter", file);
  }

  const lines = match[1].split("\n");
  return parseObject(lines, 0, 0, file).value;
}

function requireString(
  frontmatter: FrontmatterObject,
  key: string,
  file: string
): string {
  const value = frontmatter[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogPackageError(`Skill frontmatter requires string field: ${key}`, file);
  }
  return value.trim();
}

function optionalString(
  frontmatter: FrontmatterObject,
  key: string,
  file: string
): string | undefined {
  const value = frontmatter[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CatalogPackageError(`Skill frontmatter field must be a string: ${key}`, file);
  }
  return value.trim();
}

function optionalBoolean(
  frontmatter: FrontmatterObject,
  key: string,
  file: string
): boolean | undefined {
  const value = frontmatter[key];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new CatalogPackageError(
    `Skill frontmatter field must be a boolean: ${key}`,
    file
  );
}

function optionalStringArray(
  frontmatter: FrontmatterObject,
  key: string,
  file: string
): string[] | undefined {
  const value = frontmatter[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new CatalogPackageError(
      `Skill frontmatter field must be a string array: ${key}`,
      file
    );
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizePackageId(kind: "skill" | "stack", value: string, file: string): string {
  const trimmed = value.trim();
  const id = trimmed.includes(":") ? trimmed : `${kind}:${trimmed}`;
  const pattern = new RegExp(`^${kind}:[a-z0-9][a-z0-9-_]*$`);
  if (!pattern.test(id)) {
    throw new CatalogPackageError(`Invalid ${kind} package id: ${value}`, file);
  }
  return id;
}

function parseSkillRequires(
  frontmatter: FrontmatterObject,
  file: string
): Package["requires"] | undefined {
  const value = frontmatter.requires;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogPackageError("Skill frontmatter requires must be an object", file);
  }

  const requires = value as FrontmatterObject;
  const keys = Object.keys(requires);
  for (const key of keys) {
    if (key !== "stacks") {
      throw new CatalogPackageError(
        `Unsupported skill requires field: ${key}`,
        file
      );
    }
  }

  const stacks = requires.stacks;
  if (stacks === undefined) return undefined;
  if (!Array.isArray(stacks) || !stacks.every((item) => typeof item === "string")) {
    throw new CatalogPackageError(
      "Skill frontmatter requires.stacks must be a string array",
      file
    );
  }

  return {
    stacks: stacks.map((item) => normalizePackageId("stack", item, file)),
  };
}

function packageFromSkillMarkdown(file: string, content: string): Package {
  const frontmatter = parseFrontmatter(content, file);
  for (const key of Object.keys(frontmatter)) {
    if (!SKILL_FRONTMATTER_KEYS.has(key)) {
      throw new CatalogPackageError(`Unsupported skill frontmatter field: ${key}`, file);
    }
  }

  const normalizedFile = toPosixPath(file);
  const isBundledSkill = normalizedFile.endsWith("/SKILL.md");
  const slug = isBundledSkill
    ? path.posix.basename(path.posix.dirname(normalizedFile))
    : path.posix.basename(normalizedFile, ".md");
  const installPath = isBundledSkill
    ? path.posix.dirname(normalizedFile)
    : normalizedFile;
  const derivedId = normalizePackageId("skill", slug, file);
  const declaredKind = optionalString(frontmatter, "kind", file);
  if (declaredKind !== undefined && declaredKind !== "skill") {
    throw new CatalogPackageError("Skill frontmatter kind must be skill", file);
  }

  const declaredId = optionalString(frontmatter, "id", file);
  if (declaredId !== undefined) {
    const normalizedId = normalizePackageId("skill", declaredId, file);
    if (normalizedId !== derivedId) {
      throw new CatalogPackageError(
        `Skill frontmatter id ${normalizedId} does not match path-derived id ${derivedId}`,
        file,
        normalizedId
      );
    }
  }

  const name = requireString(frontmatter, "name", file);
  const description = requireString(frontmatter, "description", file);
  const version = optionalString(frontmatter, "version", file) ?? "1.0.0";
  const category = optionalString(frontmatter, "category", file);
  const icon = optionalString(frontmatter, "icon", file);
  const author = optionalString(frontmatter, "author", file);
  const tags = optionalStringArray(frontmatter, "tags", file);
  const requires = parseSkillRequires(frontmatter, file);
  optionalBoolean(frontmatter, "disable-model-invocation", file);

  return {
    id: derivedId,
    kind: "skill",
    name,
    version,
    delivery: "remote",
    install: {
      source: "catalog",
      path: installPath,
    },
    ...(requires ? { requires } : {}),
    meta: {
      description,
      ...(category ? { category } : {}),
      ...(tags ? { tags } : {}),
      ...(icon ? { icon } : {}),
      ...(author ? { author } : {}),
    },
  };
}

export async function discoverCatalogPackageFiles(root = process.cwd()): Promise<string[]> {
  const versionSuffixed = await fg(VERSION_SUFFIXED_METADATA_PATTERNS, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
  if (versionSuffixed.length > 0) {
    throw new CatalogPackageError(
      `Version-suffixed catalog metadata is not allowed: ${versionSuffixed.sort().join(", ")}`,
      versionSuffixed.sort()[0]
    );
  }

  const files = await fg(CATALOG_PACKAGE_PATTERNS, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  return files
    .filter((file) => isCanonicalManifestPath(file) || isSkillMarkdownPath(file))
    .sort();
}

export async function readCatalogPackage(
  file: string,
  root = process.cwd()
): Promise<CatalogPackageFile> {
  const normalizedFile = toPosixPath(file);
  const absoluteFile = path.join(root, normalizedFile);

  if (isSkillMarkdownPath(normalizedFile)) {
    const content = await fs.readFile(absoluteFile, "utf8");
    return {
      path: normalizedFile,
      manifest: packageFromSkillMarkdown(normalizedFile, content),
    };
  }

  if (isCanonicalManifestPath(normalizedFile)) {
    return {
      path: normalizedFile,
      manifest: await readJson(absoluteFile) as Package,
    };
  }

  throw new CatalogPackageError(`Unsupported catalog package file: ${file}`, normalizedFile);
}

export async function discoverCatalogPackages(root = process.cwd()): Promise<CatalogPackageFile[]> {
  const files = await discoverCatalogPackageFiles(root);
  const packages: CatalogPackageFile[] = [];

  for (const file of files) {
    packages.push(await readCatalogPackage(file, root));
  }

  return packages.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function assertCatalogReferences(packages: CatalogPackageFile[]): void {
  const byId = new Map<string, CatalogPackageFile>();
  for (const item of packages) {
    const existing = byId.get(item.manifest.id);
    if (existing) {
      throw new CatalogPackageError(
        `Duplicate package id also declared in ${existing.path}`,
        item.path,
        item.manifest.id
      );
    }
    byId.set(item.manifest.id, item);
  }

  const skillIds = new Set(
    packages.filter((item) => item.manifest.kind === "skill").map((item) => item.manifest.id)
  );
  const stackIds = new Set(
    packages.filter((item) => item.manifest.kind === "stack").map((item) => item.manifest.id)
  );

  for (const item of packages) {
    const replacementId = item.manifest.lifecycle?.deprecation?.replacementId;
    if (replacementId !== undefined && !byId.has(replacementId)) {
      throw new CatalogPackageError(
        `lifecycle.deprecation.replacementId references unknown package: ${replacementId}`,
        item.path,
        item.manifest.id
      );
    }

    for (const skillId of item.manifest.related?.skills ?? []) {
      if (!skillIds.has(skillId)) {
        throw new CatalogPackageError(
          `related.skills references unknown skill: ${skillId}`,
          item.path,
          item.manifest.id
        );
      }
    }

    if (item.manifest.kind === "stack" && !item.manifest.related?.operatorSkill) {
      throw new CatalogPackageError(
        "related.operatorSkill is required for published stacks",
        item.path,
        item.manifest.id
      );
    }

    const operatorSkill = item.manifest.related?.operatorSkill;
    if (
      item.manifest.kind === "stack" &&
      operatorSkill &&
      !item.manifest.related?.skills?.includes(operatorSkill)
    ) {
      throw new CatalogPackageError(
        `related.operatorSkill must also appear in related.skills: ${operatorSkill}`,
        item.path,
        item.manifest.id
      );
    }
    if (item.manifest.kind === "stack" && operatorSkill) {
      const operatorPackage = byId.get(operatorSkill);
      if (!operatorPackage?.manifest.requires?.stacks?.includes(item.manifest.id)) {
        throw new CatalogPackageError(
          `operator skill ${operatorSkill} must declare ${item.manifest.id} in requires.stacks`,
          item.path,
          item.manifest.id
        );
      }
    }

    for (const stackId of item.manifest.requires?.stacks ?? []) {
      if (!stackIds.has(stackId)) {
        throw new CatalogPackageError(
          `requires.stacks references unknown stack: ${stackId}`,
          item.path,
          item.manifest.id
        );
      }
    }
  }
}
