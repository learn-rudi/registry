import { createHash } from "node:crypto";
import path from "node:path";

import { evaluateProjectAssessment } from "./project-assessment.mjs";

const WORKFLOWS = new Set(["zoning", "business", "special_events", "residential"]);
const OPENCOUNTER_ORIGIN = "https://opencounter.cincinnati-oh.gov";

export function createOpenCounterToolResponse(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("OpenCounter tool result is invalid.");
  }
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text, "utf8") > 500_000) {
    throw new Error("OpenCounter tool result is too large.");
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredClone(result)
  };
}

export function createOpenCounterService({
  driver,
  now = () => new Date().toISOString(),
  projectAssessmentStore,
  questionnaireStore,
  zoningCatalog
}) {
  if (!driver || typeof driver !== "object") throw new Error("driver is required.");
  const zoningCatalogIndex = zoningCatalog === undefined
    ? null
    : indexZoningCatalog(zoningCatalog);
  return {
    async assessProject(input) {
      if (zoningCatalogIndex === null) {
        throw new Error("opencounter_catalog_unavailable");
      }
      if (!questionnaireStore
        || typeof questionnaireStore.read !== "function"
        || !projectAssessmentStore
        || typeof projectAssessmentStore.write !== "function") {
        throw new Error("opencounter_project_assessment_unavailable");
      }
      const questionnaireSha256 = boundedSha256(
        input?.questionnaireSha256,
        "questionnaireSha256"
      );
      const questionnaire = questionnaireStore.read(questionnaireSha256);
      const assessment = evaluateProjectAssessment({
        catalog: zoningCatalogIndex.catalog,
        input,
        questionnaire
      });
      const artifact = projectAssessmentStore.write(assessment);
      return {
        artifact,
        assessment,
        schemaVersion: 1,
        status: assessment.status
      };
    },
    async getZoningUseCatalog(input) {
      exactKeys(input, []);
      if (zoningCatalogIndex === null) throw new Error("opencounter_catalog_unavailable");
      return structuredClone(zoningCatalogIndex.catalog);
    },
    async startZoningGuidance(input) {
      if (zoningCatalogIndex === null) throw new Error("opencounter_catalog_unavailable");
      const normalized = validateCatalogBoundZoningStart(input, zoningCatalogIndex);
      return validateDriverResult(
        await driver.startZoningGuidance(normalized),
        now
      );
    },
    async reconcileZoningStart(input) {
      if (zoningCatalogIndex === null) throw new Error("opencounter_catalog_unavailable");
      const normalized = validateCatalogBoundZoningReconciliation(
        input,
        zoningCatalogIndex
      );
      const value = await driver.reconcileZoningStart(normalized);
      try {
        return validateDriverResult(value, now);
      } catch {
        return validateDriverResult({
          providerReference: normalized.providerReference,
          status: "indeterminate"
        }, now);
      }
    },
    async startGuidance(input) {
      const normalized = validateStart(input);
      return validateDriverResult(await driver.startGuidance(normalized), now);
    },
    async continueGuidance(input) {
      const normalized = validateContinuation(input);
      return validateDriverResult(await driver.continueGuidance(normalized), now);
    },
    async getGuidanceResult(input) {
      const providerReference = validateProviderReference(input?.providerReference);
      return validateDriverResult(await driver.getGuidanceResult({ providerReference }), now);
    },
    async reconcileGuidance(input) {
      const providerReference = validateProviderReference(input?.providerReference);
      return validateDriverResult(await driver.reconcileGuidance({ providerReference }), now);
    },
    async exportGuidance(input) {
      exactKeys(input, ["providerReference"]);
      const providerReference = validateProviderReference(input.providerReference);
      return validateExportResult(
        await driver.exportGuidance({ providerReference }),
        providerReference
      );
    }
  };
}

function validateCatalogBoundZoningStart(input, catalogIndex) {
  exactKeys(input, [
    "address",
    "catalogEntryId",
    "catalogId",
    "jurisdiction",
    "schemaVersion"
  ]);
  return resolveCatalogBoundZoningInput(input, catalogIndex);
}

function validateCatalogBoundZoningReconciliation(input, catalogIndex) {
  exactKeys(input, [
    "address",
    "catalogEntryId",
    "catalogId",
    "jurisdiction",
    "providerInputSha256",
    "providerReference",
    "schemaVersion"
  ]);
  const normalized = resolveCatalogBoundZoningInput(input, catalogIndex);
  const providerInputSha256 = boundedSha256(
    input.providerInputSha256,
    "providerInputSha256"
  );
  if (providerInputSha256 !== createZoningProviderInputSha256(normalized)) {
    throw new Error("opencounter_provider_input_digest_mismatch");
  }
  return {
    ...normalized,
    providerInputSha256,
    providerReference: validateProviderReference(input.providerReference)
  };
}

function resolveCatalogBoundZoningInput(input, catalogIndex) {
  if (input.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  if (input.jurisdiction !== "cincinnati-oh") {
    throw new Error("jurisdiction must be cincinnati-oh.");
  }
  if (input.catalogId !== catalogIndex.catalog.catalogId) {
    throw new Error("catalog_version_mismatch");
  }
  const catalogEntryId = boundedText(input.catalogEntryId, "catalogEntryId", 200);
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(catalogEntryId)) {
    throw new Error("catalogEntryId is invalid.");
  }
  const selected = catalogIndex.entries.get(catalogEntryId);
  if (selected === undefined) throw new Error("opencounter_use_not_found");
  return {
    address: boundedText(input.address, "address", 500),
    catalogEntryId,
    catalogId: catalogIndex.catalog.catalogId,
    catalogSha256: catalogIndex.catalog.catalogSha256,
    categoryPath: selected.categoryPath,
    description: selected.entry.description,
    jurisdiction: "cincinnati-oh",
    proposedUse: selected.entry.providerLabel,
    providerUseSlug: selected.entry.providerUseSlug,
    workflow: "zoning"
  };
}

export function createZoningProviderInputSha256(input) {
  const keys = [
    "address",
    "catalogEntryId",
    "catalogId",
    "catalogSha256",
    "categoryPath",
    "description",
    "jurisdiction",
    "proposedUse",
    "providerUseSlug",
    "workflow"
  ];
  const canonical = Object.fromEntries(keys.map((key) => [key, input[key]]));
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function indexZoningCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("zoningCatalog is invalid.");
  }
  if (
    catalog.schemaVersion !== 1
    || catalog.workflow !== "zoning"
    || catalog.jurisdiction !== "cincinnati-oh"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(catalog.catalogId)
    || !/^[0-9a-f]{64}$/.test(catalog.catalogSha256)
    || !Array.isArray(catalog.categories)
    || catalog.categories.length < 1
    || catalog.categories.length > 50
  ) {
    throw new Error("zoningCatalog is invalid.");
  }
  const entries = new Map();
  const addEntries = (values, categoryPath) => {
    if (!Array.isArray(values)) throw new Error("zoningCatalog entries are invalid.");
    for (const entry of values) {
      if (
        !entry
        || typeof entry !== "object"
        || Array.isArray(entry)
        || !/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(entry.catalogEntryId)
        || typeof entry.providerLabel !== "string"
        || typeof entry.providerUseSlug !== "string"
        || (entry.description !== null && typeof entry.description !== "string")
        || entries.has(entry.catalogEntryId)
      ) {
        throw new Error("zoningCatalog entry is invalid.");
      }
      entries.set(entry.catalogEntryId, { categoryPath, entry });
    }
  };
  for (const category of catalog.categories) {
    if (
      !category
      || typeof category !== "object"
      || typeof category.label !== "string"
      || !Array.isArray(category.groups)
    ) {
      throw new Error("zoningCatalog category is invalid.");
    }
    addEntries(category.entries, [category.label]);
    for (const group of category.groups) {
      if (!group || typeof group !== "object" || typeof group.label !== "string") {
        throw new Error("zoningCatalog group is invalid.");
      }
      addEntries(group.entries, [category.label, group.label]);
    }
  }
  if (entries.size === 0) throw new Error("zoningCatalog has no entries.");
  return { catalog, entries };
}

function validateStart(input) {
  exactKeys(input, ["address", "jurisdiction", "proposedUse", "workflow"]);
  if (input.jurisdiction !== "cincinnati-oh") throw new Error("jurisdiction must be cincinnati-oh.");
  if (!WORKFLOWS.has(input.workflow)) throw new Error("workflow is unsupported.");
  return {
    address: boundedText(input.address, "address", 500),
    jurisdiction: "cincinnati-oh",
    proposedUse: boundedText(input.proposedUse, "proposedUse", 2_000),
    workflow: input.workflow
  };
}

function validateContinuation(input) {
  exactKeys(input, ["answers", "checkpointSha256", "providerReference"]);
  if (!Array.isArray(input.answers) || input.answers.length > 50) throw new Error("answers are invalid.");
  const seen = new Set();
  const answers = input.answers.map((answer) => {
    exactKeys(answer, ["questionId", "value"]);
    const questionId = boundedText(answer.questionId, "questionId", 100);
    if (seen.has(questionId)) throw new Error("answer question IDs must be unique.");
    seen.add(questionId);
    return { questionId, value: boundedText(answer.value, "value", 2_000) };
  });
  if (!/^[0-9a-f]{64}$/.test(input.checkpointSha256)) throw new Error("checkpointSha256 is invalid.");
  return {
    answers,
    checkpointSha256: input.checkpointSha256,
    providerReference: validateProviderReference(input.providerReference)
  };
}

function validateDriverResult(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("browser driver returned invalid data.");
  if (value.status === "needs_requester_input") {
    const providerReference = validateProviderReference(value.providerReference);
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 50) {
      throw new Error("browser driver returned an invalid question set.");
    }
    const questions = value.questions.map(validateQuestion);
    const checkpointSha256 = createGuidanceCheckpointSha256(
      providerReference,
      questions
    );
    return {
      checkpoint: {
        checkpointSha256,
        expiresAt: value.expiresAt ?? addHours(now(), 24),
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };
  }
  if (value.status === "completed") {
    const providerReference = validateProviderReference(value.providerReference);
    const providerPdf = value.providerPdf === undefined
      ? null
      : validateExportResult(value.providerPdf, providerReference);
    return {
      ...(providerPdf === null ? {} : {
        providerPdf: {
          artifact: providerPdf.artifact,
          sourceUrl: providerPdf.sourceUrl,
          status: "exported"
        }
      }),
      providerReference,
      result: validateResult(value.result),
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    };
  }
  if (value.status === "not_found") {
    return { failureClass: value.status, schemaVersion: 1, source: "opencounter", status: value.status };
  }
  if (value.status === "indeterminate") {
    return {
      failureClass: value.status,
      ...(value.providerReference === undefined
        ? {}
        : { providerReference: validateProviderReference(value.providerReference) }),
      ...(value.route === undefined
        ? {}
        : { providerRoute: validateProviderRoute(value.route) }),
      schemaVersion: 1,
      source: "opencounter",
      status: value.status
    };
  }
  throw new Error("browser driver status is unsupported.");
}

export function createGuidanceCheckpointSha256(providerReference, questions) {
  const canonical = {
    providerReference: validateProviderReference(providerReference),
    questions: questions.map(validateQuestion),
    schemaVersion: 1
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function validateExportResult(value, requestedProviderReference) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("browser driver returned invalid export data.");
  }
  if (value.status === "not_found") {
    exactKeys(value, ["status"]);
    return {
      failureClass: "not_found",
      schemaVersion: 1,
      source: "opencounter",
      status: "not_found"
    };
  }
  exactKeys(value, ["artifact", "providerReference", "sourceUrl", "status"]);
  if (value.status !== "exported") throw new Error("browser driver export status is unsupported.");
  const providerReference = validateProviderReference(value.providerReference);
  if (providerReference !== requestedProviderReference) {
    throw new Error("browser driver returned a mismatched provider reference.");
  }
  const projectId = providerReference.split(":").pop();
  const expectedSourceUrl = `${OPENCOUNTER_ORIGIN}/projects/${projectId}/apply/summary`;
  if (value.sourceUrl !== expectedSourceUrl) throw new Error("browser driver returned an invalid source URL.");
  const artifact = validateArtifact(value.artifact, projectId);
  return {
    artifact,
    providerReference,
    schemaVersion: 1,
    source: "opencounter",
    sourceUrl: expectedSourceUrl,
    status: "exported"
  };
}

function validateArtifact(value, projectId) {
  exactKeys(value, ["artifactRef", "fileName", "localPath", "mediaType", "sha256", "sizeBytes"]);
  if (!/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error("artifact sha256 is invalid.");
  if (value.artifactRef !== `rudi-artifact:opencounter:${value.sha256}`) {
    throw new Error("artifact reference is invalid.");
  }
  const expectedFileName = `opencounter-project-${projectId}-${value.sha256}.pdf`;
  if (value.fileName !== expectedFileName) throw new Error("artifact fileName is invalid.");
  if (value.mediaType !== "application/pdf") throw new Error("artifact mediaType is invalid.");
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 5 || value.sizeBytes > 25 * 1024 * 1024) {
    throw new Error("artifact sizeBytes is invalid.");
  }
  const localPath = boundedText(value.localPath, "artifact.localPath", 4_096);
  if (!path.isAbsolute(localPath) || path.basename(localPath) !== expectedFileName) {
    throw new Error("artifact localPath is invalid.");
  }
  return {
    artifactRef: value.artifactRef,
    fileName: expectedFileName,
    localPath,
    mediaType: "application/pdf",
    sha256: value.sha256,
    sizeBytes: value.sizeBytes
  };
}

function validateQuestion(question) {
  if (!question || typeof question !== "object" || Array.isArray(question)) throw new Error("question is invalid.");
  const id = boundedText(question.id, "question.id", 100);
  const prompt = boundedText(question.prompt, "question.prompt", 2_000);
  if (typeof question.required !== "boolean") throw new Error("question.required is invalid.");
  if (question.type === "text") return { id, prompt, required: question.required, type: "text" };
  const minimumOptions = id === "opencounter-address" ? 1 : 2;
  if (
    question.type !== "single_select"
    || !Array.isArray(question.options)
    || question.options.length < minimumOptions
    || question.options.length > 50
  ) {
    throw new Error("question type or options are invalid.");
  }
  return {
    id,
    options: question.options.map((option) => ({
      label: boundedText(option?.label, "option.label", 1_000),
      value: boundedText(option?.value, "option.value", 500)
    })),
    prompt,
    required: question.required,
    type: "single_select"
  };
}

function validateResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("guidance result is invalid.");
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > 250_000) throw new Error("guidance result is too large.");
  return result;
}

export function validateProviderReference(value) {
  const text = boundedText(value, "providerReference", 2_000);
  if (!/^opencounter:project:[0-9]{1,20}$/.test(text)) throw new Error("providerReference is invalid.");
  return text;
}

function validateProviderRoute(value) {
  const route = boundedText(value, "providerRoute", 2_000);
  if (!/^\/projects\/[0-9]{1,20}(?:\/[A-Za-z0-9_-]+)*$/.test(route)) {
    throw new Error("providerRoute is invalid.");
  }
  return route;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tool input must be an object.");
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error("tool input contains unsupported or missing fields.");
  }
}

function boundedText(value, field, max) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`${field} is invalid.`);
  return value.trim();
}

function boundedSha256(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

function addHours(value, hours) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("clock returned an invalid timestamp.");
  return new Date(parsed + hours * 60 * 60 * 1_000).toISOString();
}
