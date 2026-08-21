const GOOGLE_ACCOUNT_EMAIL_PATTERN =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export class GoogleAccountMismatchError extends Error {
  constructor(requestedAccount: string, authenticatedAccount: string) {
    super(
      `Authenticated Google account '${authenticatedAccount}' does not match requested account '${requestedAccount}'.`
    );
    this.name = "GoogleAccountMismatchError";
  }
}

export function normalizeRequestedGoogleAccount(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Google account must be a valid email address.");
  }

  const normalized = value.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf("@");
  const localPart = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : "";
  const domainPart = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : "";
  const containsUnsafePathOrControlCharacter = /[\/\\\u0000-\u001f\u007f]/.test(normalized);
  const hasInvalidDotPlacement =
    localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..");
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    localPart.length > 64 ||
    domainPart.length > 253 ||
    containsUnsafePathOrControlCharacter ||
    hasInvalidDotPlacement ||
    !GOOGLE_ACCOUNT_EMAIL_PATTERN.test(normalized)
  ) {
    throw new Error("Google account must be a valid email address.");
  }

  return normalized;
}

export function assertAuthorizedGoogleAccount(
  requestedAccount: unknown,
  authenticatedAccount: unknown
): string {
  const requested = normalizeRequestedGoogleAccount(requestedAccount);
  const authenticated = normalizeRequestedGoogleAccount(authenticatedAccount);

  if (requested !== authenticated) {
    throw new GoogleAccountMismatchError(requested, authenticated);
  }

  return authenticated;
}
