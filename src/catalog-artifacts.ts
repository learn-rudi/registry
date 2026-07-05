export const CATALOG_PAYLOAD_PATTERNS = [
  "catalog/stacks/**/!(node_modules)/**/*.{ts,js,json,md,py,txt}",
  "catalog/stacks/*/manifest.json",
  "catalog/stacks/*/manifest.v2.json",
  "catalog/stacks/*/.env.example",
  "catalog/skills/**/*.md",
  "catalog/prompts/**/*.md",
];

export const CATALOG_ARTIFACT_IGNORE = [
  "**/node_modules/**",
  "**/runs/**",
  "**/downloads/**",
  "**/tmp/**",
  "**/.chrome-profiles/**",
  "**/.test-rudi/**",
  "**/composer/public/media/**",
  "**/clips/**",
  "**/output/**",
  "**/outputs/**",
];

export const CATALOG_PACKAGE_ARTIFACT_EXCLUDES = [
  "!catalog/stacks/**/node_modules/**",
  "!catalog/stacks/**/runs/**",
  "!catalog/stacks/**/downloads/**",
  "!catalog/stacks/**/tmp/**",
  "!catalog/stacks/**/.chrome-profiles/**",
  "!catalog/stacks/**/.test-rudi/**",
  "!catalog/stacks/**/clips/**",
  "!catalog/stacks/**/output/**",
  "!catalog/stacks/**/outputs/**",
  "!catalog/stacks/**/composer/public/media/**",
  "!catalog/**/.DS_Store",
];

const FORBIDDEN_CATALOG_ARTIFACT_PATTERNS = [
  /^catalog\/stacks\/[^/]+\/node_modules(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/runs(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/downloads(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/tmp(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/\.chrome-profiles(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/\.test-rudi(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/clips(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/output(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/outputs(?:\/|$)/,
  /^catalog\/stacks\/[^/]+\/composer\/public\/media(?:\/|$)/,
  /^catalog\/.*\/\.DS_Store$/,
];

export function normalizeCatalogPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isForbiddenCatalogArtifact(filePath: string): boolean {
  const normalized = normalizeCatalogPath(filePath);
  return FORBIDDEN_CATALOG_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized));
}
