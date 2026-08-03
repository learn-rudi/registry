import { parseHttpUrl } from "./url-policy.js";

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; the original HTTP error is more useful.
  }
}

async function throwHttpResponseError(
  response: Response,
  prefix = "HTTP"
): Promise<never> {
  await discardResponseBody(response);
  throw new Error(`${prefix} ${response.status}: ${response.statusText}`);
}

// GITHUB EXTRACTOR
// =============================================================================

type GitHubKind = "repository" | "file" | "directory" | "release" | "gist" | "binary_asset";
type GitHubStatus = "success" | "unsupported_binary";

export interface GitHubResult {
  platform: "github";
  kind: GitHubKind;
  status: GitHubStatus;
  url: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface GitHubRepoApiResult {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  default_branch?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  topics?: string[];
}

interface GitHubReleaseApiResult {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  published_at?: string | null;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

interface GitHubContentApiResult {
  name?: string;
  path?: string;
  type?: string;
  html_url?: string;
  download_url?: string | null;
  size?: number;
}

interface GitHubGistApiResult {
  description?: string | null;
  html_url?: string;
  files?: Record<string, { filename?: string; language?: string | null; content?: string; raw_url?: string; truncated?: boolean }>;
}

const GITHUB_USER_AGENT = "ContentExtractorMCP/1.0";
const GITHUB_TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "rst", "adoc", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "sh", "sql"]);
const GITHUB_BINARY_EXTENSIONS = new Set(["7z", "avi", "bmp", "bz2", "dmg", "doc", "docx", "exe", "gif", "gz", "ico", "jpeg", "jpg", "mov", "mp3", "mp4", "ogg", "otf", "pdf", "pkg", "png", "ppt", "pptx", "rar", "tar", "tgz", "tif", "tiff", "ttf", "wav", "webm", "webp", "woff", "woff2", "xls", "xlsx", "xz", "zip"]);

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": GITHUB_USER_AGENT,
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function githubPathParts(parsed: URL): string[] {
  return parsed.pathname.split("/").filter((part) => part.length > 0);
}

function pathExtension(pathname: string): string {
  const cleanPath = pathname.split(/[?#]/)[0].toLowerCase();
  const filename = cleanPath.split("/").pop() || "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1) : "";
}

function isLikelyGitHubBinary(pathname: string): boolean {
  const extension = pathExtension(pathname);
  if (!extension) return false;
  if (GITHUB_TEXT_EXTENSIONS.has(extension)) return false;
  return GITHUB_BINARY_EXTENSIONS.has(extension);
}

function releaseAssetResult(url: string, title: string, owner: string, repo: string): GitHubResult {
  return {
    platform: "github",
    kind: "binary_asset",
    status: "unsupported_binary",
    url,
    title,
    content: `Unsupported binary GitHub asset: ${title}\n\nThe extractor intentionally does not download binary release assets. Use the URL directly if the binary artifact is needed.`,
    metadata: { owner, repo, reason: "binary_asset" },
  };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) await throwHttpResponseError(response, "GitHub API returned");
  return (await response.json()) as T;
}

async function fetchGitHubText(url: string): Promise<string> {
  const response = await fetch(url, { headers: githubHeaders("text/plain, text/markdown, */*") });
  if (!response.ok) await throwHttpResponseError(response, "GitHub content returned");
  return response.text();
}

async function extractGitHubRepository(owner: string, repo: string, url: string): Promise<GitHubResult> {
  const repoData = await fetchGitHubJson<GitHubRepoApiResult>(`https://api.github.com/repos/${owner}/${repo}`);
  const title = repoData.full_name || `${owner}/${repo}`;
  const defaultBranch = repoData.default_branch || "main";
  const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`;
  let readme = "";
  let readmeError: string | undefined;

  try {
    readme = await fetchGitHubText(readmeUrl);
  } catch (error: any) {
    readmeError = error.message;
  }

  const lines = [
    `# ${title}`,
    "",
    repoData.description || "No repository description provided.",
    "",
    `Repository: ${repoData.html_url || url}`,
    `Default branch: ${defaultBranch}`,
    `Stars: ${repoData.stargazers_count ?? 0}`,
    `Forks: ${repoData.forks_count ?? 0}`,
    `Open issues: ${repoData.open_issues_count ?? 0}`,
  ];

  if (repoData.language) lines.push(`Language: ${repoData.language}`);
  if (repoData.topics?.length) lines.push(`Topics: ${repoData.topics.join(", ")}`);
  lines.push("", "## README", "", readme || `README unavailable${readmeError ? `: ${readmeError}` : "."}`);

  return {
    platform: "github",
    kind: "repository",
    status: "success",
    url: repoData.html_url || url,
    title,
    content: lines.join("\n").trim(),
    metadata: {
      owner,
      repo,
      defaultBranch,
      stars: repoData.stargazers_count ?? 0,
      forks: repoData.forks_count ?? 0,
      openIssues: repoData.open_issues_count ?? 0,
      language: repoData.language || null,
      topics: Array.isArray(repoData.topics) ? repoData.topics : [],
      readmeUrl,
      readmeError,
    },
  };
}

async function extractGitHubFile(owner: string, repo: string, branch: string, filePath: string, url: string): Promise<GitHubResult> {
  if (isLikelyGitHubBinary(filePath)) {
    return releaseAssetResult(url, filePath.split("/").pop() || filePath, owner, repo);
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const content = await fetchGitHubText(rawUrl);
  const title = `${owner}/${repo}/${filePath}`;

  return {
    platform: "github",
    kind: "file",
    status: "success",
    url,
    title,
    content: `# ${title}\n\nSource: ${url}\n\n---\n\n${content}`.trim(),
    metadata: { owner, repo, branch, path: filePath, rawUrl, words: wordCount(content) },
  };
}

async function extractGitHubDirectory(owner: string, repo: string, branch: string, dirPath: string, url: string): Promise<GitHubResult> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(dirPath)}?ref=${encodeURIComponent(branch)}`;
  const items = await fetchGitHubJson<GitHubContentApiResult[]>(apiUrl);
  const title = `${owner}/${repo}/${dirPath}`;
  const rows = items.map((item) => `- ${item.type || "item"}: ${item.path || item.name || "unknown"}${item.size !== undefined ? ` (${item.size} bytes)` : ""}`);

  return {
    platform: "github",
    kind: "directory",
    status: "success",
    url,
    title,
    content: `# ${title}\n\nSource: ${url}\n\n## Directory contents\n\n${rows.join("\n")}`,
    metadata: { owner, repo, branch, path: dirPath, itemCount: items.length },
  };
}

async function extractGitHubRelease(owner: string, repo: string, releaseRef: string, url: string): Promise<GitHubResult> {
  const apiUrl = releaseRef === "latest"
    ? `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    : `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(releaseRef)}`;
  const release = await fetchGitHubJson<GitHubReleaseApiResult>(apiUrl);
  const title = `${owner}/${repo} ${release.name || release.tag_name || releaseRef}`;
  const assets = release.assets || [];
  const assetLines = assets.map((asset) => `- ${asset.name || "asset"}${asset.size !== undefined ? ` (${asset.size} bytes)` : ""}${asset.browser_download_url ? `: ${asset.browser_download_url}` : ""}`);

  return {
    platform: "github",
    kind: "release",
    status: "success",
    url: release.html_url || url,
    title,
    content: [`# ${title}`, "", `Tag: ${release.tag_name || releaseRef}`, release.published_at ? `Published: ${release.published_at}` : "", "", "## Notes", "", release.body || "No release notes provided.", "", "## Assets", "", assetLines.join("\n") || "No assets listed."].filter((line) => line !== "").join("\n"),
    metadata: { owner, repo, tagName: release.tag_name || releaseRef, publishedAt: release.published_at || null, assetCount: assets.length },
  };
}

async function extractGitHubGist(gistId: string, url: string): Promise<GitHubResult> {
  const gist = await fetchGitHubJson<GitHubGistApiResult>(`https://api.github.com/gists/${gistId}`);
  const files = Object.values(gist.files || {});
  const sections: string[] = [];

  for (const file of files) {
    const filename = file.filename || "gist-file";
    let content = file.content || "";
    if (file.truncated && file.raw_url) {
      content = await fetchGitHubText(file.raw_url);
    }
    sections.push(`## ${filename}\n\n${content}`);
  }

  return {
    platform: "github",
    kind: "gist",
    status: "success",
    url: gist.html_url || url,
    title: gist.description || `gist:${gistId}`,
    content: [`# ${gist.description || `Gist ${gistId}`}`, "", `Source: ${gist.html_url || url}`, "", ...sections].join("\n").trim(),
    metadata: { gistId, fileCount: files.length, files: files.map((file) => file.filename || "gist-file") },
  };
}

export async function extractGitHub(url: string): Promise<GitHubResult> {
  const parsed = parseHttpUrl(url);
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (hostname === "raw.githubusercontent.com") {
    const parts = githubPathParts(parsed);
    if (parts.length < 4) throw new Error("Raw GitHub URL must include owner, repo, branch, and path");
    const [owner, repoName, branch, ...fileParts] = parts;
    return extractGitHubFile(owner, repoName.replace(/\.git$/, ""), branch, fileParts.join("/"), parsed.toString());
  }

  if (hostname === "gist.github.com") {
    const parts = githubPathParts(parsed);
    const gistId = parts[parts.length - 1];
    if (!gistId) throw new Error("Gist URL must include a gist ID");
    return extractGitHubGist(gistId, parsed.toString());
  }

  if (hostname !== "github.com") {
    throw new Error("GitHub extractor requires a github.com, gist.github.com, or raw.githubusercontent.com URL");
  }

  const parts = githubPathParts(parsed);
  if (parts.length < 2) throw new Error("GitHub URL must include owner and repository");
  const [owner, repoPart, ...rest] = parts;
  const repo = repoPart.replace(/\.git$/, "");

  if (rest[0] === "releases" && rest[1] === "latest" && rest[2] === "download") {
    const assetPath = rest.slice(3).join("/");
    if (isLikelyGitHubBinary(assetPath)) return releaseAssetResult(parsed.toString(), assetPath.split("/").pop() || assetPath, owner, repo);
    return extractGitHubFile(owner, repo, "HEAD", assetPath, parsed.toString());
  }

  if (rest[0] === "releases" && rest[1] === "latest") {
    return extractGitHubRelease(owner, repo, "latest", parsed.toString());
  }

  if (rest[0] === "releases" && rest[1] === "tag" && rest[2]) {
    return extractGitHubRelease(owner, repo, rest[2], parsed.toString());
  }

  if ((rest[0] === "blob" || rest[0] === "raw") && rest.length >= 3) {
    return extractGitHubFile(owner, repo, rest[1], rest.slice(2).join("/"), parsed.toString());
  }

  if (rest[0] === "tree" && rest.length >= 3) {
    return extractGitHubDirectory(owner, repo, rest[1], rest.slice(2).join("/"), parsed.toString());
  }

  return extractGitHubRepository(owner, repo, parsed.toString());
}

export function formatGitHubResult(result: GitHubResult): string {
  return `**GitHub Content Extracted**\n\n**Title:** ${result.title}\n**Kind:** ${result.kind}\n**Status:** ${result.status}\n**URL:** ${result.url}\n\n---\n\n${result.content}`;
}
