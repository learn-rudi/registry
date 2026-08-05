import { createHash, randomUUID } from "node:crypto";

import { createZoningProviderInputSha256 } from "./core.mjs";
import { validateVerifiedObservationPortfolioSources } from
  "./discovery-observation-portfolio.mjs";
import { createNormalizedQuestionSignatureSha256 } from
  "./discovery-question-graph.mjs";
import { validateScenarioSiteFactEvidenceArtifact } from
  "./discovery-site-fact-evidence.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const BASELINE_QUESTION_IDS = new Set([
  "existing_use",
  "home_occ",
  "opencounter-address"
]);

export function buildScenarioSiteFactEvidenceRequirements({
  catalog,
  definition,
  freeze,
  sourceLedgers
}) {
  const catalogIdentity = validateCatalog(catalog);
  const validatedFreeze = validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: sourceLedgers
  });
  const wave = validateDefinition(definition, catalogIdentity);
  const sourceJobs = collectVerifiedSourceJobs(sourceLedgers, catalogIdentity);
  const resolvedScenarios = resolveScenarioWaveSources({
    questions: validatedFreeze.questionGraph.questions,
    sourceJobs,
    wave
  });
  const requirements = resolvedScenarios.flatMap(({
    answerRules,
    scenario,
    sourceJob
  }) => answerRules
    .filter(({ ownership }) =>
      ownership === "site_fact" || ownership === "mixed_fact")
    .map(({ ownership, questionId, questionSignatureSha256, value }) => ({
      boundarySha256: sourceJob.locationFixture.boundarySha256,
      catalogEntryId: scenario.catalogEntryId,
      expectedBaseZoningCode: scenario.expectedBaseZoningCode,
      locationId: sourceJob.locationFixture.locationId,
      locationVersion: sourceJob.locationFixture.locationVersion,
      ownership,
      parcelKey: sourceJob.locationFixture.parcelKey,
      questionId,
      questionSignatureSha256,
      rollupId: sourceJob.locationFixture.rollupId,
      scenarioId: scenario.scenarioId,
      value
    })))
    .sort((left, right) =>
      `${left.scenarioId}:${left.questionId}`.localeCompare(
        `${right.scenarioId}:${right.questionId}`
      ));
  const payload = {
    campaignId: wave.campaignId,
    campaignVersion: wave.campaignVersion,
    evidenceSetSha256: validatedFreeze.evidenceSetSha256,
    freezeId: validatedFreeze.freezeId,
    requiredEvidenceCount: requirements.length,
    requirements,
    schemaVersion: 1
  };
  return {
    ...payload,
    requirementsSha256: sha256(payload)
  };
}

export function buildScenarioBranchWavePreview({
  catalog,
  definition,
  freeze,
  siteFactEvidence,
  siteFactEvidenceArtifacts,
  sourceLedgers
}) {
  const catalogIdentity = validateCatalog(catalog);
  const validatedFreeze = validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: sourceLedgers
  });
  const wave = validateDefinition(definition, catalogIdentity);
  const questions = validatedFreeze.questionGraph.questions;
  const sourceJobs = collectVerifiedSourceJobs(sourceLedgers, catalogIdentity);
  const resolvedScenarios = resolveScenarioWaveSources({
    questions,
    sourceJobs,
    wave
  });
  const siteEvidenceByRule = validateSiteFactEvidence(
    siteFactEvidence,
    siteFactEvidenceArtifacts
  );
  const usedSiteEvidence = new Set();
  const globalSubstantiveQuestionIds = sorted(new Set(questions
    .map(({ providerQuestionId }) => providerQuestionId)
    .filter((questionId) => !BASELINE_QUESTION_IDS.has(questionId))));
  const coveredSubstantiveQuestionIds = new Set();
  const scenarios = resolvedScenarios.map(({
    answerRules: resolvedAnswerRules,
    scenario,
    sourceJob,
    sourceRecord
  }) => {
    const answerRules = resolvedAnswerRules.map((resolvedRule) => {
      const rule = structuredClone(resolvedRule);
      const { ownership, questionSignatureSha256 } = rule;
      if (ownership === "site_fact" || ownership === "mixed_fact") {
        const evidenceKey = `${scenario.scenarioId}:${resolvedRule.questionId}`;
        const evidence = siteEvidenceByRule.get(evidenceKey);
        validateSiteFactEvidenceCompatibility({
          evidence,
          fixture: sourceJob.locationFixture,
          questionSignatureSha256,
          rule: resolvedRule,
          scenarioId: scenario.scenarioId
        });
        usedSiteEvidence.add(evidenceKey);
        rule.siteFactEvidence = structuredClone(evidence);
      }
      if (!BASELINE_QUESTION_IDS.has(resolvedRule.questionId)) {
        coveredSubstantiveQuestionIds.add(resolvedRule.questionId);
      }
      return rule;
    });
    return {
      answerRules,
      catalogEntryId: scenario.catalogEntryId,
      expectedBaseZoningCode: scenario.expectedBaseZoningCode,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion,
      sourceObservation: {
        checkpointSha256: sourceJob.checkpoint.checkpointSha256,
        jobId: sourceJob.jobId,
        ledgerSnapshotSha256: sourceRecord.ledgerSnapshotSha256,
        locationFixtureSha256: sha256(sourceJob.locationFixture)
      }
    };
  });
  if (usedSiteEvidence.size !== siteEvidenceByRule.size) {
    throw new Error("opencounter_scenario_wave_site_fact_evidence_unmatched");
  }
  const uncoveredSubstantiveQuestionIds = globalSubstantiveQuestionIds.filter(
    (questionId) => !coveredSubstantiveQuestionIds.has(questionId)
  );
  if (globalSubstantiveQuestionIds.length !== wave.expectedSubstantiveQuestionCount
    || uncoveredSubstantiveQuestionIds.length > 0) {
    throw new Error("opencounter_scenario_wave_coverage_incomplete");
  }
  const payload = {
    campaignId: wave.campaignId,
    campaignVersion: wave.campaignVersion,
    catalog: {
      catalogId: catalogIdentity.catalogId,
      catalogSha256: catalogIdentity.catalogSha256,
      tenantVersion: catalogIdentity.tenantVersion
    },
    coverage: {
      coveredSubstantiveQuestionIds: sorted(coveredSubstantiveQuestionIds),
      substantiveQuestionCount: globalSubstantiveQuestionIds.length,
      uncoveredSubstantiveQuestionIds
    },
    maximumProviderConcurrency: wave.maximumProviderConcurrency,
    plannedRunCount: scenarios.length,
    proposalFactPolicy: structuredClone(wave.proposalFactPolicy),
    requiredAuthorization: {
      maximumProviderProjects: scenarios.length,
      required: true
    },
    scenarios,
    schemaVersion: 1,
    selectionStrategy: wave.selectionStrategy,
    sourceFreezeId: validatedFreeze.freezeId
  };
  const previewSha256 = sha256(payload);
  return {
    ...payload,
    previewSha256,
    requiredAuthorization: {
      ...payload.requiredAuthorization,
      previewSha256
    }
  };
}

export function createScenarioBranchLedger({
  authorization,
  catalog,
  createdAt,
  definition,
  freeze,
  siteFactEvidence,
  siteFactEvidenceArtifacts,
  sourceLedgers
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const approvedVolume = validateAuthorization(
    authorization,
    preview.plannedRunCount,
    preview.previewSha256,
    timestamp
  );
  const catalogIdentity = validateCatalog(catalog);
  const sourceJobs = collectVerifiedSourceJobs(sourceLedgers, catalogIdentity);
  const catalogEntries = flattenCatalogEntries(catalog);
  const campaign = {
    authorization: approvedVolume,
    authorizationRequired: true,
    campaignId: preview.campaignId,
    campaignVersion: preview.campaignVersion,
    leaseDurationSeconds: definition.leaseDurationSeconds,
    maximumProviderConcurrency: preview.maximumProviderConcurrency,
    plannedRunCount: preview.plannedRunCount,
    proposalFactPolicy: structuredClone(preview.proposalFactPolicy),
    sourceObservation: {
      evidenceSetSha256: freeze.evidenceSetSha256,
      freezeId: freeze.freezeId,
      previewSha256: preview.previewSha256
    }
  };
  const ledgerCatalog = {
    catalogId: catalogIdentity.catalogId,
    catalogSha256: catalogIdentity.catalogSha256,
    tenantId: catalog.provider.tenantId,
    tenantVersion: catalogIdentity.tenantVersion
  };
  const jobs = preview.scenarios.map((scenarioDefinition) => {
    const sourceJob = sourceJobs.get(scenarioDefinition.catalogEntryId)?.job;
    if (sourceJob === undefined
      || sourceJob.locationFixture?.expectedBaseZoningCode
        !== scenarioDefinition.expectedBaseZoningCode) {
      throw new Error("opencounter_scenario_wave_source_observation_missing");
    }
    const entryRecord = catalogEntries.get(scenarioDefinition.catalogEntryId);
    const locationFixture = structuredClone(sourceJob.locationFixture);
    const scenario = {
      answerRules: structuredClone(scenarioDefinition.answerRules),
      previewSha256: preview.previewSha256,
      scenarioId: scenarioDefinition.scenarioId,
      scenarioVersion: scenarioDefinition.scenarioVersion,
      sourceObservation: structuredClone(scenarioDefinition.sourceObservation)
    };
    const startInput = {
      address: locationFixture.address,
      catalogEntryId: scenarioDefinition.catalogEntryId,
      catalogId: catalog.catalogId,
      jurisdiction: catalog.jurisdiction,
      schemaVersion: 1
    };
    const providerInputSha256 = createZoningProviderInputSha256({
      address: locationFixture.address,
      catalogEntryId: scenarioDefinition.catalogEntryId,
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      categoryPath: entryRecord.categoryPath,
      description: entryRecord.entry.description,
      jurisdiction: catalog.jurisdiction,
      proposedUse: entryRecord.entry.providerLabel,
      providerUseSlug: entryRecord.entry.providerUseSlug,
      workflow: catalog.workflow
    });
    const jobSha256 = createScenarioBranchJobSha256({
      campaign,
      catalog: ledgerCatalog,
      catalogEntryId: scenarioDefinition.catalogEntryId,
      locationFixture,
      providerInputSha256,
      scenario
    });
    return {
      answerPath: [],
      answersSupplied: [],
      catalogEntryId: scenarioDefinition.catalogEntryId,
      categoryPath: structuredClone(entryRecord.categoryPath),
      checkpoint: null,
      createdAt: timestamp,
      errors: [],
      evidence: [{
        actorId: "coordinator",
        eventId: randomUUID(),
        eventType: "job_planned",
        observedAt: timestamp
      }],
      jobId: `ocdj_${jobSha256}`,
      jobSha256,
      lease: null,
      locationFixture,
      nextAction: { input: startInput, kind: "start" },
      observations: [],
      pendingMutation: null,
      providerInputSha256,
      providerReference: null,
      scenario,
      status: "queued",
      terminalResult: null,
      updatedAt: timestamp,
      verification: null
    };
  });
  const ledgerSha256 = createScenarioBranchLedgerSha256({
    campaign,
    catalog: ledgerCatalog,
    jobs
  });
  return {
    campaign,
    catalog: ledgerCatalog,
    createdAt: timestamp,
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 6,
    updatedAt: timestamp
  };
}

export function createScenarioBranchJobSha256({
  campaign,
  catalog,
  catalogEntryId,
  locationFixture,
  providerInputSha256,
  scenario
}) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogEntryId,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    locationFixtureSha256: sha256(locationFixture),
    providerInputSha256,
    scenarioSha256: sha256(scenario),
    sourceObservation: campaign.sourceObservation,
    tenantVersion: catalog.tenantVersion
  });
}

export function createScenarioBranchLedgerSha256({ campaign, catalog, jobs }) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    providerVolumeAuthorization: campaign.authorization,
    sourceObservation: campaign.sourceObservation,
    tenantVersion: catalog.tenantVersion
  });
}

function validateCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Array.isArray(value.categories)
    || typeof value.catalogId !== "string"
    || !SHA256_PATTERN.test(value.catalogSha256)
    || !Number.isSafeInteger(value.provider?.tenantVersion)) {
    throw new Error("opencounter_scenario_wave_catalog_invalid");
  }
  const catalogEntryIds = value.categories.flatMap((category) => [
    ...category.entries,
    ...category.groups.flatMap((group) => group.entries)
  ]).map(({ catalogEntryId }) => catalogEntryId);
  if (catalogEntryIds.length !== 126
    || new Set(catalogEntryIds).size !== catalogEntryIds.length) {
    throw new Error("opencounter_scenario_wave_catalog_invalid");
  }
  return {
    catalogEntryIds: new Set(catalogEntryIds),
    catalogId: value.catalogId,
    catalogSha256: value.catalogSha256,
    tenantVersion: value.provider.tenantVersion
  };
}

function validateDefinition(value, catalog) {
  const expectedKeys = [
    "answerRuleOwnership", "authorizationRequired", "campaignId",
    "campaignVersion", "catalogId", "catalogSha256", "expectedScenarioCount",
    "expectedSubstantiveQuestionCount", "leaseDurationSeconds",
    "maximumProviderConcurrency", "proposalFactPolicy", "scenarios", "schemaVersion",
    "selectionStrategy", "tenantVersion"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys.sort())
    || value.authorizationRequired !== true
    || value.schemaVersion !== 2
    || value.campaignVersion !== 3
    || !ID_PATTERN.test(value.campaignId)
    || value.catalogId !== catalog.catalogId
    || value.catalogSha256 !== catalog.catalogSha256
    || value.tenantVersion !== catalog.tenantVersion
    || value.expectedScenarioCount !== 20
    || value.expectedSubstantiveQuestionCount !== 48
    || value.leaseDurationSeconds !== 900
    || value.maximumProviderConcurrency !== 2
    || value.selectionStrategy
      !== "greedy_first_layer_id_set_cover_with_provenance_bound_rules"
    || !value.answerRuleOwnership
    || typeof value.answerRuleOwnership !== "object"
    || Array.isArray(value.answerRuleOwnership)
    || !validProposalFactPolicy(value.proposalFactPolicy)
    || !Array.isArray(value.scenarios)
    || value.scenarios.length !== value.expectedScenarioCount) {
    throw new Error("opencounter_scenario_wave_definition_invalid");
  }
  const scenarioIds = new Set();
  const catalogEntryIds = new Set();
  const allQuestionIds = new Set();
  const scenarios = value.scenarios.map((value_, index) => {
    const keys = [
      "answerRules", "catalogEntryId",
      "expectedBaseZoningCode", "scenarioId", "scenarioVersion"
    ];
    if (!value_ || typeof value_ !== "object" || Array.isArray(value_)
      || JSON.stringify(Object.keys(value_).sort()) !== JSON.stringify(keys.sort())
      || !ID_PATTERN.test(value_.scenarioId)
      || scenarioIds.has(value_.scenarioId)
      || !Number.isSafeInteger(value_.scenarioVersion)
      || value_.scenarioVersion < 2
      || value_.scenarioVersion > value.campaignVersion
      || !catalog.catalogEntryIds.has(value_.catalogEntryId)
      || catalogEntryIds.has(value_.catalogEntryId)
      || !ZONING_CODE_PATTERN.test(value_.expectedBaseZoningCode)
      || !Array.isArray(value_.answerRules)
      || value_.answerRules.length < 1
      || value_.answerRules.length > 100) {
      throw new Error(`opencounter_scenario_wave_scenario_${index}_invalid`);
    }
    const questionIds = new Set();
    const answerRules = value_.answerRules.map((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)
        || JSON.stringify(Object.keys(rule).sort())
          !== JSON.stringify(["questionId", "value"])
        || typeof rule.questionId !== "string"
        || rule.questionId === "opencounter-address"
        || questionIds.has(rule.questionId)
        || typeof rule.value !== "string"
        || rule.value.length < 1 || rule.value.length > 2_000) {
        throw new Error("opencounter_scenario_wave_answer_rule_invalid");
      }
      questionIds.add(rule.questionId);
      allQuestionIds.add(rule.questionId);
      return { questionId: rule.questionId, value: rule.value };
    });
    scenarioIds.add(value_.scenarioId);
    catalogEntryIds.add(value_.catalogEntryId);
    return {
      answerRules,
      catalogEntryId: value_.catalogEntryId,
      expectedBaseZoningCode: value_.expectedBaseZoningCode,
      scenarioId: value_.scenarioId,
      scenarioVersion: value_.scenarioVersion
    };
  });
  const ownershipQuestionIds = Object.keys(value.answerRuleOwnership).sort();
  if (JSON.stringify(ownershipQuestionIds) !== JSON.stringify([...allQuestionIds].sort())
    || ownershipQuestionIds.some((questionId) =>
      value.answerRuleOwnership[questionId] !== "proposal_fact"
      && value.answerRuleOwnership[questionId] !== "site_fact"
      && value.answerRuleOwnership[questionId] !== "mixed_fact")) {
    throw new Error("opencounter_scenario_wave_rule_ownership_invalid");
  }
  return {
    ...value,
    answerRuleOwnership: structuredClone(value.answerRuleOwnership),
    proposalFactPolicy: structuredClone(value.proposalFactPolicy),
    scenarios
  };
}

function validProposalFactPolicy(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([
      "appliesToOwnership", "kind", "notRealProjectFacts", "schemaVersion"
    ].sort())
    && JSON.stringify(value.appliesToOwnership)
      === JSON.stringify(["mixed_fact", "proposal_fact"])
    && value.kind === "explicitly_synthetic_coverage_scenario"
    && value.notRealProjectFacts === true
    && value.schemaVersion === 1;
}

function collectVerifiedSourceJobs(ledgers, catalog) {
  if (!Array.isArray(ledgers) || ledgers.length < 1 || ledgers.length > 10) {
    throw new Error("opencounter_scenario_wave_source_ledgers_invalid");
  }
  const jobs = new Map();
  for (const ledger of ledgers) {
    if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)
      || ledger.catalog?.catalogId !== catalog.catalogId
      || ledger.catalog?.catalogSha256 !== catalog.catalogSha256
      || ledger.catalog?.tenantVersion !== catalog.tenantVersion
      || !Array.isArray(ledger.jobs)) {
      throw new Error("opencounter_scenario_wave_source_ledgers_invalid");
    }
    for (const job of ledger.jobs) {
      if ((job.status !== "completed" && job.status !== "needs_input")
        || job.verification === null) continue;
      if (jobs.has(job.catalogEntryId)) {
        throw new Error("opencounter_scenario_wave_source_observation_duplicate");
      }
      jobs.set(job.catalogEntryId, {
        job,
        ledgerSnapshotSha256: sha256(ledger)
      });
    }
  }
  return jobs;
}

function resolveScenarioWaveSources({ questions, sourceJobs, wave }) {
  return wave.scenarios.map((scenario) => {
    const sourceRecord = sourceJobs.get(scenario.catalogEntryId);
    const sourceJob = sourceRecord?.job;
    if (sourceJob === undefined
      || sourceJob.status !== "needs_input"
      || !sourceJob.checkpoint
      || sourceJob.locationFixture?.expectedBaseZoningCode
        !== scenario.expectedBaseZoningCode) {
      throw new Error("opencounter_scenario_wave_source_observation_missing");
    }
    const observedQuestions = questions.filter((question) =>
      question.catalogEntryIds.includes(scenario.catalogEntryId)
      && question.providerQuestionId !== "opencounter-address");
    const observedIds = new Set(observedQuestions.map(({ providerQuestionId }) =>
      providerQuestionId));
    const ruleIds = new Set(scenario.answerRules.map(({ questionId }) => questionId));
    if (observedIds.size !== ruleIds.size
      || [...observedIds].some((questionId) => !ruleIds.has(questionId))) {
      throw new Error("opencounter_scenario_wave_checkpoint_rules_incomplete");
    }
    const observedZones = new Set(observedQuestions.flatMap((question) =>
      question.observedZoningCodes));
    if (!observedZones.has(scenario.expectedBaseZoningCode)) {
      throw new Error("opencounter_scenario_wave_zoning_evidence_missing");
    }
    const answerRules = scenario.answerRules.map((rule) => {
      const matchingQuestions = observedQuestions.filter(({ providerQuestionId }) =>
        providerQuestionId === rule.questionId);
      if (matchingQuestions.length !== 1
        || !matchingQuestions[0].options.some(({ value }) => value === rule.value)) {
        throw new Error("opencounter_scenario_wave_answer_option_invalid");
      }
      const sourceCheckpointQuestions = sourceJob.checkpoint.questions.filter(
        ({ id }) => id === rule.questionId
      );
      if (sourceCheckpointQuestions.length !== 1) {
        throw new Error("opencounter_scenario_wave_question_signature_missing");
      }
      const observedQuestion = matchingQuestions[0];
      const questionSignatureSha256 = createNormalizedQuestionSignatureSha256(
        sourceCheckpointQuestions[0]
      );
      const fixtureId = `${sourceJob.locationFixture.locationId}:` +
        `${sourceJob.locationFixture.locationVersion}`;
      if (questionSignatureSha256 !== observedQuestion.normalizedSignatureSha256
        || !observedQuestion.locationFixtureIds.includes(fixtureId)) {
        throw new Error("opencounter_scenario_wave_question_signature_missing");
      }
      const ownership = wave.answerRuleOwnership[rule.questionId];
      const proposalFactDeclaration = ownership === "proposal_fact"
        || ownership === "mixed_fact"
        ? {
            declarationSha256: sha256({
              campaignId: wave.campaignId,
              campaignVersion: wave.campaignVersion,
              policy: wave.proposalFactPolicy,
              questionId: rule.questionId,
              questionSignatureSha256,
              scenarioId: scenario.scenarioId,
              scenarioVersion: scenario.scenarioVersion,
              value: rule.value
            }),
            kind: "explicitly_synthetic_coverage_fact",
            notRealProjectFact: true
          }
        : undefined;
      return {
        ownership,
        ...(proposalFactDeclaration ? { proposalFactDeclaration } : {}),
        questionId: rule.questionId,
        questionKey: observedQuestion.questionKey,
        questionSignatureSha256,
        value: rule.value
      };
    });
    return { answerRules, scenario, sourceJob, sourceRecord };
  });
}

function validateSiteFactEvidence(values, artifacts) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new Error("opencounter_scenario_wave_site_fact_evidence_invalid");
  }
  if (!Array.isArray(artifacts) || artifacts.length > 100) {
    throw new Error("opencounter_scenario_wave_site_fact_evidence_artifact_invalid");
  }
  const artifactsBySha256 = new Map();
  for (const artifact of artifacts) {
    const evidenceArtifactSha256 = sha256(artifact);
    if (artifactsBySha256.has(evidenceArtifactSha256)) {
      throw new Error("opencounter_scenario_wave_site_fact_evidence_artifact_duplicate");
    }
    artifactsBySha256.set(evidenceArtifactSha256,
      validateScenarioSiteFactEvidenceArtifact({
        artifact,
        evidenceArtifactSha256
      }));
  }
  const expectedKeys = [
    "boundarySha256", "evidenceArtifactSha256", "evidenceRef", "locationId",
    "locationVersion", "observedAt", "parcelKey", "questionId",
    "questionSignatureSha256", "rollupId", "scenarioId", "source", "value"
  ];
  const evidenceByRule = new Map();
  const usedArtifactSha256s = new Set();
  for (const evidence of values) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
      || JSON.stringify(Object.keys(evidence).sort())
        !== JSON.stringify(expectedKeys.sort())
      || !SHA256_PATTERN.test(evidence.boundarySha256)
      || !SHA256_PATTERN.test(evidence.evidenceArtifactSha256)
      || typeof evidence.evidenceRef !== "string"
      || evidence.evidenceRef.length < 1 || evidence.evidenceRef.length > 500
      || !ID_PATTERN.test(evidence.locationId)
      || !Number.isSafeInteger(evidence.locationVersion)
      || evidence.locationVersion < 1
      || !/^[0-9A-Z]{12}$/.test(evidence.parcelKey)
      || !SHA256_PATTERN.test(evidence.questionSignatureSha256)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        evidence.rollupId
      )
      || !ID_PATTERN.test(evidence.scenarioId)
      || typeof evidence.questionId !== "string"
      || evidence.questionId.length < 1 || evidence.questionId.length > 100
      || typeof evidence.source !== "string"
      || evidence.source.length < 1 || evidence.source.length > 2_000
      || typeof evidence.value !== "string"
      || evidence.value.length < 1 || evidence.value.length > 2_000) {
      throw new Error("opencounter_scenario_wave_site_fact_evidence_invalid");
    }
    isoTimestamp(evidence.observedAt, "site_fact_evidence_observedAt");
    const artifact = artifactsBySha256.get(evidence.evidenceArtifactSha256);
    if (artifact === undefined
      || evidence.evidenceRef !== `ocse_${evidence.evidenceArtifactSha256}`
      || evidence.source !== "content-addressed-site-evidence:v1"
      || evidence.observedAt !== artifact.observedAt
      || JSON.stringify(sortJson(artifact.assertion)) !== JSON.stringify(sortJson({
        boundarySha256: evidence.boundarySha256,
        locationId: evidence.locationId,
        locationVersion: evidence.locationVersion,
        parcelKey: evidence.parcelKey,
        questionId: evidence.questionId,
        questionSignatureSha256: evidence.questionSignatureSha256,
        rollupId: evidence.rollupId,
        scenarioId: evidence.scenarioId,
        value: evidence.value
      }))) {
      throw new Error("opencounter_scenario_wave_site_fact_evidence_artifact_mismatch");
    }
    usedArtifactSha256s.add(evidence.evidenceArtifactSha256);
    const key = `${evidence.scenarioId}:${evidence.questionId}`;
    if (evidenceByRule.has(key)) {
      throw new Error("opencounter_scenario_wave_site_fact_evidence_duplicate");
    }
    evidenceByRule.set(key, structuredClone(evidence));
  }
  if (usedArtifactSha256s.size !== artifactsBySha256.size) {
    throw new Error("opencounter_scenario_wave_site_fact_evidence_artifact_unmatched");
  }
  return evidenceByRule;
}

function validateSiteFactEvidenceCompatibility({
  evidence,
  fixture,
  questionSignatureSha256,
  rule,
  scenarioId
}) {
  if (evidence === undefined
    || evidence.scenarioId !== scenarioId
    || evidence.questionId !== rule.questionId
    || evidence.questionSignatureSha256 !== questionSignatureSha256
    || evidence.value !== rule.value
    || evidence.locationId !== fixture.locationId
    || evidence.locationVersion !== fixture.locationVersion
    || evidence.parcelKey !== fixture.parcelKey
    || evidence.rollupId !== fixture.rollupId
    || evidence.boundarySha256 !== fixture.boundarySha256) {
    throw new Error("opencounter_scenario_wave_site_fact_evidence_mismatch");
  }
}

function flattenCatalogEntries(catalog) {
  return new Map(catalog.categories.flatMap((category) => [
    ...category.entries.map((entry) => [entry.catalogEntryId, {
      categoryPath: [category.label],
      entry
    }]),
    ...category.groups.flatMap((group) => group.entries.map((entry) => [
      entry.catalogEntryId,
      { categoryPath: [category.label, group.label], entry }
    ]))
  ]));
}

function validateAuthorization(
  value,
  plannedRunCount,
  expectedPreviewSha256,
  createdAt
) {
  const keys = [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects",
    "previewSha256"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())
    || !ID_PATTERN.test(value.approvedBy)
    || !ID_PATTERN.test(value.authorizationId)
    || value.maximumProviderProjects !== plannedRunCount
    || value.previewSha256 !== expectedPreviewSha256) {
    throw new Error("opencounter_scenario_wave_authorization_invalid");
  }
  const approvedAt = isoTimestamp(value.approvedAt, "authorization_approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)) {
    throw new Error("opencounter_scenario_wave_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: value.approvedBy,
    authorizationId: value.authorizationId,
    maximumProviderProjects: value.maximumProviderProjects,
    previewSha256: value.previewSha256
  };
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`opencounter_scenario_wave_${path}_invalid`);
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

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}
