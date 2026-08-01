import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function createEncryptedStateStore({
  encryptionKey,
  stateDirectory = join(homedir(), ".rudi", "state", "opencounter"),
  now = () => new Date().toISOString()
}) {
  const key = parseKey(encryptionKey);
  if (!isAbsolute(stateDirectory)) throw new Error("OpenCounter stateDirectory must be absolute.");
  return {
    async save(providerReference, storageState, expiresAt) {
      const plaintext = Buffer.from(JSON.stringify({ expiresAt, storageState }), "utf8");
      if (plaintext.byteLength > 1_000_000) throw new Error("OpenCounter browser state is too large.");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = JSON.stringify({
        algorithm: "aes-256-gcm",
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        version: 1
      });
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
      const target = pathFor(providerReference);
      const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, envelope, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, target);
    },
    async load(providerReference) {
      let envelopeText;
      try { envelopeText = await readFile(pathFor(providerReference), "utf8"); }
      catch { throw new Error("opencounter_resume_state_missing"); }
      let envelope;
      try { envelope = JSON.parse(envelopeText); }
      catch { throw new Error("opencounter_resume_state_invalid"); }
      if (envelope?.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
        throw new Error("opencounter_resume_state_invalid");
      }
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(envelope.nonce, "base64")
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64")),
          decipher.final()
        ]);
        const state = JSON.parse(plaintext.toString("utf8"));
        if (Date.parse(now()) > Date.parse(state.expiresAt)) {
          throw new Error("opencounter_resume_state_expired");
        }
        return state.storageState;
      } catch (error) {
        if (error instanceof Error && error.message === "opencounter_resume_state_expired") throw error;
        throw new Error("opencounter_resume_state_invalid");
      }
    }
  };

  function pathFor(providerReference) {
    const digest = createHash("sha256").update(providerReference, "utf8").digest("hex");
    return join(stateDirectory, `${digest}.enc.json`);
  }
}

function parseKey(value) {
  if (typeof value !== "string") throw new Error("OPENCOUNTER_SESSION_ENCRYPTION_KEY is required.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    throw new Error("OPENCOUNTER_SESSION_ENCRYPTION_KEY must be canonical base64 for 32 bytes.");
  }
  return decoded;
}
