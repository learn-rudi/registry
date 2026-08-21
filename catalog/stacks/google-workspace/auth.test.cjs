#!/usr/bin/env node
const assert = require("node:assert/strict");
const {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const PRESENTATIONS_SCOPE = "https://www.googleapis.com/auth/presentations";

async function main() {
  const packageRoot = process.cwd();
  const authSource = readFileSync(path.join(packageRoot, "src", "auth.ts"), "utf8");
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8");
  const {
    assertAuthorizedGoogleAccount,
    normalizeRequestedGoogleAccount,
  } = await import("./src/authIdentity.ts");
  const { persistVerifiedGoogleToken } = await import("./src/authTokenBinding.ts");
  const { ensureIsolatedGoogleAccountDirectory } = await import(
    "./src/accountStorage.ts"
  );

  assert(
    authSource.includes(`"${PRESENTATIONS_SCOPE}"`),
    "auth must request the Google Slides presentations scope"
  );
  assert(
    readme.includes(PRESENTATIONS_SCOPE),
    "README must document the Google Slides presentations scope"
  );

  assert.equal(
    normalizeRequestedGoogleAccount(" RUDI@learnrudi.com "),
    "rudi@learnrudi.com",
    "requested Google accounts must be normalized before filesystem access"
  );
  assert.throws(
    () => normalizeRequestedGoogleAccount("../hoff@learnrudi.com"),
    /valid email address/,
    "account identifiers must reject path traversal"
  );
  for (const invalidAccount of [
    ".rudi@learnrudi.com",
    "rudi..agent@learnrudi.com",
    "rudi.@learnrudi.com",
    `${"a".repeat(65)}@learnrudi.com`,
  ]) {
    assert.throws(
      () => normalizeRequestedGoogleAccount(invalidAccount),
      /valid email address/,
      `account identifiers must reject malformed mailbox '${invalidAccount}'`
    );
  }
  assert.equal(
    assertAuthorizedGoogleAccount("rudi@learnrudi.com", "RUDI@learnrudi.com"),
    "rudi@learnrudi.com",
    "matching Google identities must be accepted case-insensitively"
  );
  assert.throws(
    () => assertAuthorizedGoogleAccount("rudi@learnrudi.com", "hoff@learnrudi.com"),
    /does not match requested account 'rudi@learnrudi\.com'/,
    "OAuth must reject a different Google identity before its token is persisted"
  );

  const stateRoot = mkdtempSync(path.join(tmpdir(), "google-workspace-auth-binding-"));
  const rudiTokenPath = path.join(stateRoot, "rudi@learnrudi.com", "token.json");
  const hoffTokenPath = path.join(stateRoot, "hoff@learnrudi.com", "token.json");
  const originalRudiToken = '{\n  "refresh_token": "existing-rudi-token"\n}\n';
  const originalHoffToken = '{\n  "refresh_token": "existing-hoff-token"\n}\n';

  try {
    mkdirSync(path.dirname(rudiTokenPath), { recursive: true });
    mkdirSync(path.dirname(hoffTokenPath), { recursive: true });
    writeFileSync(rudiTokenPath, originalRudiToken);
    writeFileSync(hoffTokenPath, originalHoffToken);

    const linkedAccountPath = path.join(stateRoot, "linked-rudi@learnrudi.com");
    symlinkSync(path.basename(path.dirname(hoffTokenPath)), linkedAccountPath);
    assert.throws(
      () => ensureIsolatedGoogleAccountDirectory(stateRoot, "linked-rudi@learnrudi.com"),
      /must not be a symbolic link/,
      "an account directory must never redirect token storage into another account"
    );
    const danglingAccountPath = path.join(stateRoot, "dangling-rudi@learnrudi.com");
    symlinkSync("missing-account-directory", danglingAccountPath);
    assert.throws(
      () => ensureIsolatedGoogleAccountDirectory(stateRoot, "dangling-rudi@learnrudi.com"),
      /must not be a symbolic link/,
      "a dangling account-directory symlink must be rejected before directory creation"
    );

    const persistenceOptions = {
      requestedAccount: "rudi@learnrudi.com",
      tokenPath: rudiTokenPath,
      tokenData: { refresh_token: "replacement-token" },
    };

    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        readAuthenticatedAccount: async () => "hoff@learnrudi.com",
      }),
      /does not match requested account 'rudi@learnrudi\.com'/
    );
    assert.equal(readFileSync(rudiTokenPath, "utf8"), originalRudiToken);
    assert.equal(readFileSync(hoffTokenPath, "utf8"), originalHoffToken);

    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        readAuthenticatedAccount: async () => "rudi..agent@learnrudi.com",
      }),
      /valid email address/
    );
    assert.equal(readFileSync(rudiTokenPath, "utf8"), originalRudiToken);
    assert.equal(readFileSync(hoffTokenPath, "utf8"), originalHoffToken);

    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        readAuthenticatedAccount: async () => {
          throw new Error("profile lookup failed");
        },
      }),
      /profile lookup failed/
    );
    assert.equal(readFileSync(rudiTokenPath, "utf8"), originalRudiToken);
    assert.equal(readFileSync(hoffTokenPath, "utf8"), originalHoffToken);

    const newTokenPath = path.join(stateRoot, "new-rudi-token.json");
    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        tokenPath: newTokenPath,
        readAuthenticatedAccount: async () => "hoff@learnrudi.com",
      }),
      /does not match requested account/
    );
    assert.equal(existsSync(newTokenPath), false, "mismatch must not create a token file");

    const linkedTokenPath = path.join(stateRoot, "linked-token.json");
    symlinkSync(hoffTokenPath, linkedTokenPath);
    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        tokenPath: linkedTokenPath,
        readAuthenticatedAccount: async () => "rudi@learnrudi.com",
      }),
      /token file must not be a symbolic link/
    );
    assert.equal(
      readFileSync(hoffTokenPath, "utf8"),
      originalHoffToken,
      "verified token persistence must not follow an existing token-file symlink"
    );
    assert.equal(
      lstatSync(linkedTokenPath).isSymbolicLink(),
      true,
      "rejected token symlink must remain unchanged for explicit operator repair"
    );

    const danglingTokenPath = path.join(stateRoot, "dangling-token.json");
    const danglingTokenTarget = path.join(stateRoot, "escaped-token.json");
    symlinkSync(danglingTokenTarget, danglingTokenPath);
    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        tokenPath: danglingTokenPath,
        readAuthenticatedAccount: async () => "rudi@learnrudi.com",
      }),
      /token file must not be a symbolic link/
    );
    assert.equal(
      existsSync(danglingTokenTarget),
      false,
      "a dangling token symlink must not create or overwrite its target"
    );

    const hardLinkedTokenPath = path.join(stateRoot, "hard-linked-token.json");
    linkSync(hoffTokenPath, hardLinkedTokenPath);
    await assert.rejects(
      persistVerifiedGoogleToken({
        ...persistenceOptions,
        tokenPath: hardLinkedTokenPath,
        readAuthenticatedAccount: async () => "rudi@learnrudi.com",
      }),
      /token file must not be hard-linked/
    );
    assert.equal(readFileSync(hoffTokenPath, "utf8"), originalHoffToken);
    assert.equal(readFileSync(hardLinkedTokenPath, "utf8"), originalHoffToken);

    const verifiedAccount = await persistVerifiedGoogleToken({
      ...persistenceOptions,
      readAuthenticatedAccount: async () => "RUDI@learnrudi.com",
    });
    assert.equal(verifiedAccount, "rudi@learnrudi.com");
    assert.equal(JSON.parse(readFileSync(rudiTokenPath, "utf8")).account, verifiedAccount);
    assert.equal(readFileSync(hoffTokenPath, "utf8"), originalHoffToken);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
