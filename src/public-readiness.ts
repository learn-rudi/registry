import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import {
  CATALOG_PACKAGE_ARTIFACT_EXCLUDES,
  isForbiddenCatalogArtifact,
} from "./catalog-artifacts.js";

const execFileAsync = promisify(execFile);

export type IssueSeverity = "error" | "warning";

export interface PublicReadinessIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface PublicReadinessReport {
  root: string;
  summary: {
    errors: number;
    warnings: number;
    referencedPackages: number;
  };
  issues: PublicReadinessIssue[];
}

export interface PublicReadinessOptions {
  trackedFiles?: Set<string>;
}

interface RegistryPackageRef {
  id: string;
  kind: string;
  path?: string;
  section: string;
  bucket: string;
}

interface BinaryProvider {
  id: string;
  packageName: string;
  path?: string;
  manifest?: Record<string, unknown>;
  exposedBinaries: Set<string>;
  installableOrDetectable: boolean;
}

const ZERO_SHA256 = /^0{64}$/;
const REQUIRED_PUBLIC_CATALOG_DIRS = [
  "catalog/stacks",
  "catalog/skills",
];

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relPath(root: string, filePath: string): string {
  return toPosixPath(path.relative(root, filePath));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function getTrackedFiles(root: string): Promise<Set<string>> {
  const result = await execFileAsync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  }) as { stdout: string };

  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  filePath?: string,
  details?: Record<string, unknown>
): PublicReadinessIssue {
  return {
    severity,
    code,
    message,
    ...(filePath ? { path: filePath } : {}),
    ...(details ? { details } : {}),
  };
}

function collectPackageRefs(index: unknown): RegistryPackageRef[] {
  const root = asRecord(index);
  if (!root) throw new Error("Root index must be an object");
  if (String(root.schemaVersion) !== "2") {
    throw new Error(`Root index must use schemaVersion 2, received ${String(root.schemaVersion)}`);
  }
  const packages = asRecord(root.packages);
  if (!packages) throw new Error("Root index packages must be an object");

  const refs: RegistryPackageRef[] = [];
  for (const [key, value] of Object.entries(packages)) {
    const pkg = asRecord(value);
    if (!pkg) throw new Error(`Registry package ${key} must be an object`);
    if (pkg.id !== key) {
      throw new Error(`Registry package key/id mismatch: ${key} != ${String(pkg.id)}`);
    }
    if (typeof pkg.kind !== "string") {
      throw new Error(`Registry package ${key} requires kind`);
    }

    const slug = key.split(":", 2)[1];
    const install = asRecord(pkg.install);
    let registryPath = typeof install?.path === "string" ? install.path : undefined;
    if (!registryPath && slug) {
      const section = pkg.kind === "binary" ? "binaries" : `${pkg.kind}s`;
      if (["agent", "binary", "runtime"].includes(pkg.kind)) {
        registryPath = `catalog/${section}/${slug}.json`;
      }
    }

    refs.push({
      id: key,
      kind: pkg.kind,
      path: registryPath,
      section: "packages",
      bucket: "canonical",
    });
  }

  return refs;
}

function hasTrackedPayload(trackedFiles: Set<string>, registryPath: string): boolean {
  return trackedFiles.has(registryPath) || [...trackedFiles].some((file) => file.startsWith(`${registryPath}/`));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizedPackageName(idOrName: string): string {
  return idOrName.trim().replace(/^binary:/, "");
}

function executableName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const basename = path.posix.basename(trimmed.replaceAll("\\", "/"));
  return basename || trimmed;
}

function addExecutableName(target: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const name = executableName(value);
  if (name) target.add(name);
}

function addExecutableNamesFromValue(target: Set<string>, value: unknown): void {
  if (typeof value === "string") {
    addExecutableName(target, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      addExecutableNamesFromValue(target, item);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  for (const [key, child] of Object.entries(record)) {
    addExecutableName(target, key);
    addExecutableNamesFromValue(target, child);
  }
}

function collectExposedBinaries(ref: RegistryPackageRef, manifest?: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const packageName = normalizedPackageName(ref.id);
  if (packageName) names.add(packageName);

  if (!manifest) return names;

  addExecutableNamesFromValue(names, manifest.bins);
  addExecutableNamesFromValue(names, manifest.binaries);
  addExecutableNamesFromValue(names, manifest.additionalBinaries);
  addExecutableNamesFromValue(names, manifest.binary);

  return names;
}

function objectHasEntries(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function isSupportedDownloadType(value: unknown): boolean {
  return typeof value === "string" && ["zip", "tar", "tar.gz", "tgz", "tar.xz", "raw"].includes(value);
}

function hasSupportedDownloads(downloads: unknown): boolean {
  const record = asRecord(downloads);
  if (!record) return false;

  for (const entries of Object.values(record)) {
    if (!Array.isArray(entries)) continue;
    if (entries.some((entry) => {
      const item = asRecord(entry);
      return typeof item?.url === "string" && isSupportedDownloadType(item.type);
    })) {
      return true;
    }
  }

  return false;
}

function hasSupportedUpstreamExtract(manifest: Record<string, unknown>): boolean {
  if (!objectHasEntries(manifest.upstream)) return false;

  const extract = asRecord(manifest.extract);
  if (!extract) return false;

  const candidates = [
    extract.default,
    ...Object.values(extract),
  ];

  return candidates.some((candidate) => {
    const config = asRecord(candidate);
    return Boolean(config && isSupportedDownloadType(config.type));
  });
}

function hasDetectMetadata(manifest: Record<string, unknown>): boolean {
  if (manifest.managed === false && typeof manifest.checkCommand === "string") return true;
  if (manifest.installType === "system" && typeof manifest.checkCommand === "string") return true;

  const detect = asRecord(manifest.detect);
  if (detect && typeof detect.command === "string") return true;

  const install = asRecord(manifest.install);
  if (install?.source === "system") return true;

  return false;
}

function hasInstallOrDetectMetadata(manifest?: Record<string, unknown>): boolean {
  if (!manifest) return false;
  if (hasDetectMetadata(manifest)) return true;

  if (typeof manifest.npmPackage === "string") return true;
  if (typeof manifest.pipPackage === "string") return true;
  if (typeof manifest.nativeInstaller === "string") return true;

  if (hasSupportedDownloads(manifest.downloads)) return true;
  if (hasSupportedUpstreamExtract(manifest)) return true;

  const install = asRecord(manifest.install);
  if (["download", "npm", "pip", "system"].includes(String(install?.source))) return true;

  return false;
}

async function readPackageManifest(root: string, registryPath?: string): Promise<Record<string, unknown> | undefined> {
  if (!registryPath) return undefined;
  const parsed = await readJsonFile(path.join(root, registryPath));
  return asRecord(parsed);
}

function stackManifestPath(ref: RegistryPackageRef): string | undefined {
  if (!ref.path) return undefined;
  return `${ref.path.replace(/\/$/, "")}/manifest.json`;
}

function collectStackBinaryRequirements(stackManifest: Record<string, unknown>): string[] {
  const requires = asRecord(stackManifest.requires);
  if (!requires || !Array.isArray(requires.binaries)) return [];

  return requires.binaries
    .filter((item): item is string => typeof item === "string")
    .map(normalizedPackageName)
    .filter(Boolean);
}

async function buildBinaryProviders(
  root: string,
  refs: RegistryPackageRef[],
  issues: PublicReadinessIssue[]
): Promise<{
  byId: Map<string, BinaryProvider>;
  byExecutable: Map<string, BinaryProvider[]>;
}> {
  const byId = new Map<string, BinaryProvider>();
  const byExecutable = new Map<string, BinaryProvider[]>();

  for (const ref of refs.filter((item) => item.kind === "binary")) {
    let manifest: Record<string, unknown> | undefined;

    try {
      manifest = await readPackageManifest(root, ref.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(issue(
        "error",
        "binary-manifest-invalid",
        `Binary manifest could not be parsed: ${message}`,
        ref.path,
        { id: ref.id }
      ));
    }

    const provider: BinaryProvider = {
      id: ref.id,
      packageName: normalizedPackageName(ref.id),
      path: ref.path,
      manifest,
      exposedBinaries: collectExposedBinaries(ref, manifest),
      installableOrDetectable: hasInstallOrDetectMetadata(manifest),
    };

    byId.set(ref.id, provider);

    for (const executable of provider.exposedBinaries) {
      const current = byExecutable.get(executable) ?? [];
      current.push(provider);
      byExecutable.set(executable, current);
    }
  }

  return { byId, byExecutable };
}

function resolveStackBinaryProvider(
  requirement: string,
  stackRequirements: Set<string>,
  providers: {
    byId: Map<string, BinaryProvider>;
    byExecutable: Map<string, BinaryProvider[]>;
  }
): BinaryProvider | undefined {
  const directProvider = providers.byId.get(`binary:${requirement}`);
  if (directProvider) return directProvider;

  const candidates = providers.byExecutable.get(requirement) ?? [];
  return candidates.find((candidate) => stackRequirements.has(candidate.packageName));
}

async function validateStackBinaryRequirements(
  root: string,
  refs: RegistryPackageRef[],
  issues: PublicReadinessIssue[]
): Promise<void> {
  const providers = await buildBinaryProviders(root, refs, issues);

  for (const ref of refs.filter((item) => item.kind === "stack")) {
    const manifestPath = stackManifestPath(ref);
    if (!manifestPath) continue;

    let stackManifest: Record<string, unknown> | undefined;
    try {
      stackManifest = await readPackageManifest(root, manifestPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(issue(
        "error",
        "stack-manifest-invalid",
        `Stack manifest could not be parsed: ${message}`,
        manifestPath,
        { id: ref.id }
      ));
      continue;
    }

    if (!stackManifest) continue;

    const requirements = collectStackBinaryRequirements(stackManifest);
    const requirementSet = new Set(requirements);

    for (const binary of requirements) {
      const provider = resolveStackBinaryProvider(binary, requirementSet, providers);
      if (!provider) {
        issues.push(issue(
          "error",
          "stack-binary-requirement-unresolved",
          `Stack ${ref.id} requires binary ${binary}, but no indexed binary package or explicitly required provider exposes it.`,
          manifestPath,
          { stackId: ref.id, binary }
        ));
        continue;
      }

      if (!provider.installableOrDetectable) {
        issues.push(issue(
          "error",
          "stack-binary-provider-uninstallable",
          `Stack ${ref.id} requires binary ${binary}, but provider ${provider.id} does not declare supported install or detection metadata.`,
          provider.path ?? manifestPath,
          { stackId: ref.id, binary, providerId: provider.id }
        ));
      }
    }
  }
}

async function validatePackageJson(root: string, issues: PublicReadinessIssue[]): Promise<void> {
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = await readJsonFile(packageJsonPath) as { files?: unknown };

  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    issues.push(issue(
      "error",
      "package-allowlist-missing",
      "package.json must define a publish allowlist in files[] before public npm packaging.",
      "package.json"
    ));
    return;
  }

  const packageFiles = packageJson.files.filter((item): item is string => typeof item === "string");
  const missingArtifactExcludes = CATALOG_PACKAGE_ARTIFACT_EXCLUDES.filter(
    (pattern) => !packageFiles.includes(pattern)
  );

  if (missingArtifactExcludes.length > 0) {
    issues.push(issue(
      "error",
      "package-artifact-excludes-missing",
      "package.json files[] must explicitly exclude generated stack artifacts before public npm packaging.",
      "package.json",
      { missing: missingArtifactExcludes }
    ));
  }
}

async function validateRequiredCatalogDirs(root: string, issues: PublicReadinessIssue[]): Promise<void> {
  for (const dir of REQUIRED_PUBLIC_CATALOG_DIRS) {
    if (!(await pathExists(path.join(root, dir)))) {
      issues.push(issue(
        "error",
        "catalog-dir-missing",
        `Required public catalog directory is missing: ${dir}`,
        dir
      ));
    }
  }
}

async function validateIndexRefs(
  root: string,
  refs: RegistryPackageRef[],
  trackedFiles: Set<string>,
  issues: PublicReadinessIssue[]
): Promise<void> {
  const seenIds = new Set<string>();

  for (const ref of refs) {
    if (!ref.id) {
      issues.push(issue(
        "error",
        "index-package-id-missing",
        `Registry package in ${ref.section}.${ref.bucket} is missing an id.`
      ));
      continue;
    }

    if (seenIds.has(ref.id)) {
      issues.push(issue(
        "error",
        "index-package-id-duplicate",
        `Registry package id is duplicated: ${ref.id}`,
        undefined,
        { id: ref.id }
      ));
    }
    seenIds.add(ref.id);

    if (!ref.id.startsWith(`${ref.kind}:`)) {
      issues.push(issue(
        "error",
        "index-package-kind-mismatch",
        `Package id ${ref.id} does not match index section kind ${ref.kind}.`,
        undefined,
        { id: ref.id, section: ref.section }
      ));
    }

    if (!ref.path) continue;

    const absolutePath = path.join(root, ref.path);
    if (!(await pathExists(absolutePath))) {
      issues.push(issue(
        "error",
        "index-path-missing",
        `Registry index references a path that does not exist: ${ref.path}`,
        ref.path,
        { id: ref.id }
      ));
      continue;
    }

    if (!hasTrackedPayload(trackedFiles, ref.path)) {
      issues.push(issue(
        "error",
        "index-path-untracked",
        `Registry index references a path with no tracked files: ${ref.path}`,
        ref.path,
        { id: ref.id }
      ));
    }
  }
}

function isChecksumLike(pointer: string): boolean {
  const lower = pointer.toLowerCase();
  return lower.includes("sha256") || lower.includes("checksum");
}

function scanPlaceholderChecksums(
  value: unknown,
  filePath: string,
  pointer: string,
  issues: PublicReadinessIssue[]
): void {
  if (typeof value === "string") {
    if (ZERO_SHA256.test(value) && isChecksumLike(pointer)) {
      issues.push(issue(
        "error",
        "checksum-placeholder",
        "Catalog manifest contains an all-zero sha256 placeholder.",
        filePath,
        { pointer }
      ));
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanPlaceholderChecksums(item, filePath, `${pointer}/${index}`, issues);
    });
    return;
  }

  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    scanPlaceholderChecksums(child, filePath, `${pointer}/${key}`, issues);
  }
}

async function validateNoPlaceholderChecksums(root: string, issues: PublicReadinessIssue[]): Promise<void> {
  const files = await fg(["catalog/**/*.json"], {
    cwd: root,
    dot: false,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  for (const file of files.sort()) {
    try {
      const parsed = await readJsonFile(path.join(root, file));
      scanPlaceholderChecksums(parsed, file, "", issues);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(issue(
        "error",
        "catalog-json-invalid",
        `Catalog JSON could not be parsed: ${message}`,
        file
      ));
    }
  }
}

function isForbiddenSecretFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (base === ".env.example") return false;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (["credentials.json", "token.json", "state.json", "secrets.json"].includes(base)) return true;
  if (/^client_secret.*\.json$/.test(base)) return true;
  return /\.(pem|key|p12|pfx)$/.test(base);
}

async function validateNoSecretLikeFiles(root: string, issues: PublicReadinessIssue[]): Promise<void> {
  const files = await fg(["catalog/**/*"], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  for (const file of files.sort()) {
    if (!isForbiddenSecretFile(file)) continue;
    issues.push(issue(
      "error",
      "secret-like-file",
      "Catalog contains a secret-like file name that must not be published.",
      file
    ));
  }
}

async function validateNoForbiddenCatalogArtifacts(
  root: string,
  trackedFiles: Set<string>,
  issues: PublicReadinessIssue[]
): Promise<void> {
  for (const file of [...trackedFiles].sort()) {
    if (!isForbiddenCatalogArtifact(file)) continue;
    if (!(await pathExists(path.join(root, file)))) continue;
    issues.push(issue(
      "error",
      "forbidden-catalog-artifact",
      "Catalog contains a generated runtime artifact path that must not be published.",
      file
    ));
  }
}

async function validatePromptDeprecation(root: string, issues: PublicReadinessIssue[]): Promise<void> {
  const promptCatalog = path.join(root, "catalog/prompts");
  if (!(await pathExists(promptCatalog))) return;

  issues.push(issue(
    "warning",
    "prompt-catalog-present",
    "catalog/prompts is still present. Keep prompt support as a compatibility alias and migrate public entries to catalog/skills.",
    relPath(root, promptCatalog)
  ));
}

export async function validatePublicReadiness(
  root = process.cwd(),
  options: PublicReadinessOptions = {}
): Promise<PublicReadinessReport> {
  const absoluteRoot = path.resolve(root);
  const issues: PublicReadinessIssue[] = [];
  const trackedFiles = options.trackedFiles ?? await getTrackedFiles(absoluteRoot);

  await validatePackageJson(absoluteRoot, issues);
  await validateRequiredCatalogDirs(absoluteRoot, issues);

  const indexPath = path.join(absoluteRoot, "index.json");
  let refs: RegistryPackageRef[] = [];
  try {
    const index = await readJsonFile(indexPath);
    refs = collectPackageRefs(index);
    await validateIndexRefs(absoluteRoot, refs, trackedFiles, issues);
    await validateStackBinaryRequirements(absoluteRoot, refs, issues);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(issue(
      "error",
      "index-json-invalid",
      `Root index.json could not be parsed: ${message}`,
      "index.json"
    ));
  }

  await validateNoPlaceholderChecksums(absoluteRoot, issues);
  await validateNoSecretLikeFiles(absoluteRoot, issues);
  await validateNoForbiddenCatalogArtifacts(absoluteRoot, trackedFiles, issues);
  await validatePromptDeprecation(absoluteRoot, issues);

  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;

  return {
    root: absoluteRoot,
    summary: {
      errors,
      warnings,
      referencedPackages: refs.length,
    },
    issues,
  };
}

function printReport(report: PublicReadinessReport): void {
  console.log("RUDI registry public-readiness validation");
  console.log(`Root: ${report.root}`);
  console.log(`Referenced packages: ${report.summary.referencedPackages}`);
  console.log(`Errors: ${report.summary.errors}`);
  console.log(`Warnings: ${report.summary.warnings}`);

  if (report.issues.length === 0) {
    console.log("\nNo public-readiness issues found.");
    return;
  }

  console.log("");
  for (const item of report.issues) {
    const location = item.path ? ` ${item.path}` : "";
    console.log(`[${item.severity}] ${item.code}${location}`);
    console.log(`  ${item.message}`);
    if (item.details) {
      console.log(`  ${JSON.stringify(item.details)}`);
    }
  }
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const report = await validatePublicReadiness(process.cwd());

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exit(report.summary.errors > 0 ? 1 : 0);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
