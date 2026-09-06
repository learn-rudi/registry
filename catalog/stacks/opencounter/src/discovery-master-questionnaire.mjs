import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateVerifiedObservationPortfolioSources } from "./discovery-observation-portfolio.mjs";
import { createNormalizedQuestionSignatureSha256 } from "./discovery-question-graph.mjs";
import { observedZoningCodeForGraph } from "./discovery-zoning-context.mjs";
import {
  COVERAGE_STATUS,
  OBSERVED_ONLY_LIMITATION,
  SHA256_PATTERN,
  TERMINAL_CLASSIFICATIONS,
  compareTerminalClassifications,
  compareTransitions,
  createQuestionFamilyId,
  exactRecord,
  sha256,
  stringArray,
  text,
  timestamp,
  validateCoverage,
  validateFamilies,
  validateQuestions
} from "./discovery-questionnaire-schema.mjs";

const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;

const QUESTIONNAIRE_ID_PATTERN = /^ocmq_[0-9a-f]{64}$/;

const MAXIMUM_QUESTIONNAIRE_BYTES = 10 * 1024 * 1024;

export function buildMasterQuestionnaire({
  catalog,
  freeze,
  sourceLedgers
}) {
  const verifiedFreeze = validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: sourceLedgers
  });
  const graph = verifiedFreeze.questionGraph;
  const transitionEvidenceByEdge = buildTransitionEvidenceByEdge(sourceLedgers);
  const familyBuilders = new Map();
  for (const question of graph.questions) {
    let family = familyBuilders.get(question.providerQuestionId);
    if (family === undefined) {
      family = {
        canonicalQuestionIds: new Set(),
        catalogEntryIds: new Set(),
        categoryPaths: new Set(),
        expectedBaseZoningCodes: new Set(),
        observedZoningCodes: new Set(),
        overlayFlags: new Set(),
        providerQuestionId: question.providerQuestionId
      };
      familyBuilders.set(question.providerQuestionId, family);
    }
    family.canonicalQuestionIds.add(question.questionKey);
    addAll(family.catalogEntryIds, question.catalogEntryIds);
    addAll(family.categoryPaths, question.categoryPaths);
    addAll(family.expectedBaseZoningCodes,
      question.expectedBaseZoningCodes ?? []);
    addAll(family.observedZoningCodes, question.observedZoningCodes ?? []);
    addAll(family.overlayFlags, question.overlayFlags ?? []);
  }

  const questionFamilies = [...familyBuilders.values()].map((family) => {
    const canonicalQuestionIds = sorted(family.canonicalQuestionIds);
    const catalogEntryIds = sorted(family.catalogEntryIds);
    return {
      applicability: {
        catalogEntryIds,
        categoryPaths: sorted(family.categoryPaths),
        expectedBaseZoningCodes: sorted(family.expectedBaseZoningCodes),
        kind: "observed_only",
        observedZoningCodes: sorted(family.observedZoningCodes),
        overlayFlags: sorted(family.overlayFlags)
      },
      canonicalQuestionIds,
      familyId: createQuestionFamilyId(family.providerQuestionId),
      providerQuestionId: family.providerQuestionId,
      scope: catalogEntryIds.length === verifiedFreeze.coverage.catalogEntryCount
        ? "observed_universal"
        : "observed_conditional",
      signatureCount: canonicalQuestionIds.length
    };
  }).sort((left, right) =>
    left.providerQuestionId.localeCompare(right.providerQuestionId));
  const familiesByProviderId = new Map(questionFamilies.map((family) => [
    family.providerQuestionId,
    family
  ]));

  const questions = graph.questions.map((question) => {
    const family = familiesByProviderId.get(question.providerQuestionId);
    const incoming = graph.edges
      .filter(({ targetQuestionKey }) => targetQuestionKey === question.questionKey)
      .map((edge) => toObservedTransition(edge, transitionEvidenceByEdge))
      .sort(compareTransitions);
    const outgoing = graph.edges
      .filter(({ sourceQuestionKey }) => sourceQuestionKey === question.questionKey)
      .map((edge) => toObservedTransition(edge, transitionEvidenceByEdge))
      .sort(compareTransitions);
    return {
      applicability: {
        catalogEntryIds: sorted(question.catalogEntryIds),
        categoryPaths: sorted(question.categoryPaths),
        expectedBaseZoningCodes: sorted(question.expectedBaseZoningCodes ?? []),
        kind: "observed_only",
        locationFixtureIds: sorted(question.locationFixtureIds ?? []),
        observedZoningCodes: sorted(question.observedZoningCodes ?? []),
        overlayFlags: sorted(question.overlayFlags ?? []),
        scenarioIds: sorted(question.scenarioIds)
      },
      conditions: {
        knowledgeStatus: incoming.length > 0
          ? "observed_partial"
          : "unobserved",
        observedIncomingTransitions: incoming
      },
      confidence: {
        evidenceLevel: question.independentObservationCount > 1
          ? "observed_repeatedly"
          : "observed_once",
        exhaustivenessEstablished: false,
        independentObservationCount: question.independentObservationCount,
        limitation: OBSERVED_ONLY_LIMITATION,
        observationCount: question.observationCount
      },
      evidence: {
        firstObservedAt: question.firstObservedAt,
        lastObservedAt: question.lastObservedAt,
        sourceFreezeId: verifiedFreeze.freezeId
      },
      familyId: family.familyId,
      internalQuestionId: question.questionKey,
      normalizedSignatureSha256: question.normalizedSignatureSha256,
      options: structuredClone(question.options),
      outcomes: {
        knowledgeStatus: outgoing.length > 0
          ? "observed_partial"
          : "unobserved",
        observedTransitions: outgoing
      },
      prompt: question.prompt,
      providerQuestionId: question.providerQuestionId,
      requiredStatuses: [...question.requiredStatuses].sort(),
      scope: family.scope,
      type: question.type
    };
  }).sort((left, right) =>
    left.internalQuestionId.localeCompare(right.internalQuestionId));

  const universalQuestionFamilyCount = questionFamilies.filter(
    ({ scope }) => scope === "observed_universal"
  ).length;
  const payload = {
    artifactKind: "opencounter_master_questionnaire",
    catalog: {
      catalogEntryCount: verifiedFreeze.coverage.catalogEntryCount,
      catalogId: verifiedFreeze.catalog.catalogId,
      catalogSha256: verifiedFreeze.catalog.catalogSha256,
      tenantId: verifiedFreeze.catalog.tenantId,
      tenantVersion: verifiedFreeze.catalog.tenantVersion
    },
    coverage: {
      canonicalQuestionCount: questions.length,
      conditionalQuestionFamilyCount:
        questionFamilies.length - universalQuestionFamilyCount,
      questionFamilyCount: questionFamilies.length,
      status: COVERAGE_STATUS,
      universalQuestionFamilyCount,
      verifiedObservationCount:
        verifiedFreeze.coverage.verifiedObservationCount
    },
    evidence: {
      evidenceSetSha256: verifiedFreeze.evidenceSetSha256,
      frozenAt: verifiedFreeze.frozenAt,
      sourceFreezeId: verifiedFreeze.freezeId,
      sourceLedgerSnapshotSha256s: verifiedFreeze.sourceLedgers.map(
        ({ ledgerSnapshotSha256 }) => ledgerSnapshotSha256
      )
    },
    libraryVersion: 3,
    questionFamilies,
    questions,
    schemaVersion: 3
  };
  const questionnaireSha256 = sha256(payload);
  return validateMasterQuestionnaire({
    ...payload,
    questionnaireId: `ocmq_${questionnaireSha256}`,
    questionnaireSha256
  });
}

export function validateMasterQuestionnaire(value) {
  exactRecord(value, [
    "artifactKind", "catalog", "coverage", "evidence", "libraryVersion",
    "questionFamilies", "questionnaireId", "questionnaireSha256", "questions",
    "schemaVersion"
  ], "artifact");
  if (value.artifactKind !== "opencounter_master_questionnaire"
    || ![[1, 1], [2, 2], [3, 3]].some(([schemaVersion, libraryVersion]) =>
      value.schemaVersion === schemaVersion
      && value.libraryVersion === libraryVersion)
    || !QUESTIONNAIRE_ID_PATTERN.test(value.questionnaireId)
    || !SHA256_PATTERN.test(value.questionnaireSha256)
    || value.questionnaireId !== `ocmq_${value.questionnaireSha256}`) {
    throw new Error("opencounter_master_questionnaire_artifact_invalid");
  }
  const catalog = validateCatalogIdentity(value.catalog);
  const evidence = validateEvidence(value.evidence);
  const families = validateFamilies(value.questionFamilies, catalog);
  const questions = validateQuestions(
    value.questions,
    families,
    evidence,
    value.schemaVersion
  );
  const coverage = validateCoverage(value.coverage, families, questions, catalog);
  const payload = {
    artifactKind: value.artifactKind,
    catalog,
    coverage,
    evidence,
    libraryVersion: value.libraryVersion,
    questionFamilies: families,
    questions,
    schemaVersion: value.schemaVersion
  };
  if (sha256(payload) !== value.questionnaireSha256) {
    throw new Error("opencounter_master_questionnaire_digest_mismatch");
  }
  return {
    ...payload,
    questionnaireId: value.questionnaireId,
    questionnaireSha256: value.questionnaireSha256
  };
}

export function createMasterQuestionnaireStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "state_directory");
  const directory = path.join(root, "master-questionnaires");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  privateDirectory(directory, "questionnaire_directory");
  return {
    read(questionnaireSha256) {
      return readQuestionnaire(
        resolveQuestionnairePath(directory, questionnaireSha256),
        questionnaireSha256
      );
    },
    write(value) {
      const questionnaire = validateMasterQuestionnaire(value);
      const serialized = `${JSON.stringify(questionnaire, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_QUESTIONNAIRE_BYTES) {
        throw new Error("opencounter_master_questionnaire_too_large");
      }
      const questionnairePath = resolveQuestionnairePath(
        directory,
        questionnaire.questionnaireSha256
      );
      if (existsSync(questionnairePath)) {
        readQuestionnaire(questionnairePath, questionnaire.questionnaireSha256);
        return {
          bytes,
          path: questionnairePath,
          questionnaireSha256: questionnaire.questionnaireSha256
        };
      }
      const temporaryPath = path.join(
        directory,
        `${questionnaire.questionnaireSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, questionnairePath);
        unlinkSync(temporaryPath);
        chmodSync(questionnairePath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readQuestionnaire(questionnairePath, questionnaire.questionnaireSha256);
          return {
            bytes,
            path: questionnairePath,
            questionnaireSha256: questionnaire.questionnaireSha256
          };
        }
        throw error;
      }
      return {
        bytes,
        path: questionnairePath,
        questionnaireSha256: questionnaire.questionnaireSha256
      };
    }
  };
}

function validateCatalogIdentity(value) {
  exactRecord(value, [
    "catalogEntryCount", "catalogId", "catalogSha256", "tenantId",
    "tenantVersion"
  ], "catalog");
  if (value.catalogEntryCount !== 126
    || !text(value.catalogId, 200)
    || !SHA256_PATTERN.test(value.catalogSha256)
    || !Number.isSafeInteger(value.tenantId)
    || value.tenantId < 1
    || !Number.isSafeInteger(value.tenantVersion)
    || value.tenantVersion < 1) {
    throw new Error("opencounter_master_questionnaire_catalog_invalid");
  }
  return structuredClone(value);
}

function validateEvidence(value) {
  exactRecord(value, [
    "evidenceSetSha256", "frozenAt", "sourceFreezeId",
    "sourceLedgerSnapshotSha256s"
  ], "evidence");
  const snapshots = stringArray(value.sourceLedgerSnapshotSha256s, {
    maximum: 10,
    pattern: SHA256_PATTERN,
    requireNonEmpty: true
  });
  if (!SHA256_PATTERN.test(value.evidenceSetSha256)
    || !FREEZE_ID_PATTERN.test(value.sourceFreezeId)) {
    throw new Error("opencounter_master_questionnaire_evidence_invalid");
  }
  timestamp(value.frozenAt, "evidence_frozenAt");
  return {
    evidenceSetSha256: value.evidenceSetSha256,
    frozenAt: value.frozenAt,
    sourceFreezeId: value.sourceFreezeId,
    sourceLedgerSnapshotSha256s: snapshots
  };
}

function toObservedTransition(edge, transitionEvidenceByEdge) {
  const identity = transitionIdentity({
    answerValue: edge.answerValue,
    sourceQuestionId: edge.sourceQuestionKey,
    targetQuestionId: edge.targetQuestionKey,
    terminalStatus: edge.terminalStatus
  });
  const evidence = transitionEvidenceByEdge.get(identity);
  if (evidence === undefined
    || evidence.observationCount !== edge.observationCount
    || evidence.independentJobIds.size !== edge.independentObservationCount
    || !sameSorted(evidence.expectedBaseZoningCodes,
      edge.expectedBaseZoningCodes ?? [])
    || !sameSorted(evidence.locationFixtureIds, edge.locationFixtureIds ?? [])
    || !sameSorted(evidence.observedZoningCodes,
      edge.observedZoningCodes ?? [])) {
    throw new Error(
      "opencounter_master_questionnaire_transition_evidence_mismatch"
    );
  }
  return {
    answerValue: edge.answerValue,
    applicability: {
      catalogEntryIds: sorted(evidence.catalogEntryIds),
      categoryPaths: sorted(evidence.categoryPaths),
      expectedBaseZoningCodes: sorted(evidence.expectedBaseZoningCodes),
      kind: "observed_only",
      locationFixtureIds: sorted(evidence.locationFixtureIds),
      observedZoningCodes: sorted(evidence.observedZoningCodes),
      overlayFlags: sorted(evidence.overlayFlags),
      scenarioIds: sorted(evidence.scenarioIds)
    },
    expectedBaseZoningCodes: sorted(edge.expectedBaseZoningCodes ?? []),
    firstObservedAt: edge.firstObservedAt,
    independentObservationCount: edge.independentObservationCount,
    lastObservedAt: edge.lastObservedAt,
    locationFixtureIds: sorted(edge.locationFixtureIds ?? []),
    observationCount: edge.observationCount,
    observedZoningCodes: sorted(edge.observedZoningCodes ?? []),
    sourceQuestionId: edge.sourceQuestionKey,
    targetQuestionId: edge.targetQuestionKey,
    terminalClassifications: [...evidence.terminalClassifications]
      .sort(compareTerminalClassifications),
    terminalStatus: edge.terminalStatus
  };
}

function buildTransitionEvidenceByEdge(sourceLedgers) {
  const evidenceByEdge = new Map();
  for (const ledger of sourceLedgers) {
    for (const job of ledger.jobs) {
      const classification = job.terminalResult !== null
        && Object.hasOwn(job.terminalResult, "classification")
        ? job.terminalResult.classification
        : null;
      if (classification !== null
        && !TERMINAL_CLASSIFICATIONS.has(classification)) {
        throw new Error(
          "opencounter_master_questionnaire_terminal_classification_unknown"
        );
      }
      for (let index = 1; index < job.observations.length; index += 1) {
        const previous = job.observations[index - 1];
        const current = job.observations[index];
        for (const answer of current.answers) {
          const sourceQuestion = previous.questions.find(
            (question) => question.id === answer.questionId
          );
          if (sourceQuestion === undefined) {
            throw new Error(
              "opencounter_master_questionnaire_answer_path_invalid"
            );
          }
          const destinations = current.questions.length > 0
            ? current.questions.map((question) => ({
              targetQuestionId: createQuestionId(question),
              terminalStatus: null
            }))
            : [{
              targetQuestionId: null,
              terminalStatus: current.resultStatus
            }];
          for (const destination of destinations) {
            const identity = transitionIdentity({
              answerValue: answer.value,
              sourceQuestionId: createQuestionId(sourceQuestion),
              ...destination
            });
            let evidence = evidenceByEdge.get(identity);
            if (evidence === undefined) {
              evidence = {
                catalogEntryIds: new Set(),
                categoryPaths: new Set(),
                expectedBaseZoningCodes: new Set(),
                independentJobIds: new Set(),
                locationFixtureIds: new Set(),
                observationCount: 0,
                observedZoningCodes: new Set(),
                overlayFlags: new Set(),
                scenarioIds: new Set(),
                terminalClassifications: new Set()
              };
              evidenceByEdge.set(identity, evidence);
            }
            evidence.catalogEntryIds.add(job.catalogEntryId);
            evidence.categoryPaths.add(job.categoryPath.join(" / "));
            evidence.expectedBaseZoningCodes.add(
              job.locationFixture.expectedBaseZoningCode
            );
            evidence.independentJobIds.add(job.jobId);
            evidence.locationFixtureIds.add(
              `${job.locationFixture.locationId}:${job.locationFixture.locationVersion}`
            );
            evidence.observationCount += 1;
            const observedZoningCode = observedZoningCodeForGraph(job);
            if (observedZoningCode !== null) {
              evidence.observedZoningCodes.add(observedZoningCode);
            }
            addAll(evidence.overlayFlags, job.locationFixture.overlayFlags);
            evidence.scenarioIds.add(
              `${job.scenario.scenarioId}:${job.scenario.scenarioVersion}`
            );
            if (destination.terminalStatus !== null) {
              evidence.terminalClassifications.add(classification);
            }
          }
        }
      }
    }
  }
  return evidenceByEdge;
}

function createQuestionId(question) {
  const normalizedSignatureSha256 =
    createNormalizedQuestionSignatureSha256(question);
  return `ocq_${sha256({
    normalizedSignatureSha256,
    providerQuestionId: question.id
  })}`;
}

function transitionIdentity({
  answerValue,
  sourceQuestionId,
  targetQuestionId,
  terminalStatus
}) {
  return JSON.stringify([
    sourceQuestionId,
    answerValue,
    targetQuestionId,
    terminalStatus
  ]);
}

function sameSorted(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function readQuestionnaire(questionnairePath, expectedSha256) {
  const metadata = lstatSync(questionnairePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 1 || metadata.size > MAXIMUM_QUESTIONNAIRE_BYTES) {
    throw new Error("opencounter_master_questionnaire_file_invalid");
  }
  chmodSync(questionnairePath, 0o600);
  let value;
  try {
    value = JSON.parse(readFileSync(questionnairePath, "utf8"));
  } catch {
    throw new Error("opencounter_master_questionnaire_json_invalid");
  }
  const questionnaire = validateMasterQuestionnaire(value);
  if (questionnaire.questionnaireSha256 !== expectedSha256) {
    throw new Error("opencounter_master_questionnaire_digest_mismatch");
  }
  return questionnaire;
}

function resolveQuestionnairePath(directory, questionnaireSha256) {
  if (!SHA256_PATTERN.test(questionnaireSha256)) {
    throw new Error("opencounter_master_questionnaire_digest_invalid");
  }
  return path.join(directory, `${questionnaireSha256}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || !path.isAbsolute(value)) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const metadata = lstatSync(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}
