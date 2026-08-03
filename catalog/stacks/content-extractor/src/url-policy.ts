export function parseHttpUrl(rawUrl: unknown, fieldName = "url"): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https`);
  }

  return parsed;
}

export function hostnameMatches(parsed: URL, domains: string[]): boolean {
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

export function requirePlatformUrl(
  rawUrl: unknown,
  platform: string,
  domains: string[]
): string {
  const parsed = parseHttpUrl(rawUrl);
  if (!hostnameMatches(parsed, domains)) {
    throw new Error(
      `${platform} extractor requires a ${domains.join(" or ")} URL`
    );
  }
  return parsed.toString();
}
