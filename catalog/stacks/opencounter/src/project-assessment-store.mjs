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

import { validateProjectAssessment } from "./project-assessment.mjs";

const MAXIMUM_ASSESSMENT_BYTES = 5 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function createProjectAssessmentStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "state_directory");
  const assessmentDirectory = privateDirectory(
    path.join(root, "project-assessments"),
    "assessment_directory"
  );
  const keyDirectory = privateDirectory(
    path.join(root, "assessment-keys"),
    "assessment_key_directory"
  );
  return {
    read(assessmentSha256) {
      return readAssessment(
        assessmentPath(assessmentDirectory, assessmentSha256),
        assessmentSha256
      );
    },
    write(value) {
      const assessment = validateProjectAssessment(value);
      const serialized = `${JSON.stringify(assessment, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_ASSESSMENT_BYTES) {
        throw new Error("opencounter_project_assessment_too_large");
      }
      const reportPath = assessmentPath(
        assessmentDirectory,
        assessment.assessmentSha256
      );
      const bindingPath = path.join(
        keyDirectory,
        `${sha256(assessment.assessmentKey)}.json`
      );
      if (existsSync(bindingPath)) {
        const binding = readBinding(bindingPath);
        if (binding.assessmentKey !== assessment.assessmentKey
          || binding.assessmentSha256 !== assessment.assessmentSha256) {
          throw new Error(
            "opencounter_project_assessment_idempotency_conflict"
          );
        }
        readAssessment(reportPath, assessment.assessmentSha256);
        return storeResult({
          assessment,
          bytes,
          path: reportPath,
          replayed: true
        });
      }
      persistImmutable(reportPath, serialized, () => {
        readAssessment(reportPath, assessment.assessmentSha256);
      });
      const binding = {
        assessmentKey: assessment.assessmentKey,
        assessmentSha256: assessment.assessmentSha256,
        schemaVersion: 1
      };
      persistImmutable(
        bindingPath,
        `${JSON.stringify(binding, null, 2)}\n`,
        () => {
          const existing = readBinding(bindingPath);
          if (existing.assessmentKey !== binding.assessmentKey
            || existing.assessmentSha256 !== binding.assessmentSha256) {
            throw new Error(
              "opencounter_project_assessment_idempotency_conflict"
            );
          }
        }
      );
      return storeResult({
        assessment,
        bytes,
        path: reportPath,
        replayed: false
      });
    }
  };
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const metadata = lstatSync(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return path.resolve(value);
}

function assessmentPath(directory, assessmentSha256) {
  if (!SHA256_PATTERN.test(assessmentSha256)) {
    throw new Error("opencounter_project_assessment_digest_invalid");
  }
  return path.join(directory, `${assessmentSha256}.json`);
}

function persistImmutable(targetPath, serialized, verifyExisting) {
  if (existsSync(targetPath)) {
    verifyExisting();
    return;
  }
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, targetPath);
    unlinkSync(temporaryPath);
    chmodSync(targetPath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    if (error?.code === "EEXIST") {
      verifyExisting();
      return;
    }
    throw error;
  }
}

function readAssessment(reportPath, expectedSha256) {
  const metadata = lstatSync(reportPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 1 || metadata.size > MAXIMUM_ASSESSMENT_BYTES) {
    throw new Error("opencounter_project_assessment_file_invalid");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw new Error("opencounter_project_assessment_json_invalid");
  }
  const assessment = validateProjectAssessment(value);
  if (assessment.assessmentSha256 !== expectedSha256) {
    throw new Error("opencounter_project_assessment_digest_mismatch");
  }
  return assessment;
}

function readBinding(bindingPath) {
  const metadata = lstatSync(bindingPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 1 || metadata.size > 10_000) {
    throw new Error("opencounter_project_assessment_binding_invalid");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(bindingPath, "utf8"));
  } catch {
    throw new Error("opencounter_project_assessment_binding_invalid");
  }
  exactRecord(value, [
    "assessmentKey", "assessmentSha256", "schemaVersion"
  ], "binding");
  if (value.schemaVersion !== 1
    || !SHA256_PATTERN.test(value.assessmentSha256)) {
    throw new Error("opencounter_project_assessment_binding_invalid");
  }
  return {
    assessmentKey: boundedText(value.assessmentKey, 200, "assessment_key"),
    assessmentSha256: value.assessmentSha256,
    schemaVersion: 1
  };
}

function storeResult({ assessment, bytes, path: reportPath, replayed }) {
  return {
    assessmentSha256: assessment.assessmentSha256,
    artifactRef: `rudi-state:opencounter-project-assessment:${assessment.assessmentSha256}`,
    bytes,
    path: reportPath,
    replayed
  };
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1
    || value.length > maximum || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
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
