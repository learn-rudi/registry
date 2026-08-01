import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function assertCanonicalIndex(index: unknown): void {
  const root = asObject(index, "v2 index");
  if (String(root.schemaVersion) !== "2") {
    throw new Error(`Expected v2 index schemaVersion=2, received ${String(root.schemaVersion)}`);
  }
  asObject(root.packages, "v2 index packages");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, file);
}

export async function syncIndexFiles(
  root: string,
  mode: "write" | "check"
): Promise<void> {
  const v2 = await readJson(path.join(root, "dist/index.json"));
  assertCanonicalIndex(v2);

  const targets = [
    { file: path.join(root, "index.json"), content: jsonContent(v2) },
  ];

  if (mode === "write") {
    for (const target of targets) {
      await writeAtomically(target.file, target.content);
    }
    return;
  }

  for (const target of targets) {
    let actual: string;
    try {
      actual = await fs.readFile(target.file, "utf8");
    } catch {
      throw new Error(`Generated registry index is missing: ${path.basename(target.file)}`);
    }
    if (actual !== target.content) {
      throw new Error(
        `Generated registry index is stale: ${path.basename(target.file)}; run npm run indexes:sync`
      );
    }
  }
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  if (flag !== "--write" && flag !== "--check") {
    throw new Error("Usage: tsx src/index-sync.ts --write|--check");
  }
  await syncIndexFiles(process.cwd(), flag === "--write" ? "write" : "check");
  console.log(flag === "--write" ? "Registry indexes synchronized." : "Registry indexes are current.");
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
