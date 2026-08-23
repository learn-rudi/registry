/**
 * RUDI Registry Resolver v2
 *
 * Resolves package manifests to effective install configurations
 * by applying platform-specific overrides and precedence rules.
 */

// =============================================================================
// Types
// =============================================================================

export type OS = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64";
export type PlatformKey =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-x64"
  | "darwin"
  | "linux"
  | "win32"
  | "default";

export type InstallSource = "download" | "npm" | "pip" | "system" | "catalog";
export type Delivery = "remote" | "system" | "bundled";
export type Kind = "runtime" | "binary" | "agent" | "stack" | "skill" | "prompt";

export interface Checksum {
  algo: "sha256";
  value: string;
}

export interface Extract {
  type: "zip" | "tar.gz" | "tar.xz" | "raw";
  strip?: number;
  subdir?: string;
}

export interface Detect {
  command: string;
  expectExitCode?: number;
}

export interface InstallHints {
  brew?: string;
  apt?: string;
  dnf?: string;
  pacman?: string;
  winget?: string;
  choco?: string;
  manual?: string;
}

export interface PlatformSpec {
  source?: InstallSource;
  delivery?: Delivery;
  preinstalled?: boolean;
  url?: string;
  checksum?: Checksum;
  extract?: Extract;
  detect?: Detect;
  installHints?: InstallHints;
  package?: string;
  path?: string;
}

export interface Install {
  source: InstallSource;
  package?: string;
  path?: string;
  platforms?: Record<string, PlatformSpec>;
}

export interface Auth {
  required: boolean;
  command: string;
  instructions?: string;
}

export interface Secret {
  key: string;
  label: string;
  required: boolean;
  helpUrl?: string;
}

export interface Requires {
  binaries?: string[];
  secrets?: Secret[];
  stacks?: string[];
}

export interface Provides {
  tools?: string[];
}

export interface Related {
  operatorSkill?: string;
  skills?: string[];
}

export type PackageMaturity = "experimental" | "stable";
export type PackageSupport = "supported" | "maintenance" | "unsupported";

export interface Deprecation {
  announcedAt: string;
  message: string;
  replacementId?: string;
  removalAfter?: string;
}

export interface Lifecycle {
  maturity: PackageMaturity;
  support: PackageSupport;
  deprecation?: Deprecation;
}

export interface Mcp {
  transport: "stdio" | "http";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface Package {
  id: string;
  kind: Kind;
  name: string;
  version: string;
  delivery: Delivery;
  install: Install;
  bins?: string[] | Record<string, { path: string }>;
  detect?: Detect;
  installHints?: InstallHints;
  auth?: Auth;
  meta?: Record<string, unknown>;
  lifecycle?: Lifecycle;
  aliases?: string[];
  // Stack-specific
  runtime?: "node" | "python" | "deno" | "bun";
  requires?: Requires;
  provides?: Provides;
  related?: Related;
  mcp?: Mcp;
}

export interface ResolveContext {
  os: OS;
  arch: Arch;
}

export interface ResolvedPackage extends Package {
  _resolved: {
    platform: PlatformSpec | undefined;
    platformKey: PlatformKey | undefined;
    keysTried: PlatformKey[];
  };
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Get platform key candidates in fallback order
 */
function candidates(os: OS, arch: Arch): PlatformKey[] {
  const exact = `${os}-${arch}` as PlatformKey;
  return [exact, os as PlatformKey, "default"];
}

/**
 * Deep merge with "platform overrides win" semantics
 */
function merge<T extends object>(base: T, over: Partial<T>): T {
  const out: Record<string, unknown> = Array.isArray(base)
    ? [...base]
    : { ...base };

  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined && v !== null) {
      if (typeof v === "object" && !Array.isArray(v)) {
        out[k] = merge((out[k] ?? {}) as object, v as object);
      } else {
        out[k] = v;
      }
    }
  }

  return out as T;
}

/**
 * Resolve a package manifest for a specific platform
 *
 * Follows precedence rules:
 * 1. Try exact match: darwin-arm64
 * 2. Try OS only: darwin
 * 3. Try default: default
 *
 * Merge order:
 * 1. Start with top-level fields
 * 2. Merge platform fields (platform wins on conflict)
 */
export function resolve(pkg: Package, ctx: ResolveContext): ResolvedPackage {
  const plats = pkg.install.platforms ?? {};
  let plat: PlatformSpec | undefined;
  let platformKey: PlatformKey | undefined;
  const keysTried = candidates(ctx.os, ctx.arch);

  for (const key of keysTried) {
    if (plats[key]) {
      plat = plats[key];
      platformKey = key;
      break;
    }
  }

  // Merge install fields with platform overrides
  const effectiveInstall: Install = merge(pkg.install, plat ?? {});

  // Platform delivery overrides package delivery
  const effectiveDelivery: Delivery = plat?.delivery ?? pkg.delivery;

  // Platform detect overrides package detect
  const effectiveDetect: Detect | undefined = plat?.detect ?? pkg.detect;

  // Platform installHints overrides package installHints
  const effectiveInstallHints: InstallHints | undefined =
    plat?.installHints ?? pkg.installHints;

  // Derive catalog path if omitted
  if (effectiveInstall.source === "catalog" && !effectiveInstall.path) {
    const [, name] = pkg.id.split(":");
    if (pkg.kind === "stack") {
      effectiveInstall.path = `catalog/stacks/${name}`;
    } else if (pkg.kind === "skill") {
      effectiveInstall.path = `catalog/skills/${name}.md`;
    } else if (pkg.kind === "prompt") {
      effectiveInstall.path = `catalog/prompts/${name}.md`;
    }
  }

  return {
    ...pkg,
    delivery: effectiveDelivery,
    install: effectiveInstall,
    detect: effectiveDetect,
    installHints: effectiveInstallHints,
    _resolved: {
      platform: plat,
      platformKey,
      keysTried,
    },
  };
}

// =============================================================================
// Policy Validation
// =============================================================================

export class PolicyError extends Error {
  constructor(
    public packageId: string,
    message: string
  ) {
    super(`[${packageId}] ${message}`);
    this.name = "PolicyError";
  }
}

/**
 * Validate effective policy constraints that JSON Schema can't express
 */
export function assertEffectivePolicy(resolved: ResolvedPackage): void {
  const { id, kind, version, install, delivery, detect } = resolved;

  const deprecation = resolved.lifecycle?.deprecation;
  if (deprecation?.replacementId === id) {
    throw new PolicyError(
      id,
      "lifecycle.deprecation.replacementId cannot reference the same package"
    );
  }
  if (
    deprecation?.removalAfter !== undefined &&
    deprecation.removalAfter < deprecation.announcedAt
  ) {
    throw new PolicyError(
      id,
      "lifecycle.deprecation.removalAfter must not precede announcedAt"
    );
  }

  // KIND constraints
  if (kind === "runtime" && install.source !== "download") {
    throw new PolicyError(id, `runtime must use install.source=download`);
  }

  if (
    kind === "agent" &&
    (delivery !== "system" || install.source !== "system" || version !== "system")
  ) {
    throw new PolicyError(
      id,
      `agent must use system delivery and install.source=system with version=system`
    );
  }

  if ((kind === "stack" || kind === "skill" || kind === "prompt") && install.source !== "catalog") {
    throw new PolicyError(id, `${kind} must use install.source=catalog`);
  }

  // SOURCE constraints
  if (install.source === "download") {
    if (version === "latest") {
      throw new PolicyError(id, `downloads cannot use version=latest`);
    }

    // Check effective platform has url + checksum
    const plat = resolved._resolved.platform;
    if (plat) {
      if (!plat.url) {
        throw new PolicyError(
          id,
          `download requires url on platform ${resolved._resolved.platformKey}`
        );
      }
      if (!plat.checksum) {
        throw new PolicyError(
          id,
          `download requires checksum on platform ${resolved._resolved.platformKey}`
        );
      }
    } else if (!install.platforms) {
      throw new PolicyError(id, `downloads must define install.platforms`);
    }
  }

  if (install.source === "system" || delivery === "system") {
    if (!detect?.command) {
      throw new PolicyError(
        id,
        `system delivery/source requires detect.command`
      );
    }
  }

  if (install.source === "npm" || install.source === "pip") {
    if (!install.package) {
      throw new PolicyError(id, `${install.source} requires install.package`);
    }
  }

  if (install.source === "catalog") {
    if (!install.path) {
      throw new PolicyError(
        id,
        `catalog requires install.path (derivation failed)`
      );
    }
  }

  // STACK constraints
  if (kind === "stack") {
    if (!resolved.runtime) {
      throw new PolicyError(id, `stack requires runtime field`);
    }
    if (!resolved.mcp) {
      throw new PolicyError(id, `stack requires mcp field`);
    }
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Detect current platform
 */
export function detectPlatform(): ResolveContext {
  const platform = process.platform;
  const arch = process.arch;

  let os: OS;
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "win32";
  else throw new Error(`Unsupported platform: ${platform}`);

  let archNorm: Arch;
  if (arch === "arm64") archNorm = "arm64";
  else if (arch === "x64" || arch === "amd64") archNorm = "x64";
  else throw new Error(`Unsupported architecture: ${arch}`);

  return { os, arch: archNorm };
}

/**
 * Full resolution pipeline: resolve + validate
 */
export function resolveAndValidate(
  pkg: Package,
  ctx?: ResolveContext
): ResolvedPackage {
  const context = ctx ?? detectPlatform();
  const resolved = resolve(pkg, context);
  assertEffectivePolicy(resolved);
  return resolved;
}

// =============================================================================
// Alias Resolution
// =============================================================================

export type AliasMap = Map<string, string>;

/**
 * Build an alias map from a collection of packages
 * Maps alias IDs to their canonical package IDs
 */
export function buildAliasMap(packages: Package[]): AliasMap {
  const map = new AliasMap();

  for (const pkg of packages) {
    if (pkg.aliases) {
      for (const alias of pkg.aliases) {
        map.set(alias, pkg.id);
      }
    }
  }

  return map;
}

/**
 * Resolve an ID through the alias map
 * Returns the canonical ID if aliased, or the original ID if not
 */
export function resolveAlias(id: string, aliasMap: AliasMap): string {
  return aliasMap.get(id) ?? id;
}

/**
 * Check if an ID is an alias
 */
export function isAlias(id: string, aliasMap: AliasMap): boolean {
  return aliasMap.has(id);
}
