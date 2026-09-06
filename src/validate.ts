/**
 * RUDI Registry v2 Manifest Validator
 *
 * Validates v2 manifests against:
 * 1. JSON Schema (AJV)
 * 2. Platform resolution (resolver)
 * 3. Effective policy (conditional rules)
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: One or more validations failed
 */

import fs from "node:fs/promises";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import {
  resolve,
  assertEffectivePolicy,
  type Package,
  type ResolveContext,
} from "./resolver.js";
import {
  assertCatalogReferences,
  CatalogPackageError,
  discoverCatalogPackageFiles,
  readCatalogPackage,
  type CatalogPackageFile,
} from "./catalog.js";

// Load schema (ESM with JSON import)
const schemaPath = new URL("../schemas/package.schema.json", import.meta.url);
const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));

// =============================================================================
// Platform Detection
// =============================================================================

function detectPlatform(): ResolveContext {
  const platform = process.platform;
  const arch = process.arch;

  let os: "darwin" | "linux" | "win32";
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "win32";
  else throw new Error(`Unsupported platform: ${platform}`);

  let archNorm: "arm64" | "x64";
  if (arch === "arm64") archNorm = "arm64";
  else if (arch === "x64" || arch === "amd64") archNorm = "x64";
  else throw new Error(`Unsupported architecture: ${arch}`);

  return { os, arch: archNorm };
}

// =============================================================================
// Validation
// =============================================================================

interface ValidationResult {
  file: string;
  id: string;
  valid: boolean;
  errors?: string[];
}

async function validateFile(
  item: CatalogPackageFile,
  validate: ReturnType<Ajv["compile"]>,
  ctx: ResolveContext
): Promise<ValidationResult> {
  const errors: string[] = [];
  const file = item.path;
  const id = item.manifest.id;

  try {
    // 1) Schema validation
    const valid = validate(item.manifest);
    if (!valid) {
      const ajv = new Ajv();
      const msg = ajv.errorsText(validate.errors, { separator: "; " });
      errors.push(`Schema: ${msg}`);
      return { file, id, valid: false, errors };
    }

    // 2) Resolve for current platform
    const resolved = resolve(item.manifest as Package, ctx);

    // 3) Effective policy validation
    assertEffectivePolicy(resolved);

    return { file, id, valid: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    return { file, id, valid: false, errors };
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const ctx = detectPlatform();
  console.log(`Platform: ${ctx.os}-${ctx.arch}\n`);

  // Setup AJV (strict: false for conditional schemas with cross-references)
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  // Find v2 manifests and Markdown skills
  const files = await discoverCatalogPackageFiles();

  if (files.length === 0) {
    console.log(
      "No catalog package files found (v2 JSON manifests or catalog/skills/**/*.md)."
    );
    console.log("Create catalog packages to validate them.");
    process.exit(0);
  }

  console.log(`Found ${files.length} catalog package file(s)\n`);

  // Validate each file
  const results: ValidationResult[] = [];
  const validPackages: CatalogPackageFile[] = [];
  for (const file of files) {
    let item: CatalogPackageFile;
    try {
      item = await readCatalogPackage(file);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const packageError = error instanceof CatalogPackageError ? error : undefined;
      results.push({
        file,
        id: packageError?.packageId ?? "(unknown)",
        valid: false,
        errors: [msg],
      });
      continue;
    }

    const result = await validateFile(item, validate, ctx);
    if (result.valid) validPackages.push(item);
    results.push(result);
  }

  if (results.every((result) => result.valid)) {
    try {
      assertCatalogReferences(validPackages, { canonicalSkills: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const packageError = error instanceof CatalogPackageError ? error : undefined;
      results.push({
        file: packageError?.file ?? "(catalog references)",
        id: packageError?.packageId ?? "(catalog references)",
        valid: false,
        errors: [msg],
      });
    }
  }

  // Report results
  const passed = results.filter((r) => r.valid);
  const failed = results.filter((r) => !r.valid);

  for (const r of passed) {
    console.log(`✅ ${r.id}`);
    console.log(`   ${r.file}`);
  }

  for (const r of failed) {
    console.log(`\n❌ ${r.id}`);
    console.log(`   ${r.file}`);
    for (const err of r.errors ?? []) {
      console.log(`   → ${err}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ✅ ${passed.length} passed, ❌ ${failed.length} failed`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
