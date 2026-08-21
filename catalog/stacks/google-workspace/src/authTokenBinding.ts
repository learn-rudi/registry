import { lstatSync, type Stats } from "fs";
import { assertAuthorizedGoogleAccount } from "./authIdentity.js";
import { writeJsonFile } from "./state.js";

type TokenData = Record<string, unknown>;
type AccountReader = () => Promise<unknown>;
type TokenWriter = (tokenPath: string, tokenData: TokenData) => void;

function lstatIfPresent(entryPath: string): Stats | null {
  try {
    return lstatSync(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export type PersistVerifiedGoogleTokenOptions = {
  requestedAccount: unknown;
  tokenPath: string;
  tokenData: TokenData;
  readAuthenticatedAccount: AccountReader;
  writeToken?: TokenWriter;
};

function assertIsolatedTokenFile(tokenPath: string): void {
  const tokenEntry = lstatIfPresent(tokenPath);
  if (!tokenEntry) return;

  if (tokenEntry.isSymbolicLink()) {
    throw new Error("Google account token file must not be a symbolic link.");
  }
  if (!tokenEntry.isFile()) {
    throw new Error("Google account token path must be a regular file.");
  }
  if (tokenEntry.nlink > 1) {
    throw new Error("Google account token file must not be hard-linked.");
  }
}

export async function persistVerifiedGoogleToken({
  requestedAccount,
  tokenPath,
  tokenData,
  readAuthenticatedAccount,
  writeToken = writeJsonFile,
}: PersistVerifiedGoogleTokenOptions): Promise<string> {
  const authenticatedIdentity = await readAuthenticatedAccount();
  const authenticatedAccount = assertAuthorizedGoogleAccount(
    requestedAccount,
    authenticatedIdentity
  );

  assertIsolatedTokenFile(tokenPath);
  writeToken(tokenPath, {
    ...tokenData,
    account: authenticatedAccount,
  });

  return authenticatedAccount;
}
