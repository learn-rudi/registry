import { lstatSync, realpathSync, type Stats } from "fs";
import { dirname, join } from "path";
import { normalizeRequestedGoogleAccount } from "./authIdentity.js";
import { ensurePrivateDir } from "./state.js";

function lstatIfPresent(entryPath: string): Stats | null {
  try {
    return lstatSync(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function ensureIsolatedGoogleAccountDirectory(
  accountsDir: string,
  requestedAccount: unknown
): string {
  const account = normalizeRequestedGoogleAccount(requestedAccount);
  ensurePrivateDir(accountsDir);
  const accountDir = join(accountsDir, account);
  const accountEntry = lstatIfPresent(accountDir);

  if (!accountEntry) {
    ensurePrivateDir(accountDir);
    return accountDir;
  }

  if (accountEntry.isSymbolicLink()) {
    throw new Error(
      `Google account directory '${account}' must not be a symbolic link. ` +
      "Replace it with a dedicated directory before authenticating."
    );
  }
  if (!accountEntry.isDirectory()) {
    throw new Error(`Google account storage '${account}' must be a directory.`);
  }

  const accountsRoot = realpathSync(accountsDir);
  const resolvedAccountDir = realpathSync(accountDir);
  if (dirname(resolvedAccountDir) !== accountsRoot) {
    throw new Error(`Google account directory '${account}' resolves outside the accounts root.`);
  }

  ensurePrivateDir(accountDir);
  return accountDir;
}
