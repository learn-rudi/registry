const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PROVIDER_REFERENCE_PATTERN = /^opencounter:project:[0-9]{1,20}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateProviderReference(value, index) {
  if (value !== null && !PROVIDER_REFERENCE_PATTERN.test(value)) {
    throw new Error(`ledger.jobs[${index}].providerReference is invalid.`);
  }
}

export function validateQuestionGraph(value) {
  const graph = record(value, "ledger.questionGraph");
  if (!Array.isArray(graph.edges) || !Array.isArray(graph.questions)) {
    throw new Error("opencounter_discovery_question_graph_invalid");
  }
  boundedObject(graph, 2_000_000, "questionGraph");
}

export function validateEvidenceRecords(values) {
  validateBoundedArray(values, 2_000, "evidence");
  for (const value of values) {
    const evidence = record(value, "evidence item");
    try {
      exactKeys(evidence, [
        "actorId", "eventId", "eventType", "observedAt"
      ], "evidence item");
    } catch {
      throw new Error("opencounter_discovery_evidence_invalid");
    }
    if (!ID_PATTERN.test(evidence.actorId)
      || !ID_PATTERN.test(evidence.eventType)
      || !UUID_PATTERN.test(evidence.eventId)) {
      throw new Error("opencounter_discovery_evidence_invalid");
    }
    timestamp(evidence.observedAt, "evidence.observedAt");
  }
}

export function validateBoundedArray(value, maximumItems, path) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`opencounter_discovery_${path.replaceAll(" ", "_")}_invalid`);
  }
  const size = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (size > 2_000_000) throw new Error("opencounter_discovery_job_evidence_too_large");
}

export function boundedObject(value, maximumBytes, path) {
  const object = record(value, path);
  if (Buffer.byteLength(JSON.stringify(object), "utf8") > maximumBytes) {
    throw new Error(`opencounter_discovery_${path.replaceAll(" ", "_")}_too_large`);
  }
  return object;
}

export function text(value, maximum, path) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

export function timestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`${path} is invalid.`);
  }
}

export function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${path} has unsupported or missing fields.`);
  }
}

export function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}
