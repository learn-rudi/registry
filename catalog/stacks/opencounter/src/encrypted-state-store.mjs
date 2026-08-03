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
    async save(
      providerReference,
      storageState,
      expiresAt,
      bindingSha256 = null,
      guidanceState = null
    ) {
      await saveBoundState(
        providerReference,
        storageState,
        expiresAt,
        bindingSha256,
        guidanceState
      );
    },
    async load(providerReference) {
      return (await decryptState(providerReference)).storageState;
    },
    async loadSession(providerReference) {
      const state = await decryptState(providerReference);
      return {
        guidanceState: state.guidanceState,
        storageState: state.storageState
      };
    },
    async loadForReconciliation(providerReference, bindingSha256) {
      validateBindingSha256(bindingSha256, false);
      const state = await decryptState(providerReference);
      if (state.version >= 2 && state.bindingSha256 !== bindingSha256) {
        throw new Error("opencounter_resume_state_binding_mismatch");
      }
      return {
        needsBindingMigration: state.version === 1,
        storageState: state.storageState
      };
    },
    async rewrite(providerReference, storageState, expiresAt, guidanceState) {
      const current = await decryptState(providerReference);
      await saveBoundState(
        providerReference,
        storageState,
        expiresAt,
        current.bindingSha256,
        guidanceState === undefined ? current.guidanceState : guidanceState
      );
    }
  };

  async function saveBoundState(
    providerReference,
    storageState,
    expiresAt,
    bindingSha256,
    guidanceState
  ) {
    validateProviderReference(providerReference);
    validateBindingSha256(bindingSha256);
    const validatedGuidanceState = validateGuidanceState(guidanceState);
    const plaintext = Buffer.from(JSON.stringify({
      bindingSha256,
      expiresAt,
      guidanceState: validatedGuidanceState,
      providerReference,
      storageState
    }), "utf8");
    if (plaintext.byteLength > 1_000_000) throw new Error("OpenCounter browser state is too large.");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData(providerReference, bindingSha256, 3));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = JSON.stringify({
      algorithm: "aes-256-gcm",
      bindingSha256,
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      version: 3
    });
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const target = pathFor(providerReference);
    const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, envelope, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  }

  async function decryptState(providerReference) {
    validateProviderReference(providerReference);
    let envelopeText;
    try { envelopeText = await readFile(pathFor(providerReference), "utf8"); }
    catch { throw new Error("opencounter_resume_state_missing"); }
    let envelope;
    try { envelope = JSON.parse(envelopeText); }
    catch { throw new Error("opencounter_resume_state_invalid"); }
    if (!envelope || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("opencounter_resume_state_invalid");
    }
    try {
      if (![1, 2, 3].includes(envelope.version)) {
        throw new Error("opencounter_resume_state_invalid");
      }
      const bindingSha256 = envelope.version >= 2
        ? envelope.bindingSha256
        : null;
      validateBindingSha256(bindingSha256);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.nonce, "base64")
      );
      if (envelope.version >= 2) {
        decipher.setAAD(associatedData(
          providerReference,
          bindingSha256,
          envelope.version
        ));
      }
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      const state = JSON.parse(plaintext.toString("utf8"));
      if (envelope.version >= 2 && (
        state.providerReference !== providerReference
        || state.bindingSha256 !== bindingSha256
      )) {
        throw new Error("opencounter_resume_state_invalid");
      }
      const guidanceState = envelope.version === 3
        ? validateGuidanceState(state.guidanceState)
        : null;
      const expiresAt = Date.parse(state.expiresAt);
      const currentTime = Date.parse(now());
      if (!Number.isFinite(expiresAt) || !Number.isFinite(currentTime)) {
        throw new Error("opencounter_resume_state_invalid");
      }
      if (currentTime > expiresAt) {
        throw new Error("opencounter_resume_state_expired");
      }
      return {
        bindingSha256,
        guidanceState,
        storageState: state.storageState,
        version: envelope.version
      };
    } catch (error) {
      if (error instanceof Error && error.message === "opencounter_resume_state_expired") throw error;
      throw new Error("opencounter_resume_state_invalid");
    }
  }

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

function associatedData(providerReference, bindingSha256, version) {
  return Buffer.from(JSON.stringify({
    bindingSha256,
    providerReference,
    version
  }), "utf8");
}

function validateGuidanceState(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_resume_guidance_state_invalid");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2
    || keys[0] !== "activeCheckpoint"
    || keys[1] !== "requestedAddress"
    || typeof value.requestedAddress !== "string"
    || value.requestedAddress.length < 1
    || value.requestedAddress.length > 500
    || value.requestedAddress !== value.requestedAddress.trim()) {
    throw new Error("opencounter_resume_guidance_state_invalid");
  }
  const checkpoint = value.activeCheckpoint;
  if (checkpoint === null) {
    return {
      activeCheckpoint: null,
      requestedAddress: value.requestedAddress
    };
  }
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new Error("opencounter_resume_guidance_state_invalid");
  }
  const checkpointKeys = Object.keys(checkpoint).sort();
  if (checkpointKeys.length !== 2
    || checkpointKeys[0] !== "checkpointSha256"
    || checkpointKeys[1] !== "questions"
    || !/^[0-9a-f]{64}$/.test(checkpoint.checkpointSha256)
    || !Array.isArray(checkpoint.questions)
    || checkpoint.questions.length < 1
    || checkpoint.questions.length > 50) {
    throw new Error("opencounter_resume_guidance_state_invalid");
  }
  const serializedQuestions = JSON.stringify(checkpoint.questions);
  if (Buffer.byteLength(serializedQuestions, "utf8") > 250_000) {
    throw new Error("opencounter_resume_guidance_state_invalid");
  }
  return {
    activeCheckpoint: {
      checkpointSha256: checkpoint.checkpointSha256,
      questions: structuredClone(checkpoint.questions)
    },
    requestedAddress: value.requestedAddress
  };
}

function validateBindingSha256(value, allowNull = true) {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("opencounter_resume_state_binding_invalid");
  }
}

function validateProviderReference(value) {
  if (typeof value !== "string" || !/^opencounter:project:[0-9]{1,20}$/.test(value)) {
    throw new Error("opencounter_resume_state_reference_invalid");
  }
}
