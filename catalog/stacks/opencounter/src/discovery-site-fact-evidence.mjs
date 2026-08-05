import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PARCEL_KEY_PATTERN = /^[0-9A-Z]{12}$/;
const MAXIMUM_ARTIFACT_BYTES = 1024 * 1024;

export function createScenarioSiteFactEvidenceArtifact({
  assertion,
  conclusionRationale,
  observedAt,
  sources
}) {
  const artifact = validateArtifact({
    assertion,
    conclusion: {
      rationale: conclusionRationale,
      status: "verified"
    },
    observedAt,
    schemaVersion: 1,
    sources
  });
  const evidenceArtifactSha256 = sha256(artifact);
  return {
    artifact,
    evidenceArtifactSha256,
    evidenceRef: `ocse_${evidenceArtifactSha256}`
  };
}

export function validateScenarioSiteFactEvidenceArtifact({
  artifact,
  evidenceArtifactSha256
}) {
  if (!SHA256_PATTERN.test(evidenceArtifactSha256)) {
    throw new Error("opencounter_site_fact_evidence_artifact_digest_invalid");
  }
  const validated = validateArtifact(artifact);
  if (sha256(validated) !== evidenceArtifactSha256) {
    throw new Error("opencounter_site_fact_evidence_artifact_digest_mismatch");
  }
  return validated;
}

export function createScenarioSiteFactEvidenceArtifactStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "stateDirectory");
  const directory = path.join(root, "scenario-site-evidence");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  privateDirectory(directory, "scenario-site-evidence");
  return {
    read(evidenceArtifactSha256) {
      return readArtifact(
        resolveArtifactPath(directory, evidenceArtifactSha256),
        evidenceArtifactSha256
      );
    },
    write(value) {
      const artifact = validateArtifact(value);
      const evidenceArtifactSha256 = sha256(artifact);
      const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_ARTIFACT_BYTES) {
        throw new Error("opencounter_site_fact_evidence_artifact_too_large");
      }
      const artifactPath = resolveArtifactPath(
        directory,
        evidenceArtifactSha256
      );
      if (existsSync(artifactPath)) {
        readArtifact(artifactPath, evidenceArtifactSha256);
        return { bytes, evidenceArtifactSha256, path: artifactPath };
      }
      const temporaryPath = path.join(
        directory,
        `${evidenceArtifactSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, artifactPath);
        unlinkSync(temporaryPath);
        chmodSync(artifactPath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readArtifact(artifactPath, evidenceArtifactSha256);
          return { bytes, evidenceArtifactSha256, path: artifactPath };
        }
        throw error;
      }
      return { bytes, evidenceArtifactSha256, path: artifactPath };
    }
  };
}

function validateArtifact(value) {
  exactRecord(value, [
    "assertion", "conclusion", "observedAt", "schemaVersion", "sources"
  ], "artifact");
  if (value.schemaVersion !== 1) {
    throw new Error("opencounter_site_fact_evidence_artifact_invalid");
  }
  const assertion = validateAssertion(value.assertion);
  exactRecord(value.conclusion, ["rationale", "status"], "conclusion");
  if (value.conclusion.status !== "verified") {
    throw new Error("opencounter_site_fact_evidence_conclusion_invalid");
  }
  const rationale = text(value.conclusion.rationale, 2_000, "conclusion.rationale");
  const observedAt = timestamp(value.observedAt, "observedAt");
  if (!Array.isArray(value.sources)
    || value.sources.length < 1
    || value.sources.length > 20) {
    throw new Error("opencounter_site_fact_evidence_sources_invalid");
  }
  const sourceRefs = new Set();
  const sources = value.sources.map((source) => {
    exactRecord(source, [
      "evidenceRef", "payload", "retrievedAt", "source"
    ], "source");
    const evidenceRef = text(source.evidenceRef, 500, "source.evidenceRef");
    if (sourceRefs.has(evidenceRef)) {
      throw new Error("opencounter_site_fact_evidence_source_duplicate");
    }
    sourceRefs.add(evidenceRef);
    const payload = boundedRecord(source.payload, 500_000, "source.payload");
    const retrievedAt = timestamp(source.retrievedAt, "source.retrievedAt");
    if (Date.parse(retrievedAt) > Date.parse(observedAt)) {
      throw new Error("opencounter_site_fact_evidence_source_time_invalid");
    }
    return {
      evidenceRef,
      payload,
      retrievedAt,
      source: text(source.source, 2_000, "source.source")
    };
  });
  const artifact = {
    assertion,
    conclusion: { rationale, status: "verified" },
    observedAt,
    schemaVersion: 1,
    sources
  };
  if (Buffer.byteLength(JSON.stringify(sortJson(artifact)), "utf8")
    > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_site_fact_evidence_artifact_too_large");
  }
  return artifact;
}

function validateAssertion(value) {
  exactRecord(value, [
    "boundarySha256", "locationId", "locationVersion", "parcelKey",
    "questionId", "questionSignatureSha256", "rollupId", "scenarioId",
    "value"
  ], "assertion");
  if (!SHA256_PATTERN.test(value.boundarySha256)
    || !ID_PATTERN.test(value.locationId)
    || !Number.isSafeInteger(value.locationVersion)
    || value.locationVersion < 1
    || !PARCEL_KEY_PATTERN.test(value.parcelKey)
    || !SHA256_PATTERN.test(value.questionSignatureSha256)
    || !UUID_PATTERN.test(value.rollupId)
    || !ID_PATTERN.test(value.scenarioId)) {
    throw new Error("opencounter_site_fact_evidence_assertion_invalid");
  }
  return {
    boundarySha256: value.boundarySha256,
    locationId: value.locationId,
    locationVersion: value.locationVersion,
    parcelKey: value.parcelKey,
    questionId: text(value.questionId, 100, "assertion.questionId"),
    questionSignatureSha256: value.questionSignatureSha256,
    rollupId: value.rollupId,
    scenarioId: value.scenarioId,
    value: text(value.value, 2_000, "assertion.value")
  };
}

function readArtifact(artifactPath, evidenceArtifactSha256) {
  const stat = lstatSync(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("opencounter_site_fact_evidence_artifact_invalid");
  }
  chmodSync(artifactPath, 0o600);
  const bytes = readFileSync(artifactPath);
  if (bytes.length > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_site_fact_evidence_artifact_too_large");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("opencounter_site_fact_evidence_artifact_invalid");
  }
  return validateScenarioSiteFactEvidenceArtifact({
    artifact: value,
    evidenceArtifactSha256
  });
}

function resolveArtifactPath(directory, evidenceArtifactSha256) {
  if (!SHA256_PATTERN.test(evidenceArtifactSha256)) {
    throw new Error("opencounter_site_fact_evidence_artifact_digest_invalid");
  }
  return path.join(directory, `${evidenceArtifactSha256}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || !path.isAbsolute(value)) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
}

function boundedRecord(value, maximumBytes, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
  const sorted = sortJson(value);
  if (Buffer.byteLength(JSON.stringify(sorted), "utf8") > maximumBytes) {
    throw new Error(`opencounter_site_fact_evidence_${label}_too_large`);
  }
  return structuredClone(value);
}

function text(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_site_fact_evidence_${label}_invalid`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)), "utf8")
    .digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}
