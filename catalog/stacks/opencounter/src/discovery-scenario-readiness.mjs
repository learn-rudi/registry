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

import { validateScenarioSiteFactEvidenceArtifact } from
  "./discovery-site-fact-evidence.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PARCEL_KEY_PATTERN = /^[0-9A-Z]{12}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const ASSERTION_KEYS = [
  "boundarySha256",
  "locationId",
  "locationVersion",
  "parcelKey",
  "questionId",
  "questionSignatureSha256",
  "rollupId",
  "scenarioId",
  "value"
];
const REQUIREMENT_KEYS = [
  "boundarySha256",
  "catalogEntryId",
  "expectedBaseZoningCode",
  "locationId",
  "locationVersion",
  "ownership",
  "parcelKey",
  "questionId",
  "questionSignatureSha256",
  "rollupId",
  "scenarioId",
  "value"
];
const MAXIMUM_REPORT_BYTES = 5 * 1024 * 1024;

export function buildScenarioSiteFactEvidenceReadiness({
  artifacts,
  createdAt,
  requirements
}) {
  const manifest = validateRequirementsManifest(requirements);
  const reportCreatedAt = timestamp(createdAt, "createdAt");
  if (!Array.isArray(artifacts) || artifacts.length > 10_000) {
    throw new Error("opencounter_scenario_readiness_artifacts_invalid");
  }
  const validatedArtifacts = artifacts.map(validateArtifactPacket)
    .sort((left, right) => left.evidenceArtifactSha256.localeCompare(
      right.evidenceArtifactSha256
    ));
  const artifactsByAssertion = new Map();
  for (const packet of validatedArtifacts) {
    if (Date.parse(packet.artifact.observedAt) > Date.parse(reportCreatedAt)) {
      throw new Error("opencounter_scenario_readiness_artifact_time_invalid");
    }
    const key = assertionKey(packet.artifact.assertion);
    const matches = artifactsByAssertion.get(key) ?? [];
    matches.push(packet);
    artifactsByAssertion.set(key, matches);
  }

  const usedArtifactDigests = new Set();
  let verifiedEvidenceCount = 0;
  const assessments = manifest.requirements.map((requirement) => {
    const packet = artifactsByAssertion.get(assertionKey(requirement))?.[0];
    if (!packet) return { ...requirement, status: "evidence_required" };
    verifiedEvidenceCount += 1;
    usedArtifactDigests.add(packet.evidenceArtifactSha256);
    return {
      ...requirement,
      evidence: {
        evidenceArtifactSha256: packet.evidenceArtifactSha256,
        evidenceRef: packet.evidenceRef,
        observedAt: packet.artifact.observedAt
      },
      status: "verified"
    };
  });
  const evidenceRequiredCount = manifest.requiredEvidenceCount
    - verifiedEvidenceCount;
  const statusCounts = Object.fromEntries([
    ...(evidenceRequiredCount > 0
      ? [["evidence_required", evidenceRequiredCount]]
      : []),
    ...(verifiedEvidenceCount > 0
      ? [["verified", verifiedEvidenceCount]]
      : [])
  ]);
  const payload = {
    assessments,
    authorizationReady:
      verifiedEvidenceCount === manifest.requiredEvidenceCount,
    createdAt: reportCreatedAt,
    freezeId: manifest.freezeId,
    ignoredArtifactCount:
      validatedArtifacts.length - usedArtifactDigests.size,
    requiredEvidenceCount: manifest.requiredEvidenceCount,
    requirementsSha256: manifest.requirementsSha256,
    schemaVersion: 2,
    statusCounts,
    verifiedEvidenceCount
  };
  return { ...payload, readinessSha256: sha256(payload) };
}

export function createScenarioSiteFactEvidenceReadinessStore({
  stateDirectory
}) {
  const root = privateDirectory(stateDirectory, "stateDirectory");
  const directory = path.join(root, "scenario-wave-readiness");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  privateDirectory(directory, "scenario-wave-readiness");
  return {
    read(readinessSha256) {
      return readReport(resolveReportPath(directory, readinessSha256));
    },
    write(value) {
      const report = validateReadinessReport(value);
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_REPORT_BYTES) {
        throw new Error("opencounter_scenario_readiness_report_too_large");
      }
      const reportPath = resolveReportPath(directory, report.readinessSha256);
      if (existsSync(reportPath)) {
        readReport(reportPath);
        return { bytes, path: reportPath, readinessSha256: report.readinessSha256 };
      }
      const temporaryPath = path.join(
        directory,
        `${report.readinessSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, reportPath);
        unlinkSync(temporaryPath);
        chmodSync(reportPath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readReport(reportPath);
          return {
            bytes,
            path: reportPath,
            readinessSha256: report.readinessSha256
          };
        }
        throw error;
      }
      return {
        bytes,
        path: reportPath,
        readinessSha256: report.readinessSha256
      };
    }
  };
}

function validateRequirementsManifest(value) {
  exactRecord(value, [
    "campaignId",
    "campaignVersion",
    "evidenceSetSha256",
    "freezeId",
    "requiredEvidenceCount",
    "requirements",
    "requirementsSha256",
    "schemaVersion"
  ], "requirements");
  if (!ID_PATTERN.test(value.campaignId)
    || !Number.isSafeInteger(value.campaignVersion)
    || value.campaignVersion < 1
    || !SHA256_PATTERN.test(value.evidenceSetSha256)
    || !FREEZE_ID_PATTERN.test(value.freezeId)
    || value.schemaVersion !== 1
    || !Array.isArray(value.requirements)
    || value.requirements.length !== value.requiredEvidenceCount
    || value.requirements.length > 10_000) {
    throw new Error("opencounter_scenario_readiness_requirements_invalid");
  }
  const requirements = value.requirements.map(validateRequirement);
  const assertionKeys = requirements.map(assertionKey);
  if (new Set(assertionKeys).size !== assertionKeys.length) {
    throw new Error("opencounter_scenario_readiness_requirements_duplicate");
  }
  const payload = {
    campaignId: value.campaignId,
    campaignVersion: value.campaignVersion,
    evidenceSetSha256: value.evidenceSetSha256,
    freezeId: value.freezeId,
    requiredEvidenceCount: value.requiredEvidenceCount,
    requirements,
    schemaVersion: value.schemaVersion
  };
  if (!SHA256_PATTERN.test(value.requirementsSha256)
    || sha256(payload) !== value.requirementsSha256) {
    throw new Error("opencounter_scenario_readiness_requirements_digest_mismatch");
  }
  return { ...payload, requirementsSha256: value.requirementsSha256 };
}

function validateRequirement(value) {
  exactRecord(value, REQUIREMENT_KEYS, "requirement");
  if (!SHA256_PATTERN.test(value.boundarySha256)
    || typeof value.catalogEntryId !== "string"
    || value.catalogEntryId.length < 3
    || value.catalogEntryId.length > 500
    || !ZONING_CODE_PATTERN.test(value.expectedBaseZoningCode)
    || !ID_PATTERN.test(value.locationId)
    || !Number.isSafeInteger(value.locationVersion)
    || value.locationVersion < 1
    || !["mixed_fact", "site_fact"].includes(value.ownership)
    || !PARCEL_KEY_PATTERN.test(value.parcelKey)
    || !ID_PATTERN.test(value.questionId)
    || !SHA256_PATTERN.test(value.questionSignatureSha256)
    || !UUID_PATTERN.test(value.rollupId)
    || !ID_PATTERN.test(value.scenarioId)
    || typeof value.value !== "string"
    || value.value.length < 1
    || value.value.length > 500) {
    throw new Error("opencounter_scenario_readiness_requirement_invalid");
  }
  return structuredClone(value);
}

function validateArtifactPacket(value) {
  exactRecord(value, [
    "artifact", "evidenceArtifactSha256", "evidenceRef"
  ], "artifactPacket");
  if (!SHA256_PATTERN.test(value.evidenceArtifactSha256)
    || value.evidenceRef !== `ocse_${value.evidenceArtifactSha256}`) {
    throw new Error("opencounter_scenario_readiness_artifact_packet_invalid");
  }
  return {
    artifact: validateScenarioSiteFactEvidenceArtifact({
      artifact: value.artifact,
      evidenceArtifactSha256: value.evidenceArtifactSha256
    }),
    evidenceArtifactSha256: value.evidenceArtifactSha256,
    evidenceRef: value.evidenceRef
  };
}

function validateReadinessReport(value) {
  exactRecord(value, [
    "assessments",
    "authorizationReady",
    "createdAt",
    "freezeId",
    "ignoredArtifactCount",
    "readinessSha256",
    "requiredEvidenceCount",
    "requirementsSha256",
    "schemaVersion",
    "statusCounts",
    "verifiedEvidenceCount"
  ], "report");
  if (!SHA256_PATTERN.test(value.readinessSha256)) {
    throw new Error("opencounter_scenario_readiness_report_invalid");
  }
  const payload = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "readinessSha256"));
  if (sha256(payload) !== value.readinessSha256) {
    throw new Error("opencounter_scenario_readiness_report_digest_mismatch");
  }
  return structuredClone(value);
}

function readReport(reportPath) {
  const stats = lstatSync(reportPath);
  if (!stats.isFile() || stats.isSymbolicLink()
    || stats.size > MAXIMUM_REPORT_BYTES) {
    throw new Error("opencounter_scenario_readiness_report_invalid");
  }
  const report = validateReadinessReport(JSON.parse(
    readFileSync(reportPath, "utf8")
  ));
  if (path.basename(reportPath) !== `${report.readinessSha256}.json`) {
    throw new Error("opencounter_scenario_readiness_report_digest_mismatch");
  }
  return report;
}

function resolveReportPath(directory, readinessSha256) {
  if (!SHA256_PATTERN.test(readinessSha256)) {
    throw new Error("opencounter_scenario_readiness_report_digest_invalid");
  }
  return path.join(directory, `${readinessSha256}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0
    || !path.isAbsolute(value)) {
    throw new Error(`opencounter_scenario_readiness_${label}_invalid`);
  }
  const stats = lstatSync(value);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`opencounter_scenario_readiness_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function assertionKey(value) {
  return sha256(Object.fromEntries(ASSERTION_KEYS.map((key) => [
    key,
    value[key]
  ])));
}

function timestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_scenario_readiness_${label}_invalid`);
  }
  return value;
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_scenario_readiness_${label}_invalid`);
  }
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
