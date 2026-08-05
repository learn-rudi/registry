import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildScenarioSiteFactEvidenceRequirements,
  buildScenarioBranchWavePreview,
  createScenarioBranchJobSha256,
  createScenarioBranchLedger,
  createScenarioBranchLedgerSha256
} from "../src/discovery-scenario-wave.mjs";
import { buildVerifiedObservationPortfolio } from
  "../src/discovery-observation-portfolio.mjs";
import { createNormalizedQuestionSignatureSha256 } from
  "../src/discovery-question-graph.mjs";
import { createScenarioSiteFactEvidenceArtifact } from
  "../src/discovery-site-fact-evidence.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryAnswers,
  recordDiscoveryResult,
  validateDiscoveryLedger
} from "../src/discovery-ledger.mjs";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const definition = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-scenario-wave-1.json",
  import.meta.url
), "utf8"));

test("derives exact site-fact requirements from verified source observations", () => {
  const { freeze, sourceLedgers } = createScenarioFixtures(definition);
  const first = buildScenarioSiteFactEvidenceRequirements({
    catalog, definition, freeze, sourceLedgers
  });
  const second = buildScenarioSiteFactEvidenceRequirements({
    catalog, definition, freeze, sourceLedgers
  });

  assert.deepEqual(first, second);
  assert.equal(first.requiredEvidenceCount, 9);
  assert.equal(first.requirements.every((requirement) =>
    requirement.address === undefined
    && ["mixed_fact", "site_fact"].includes(requirement.ownership)
    && /^[0-9a-f]{64}$/.test(requirement.questionSignatureSha256)), true);
  const airportCatalogEntryId =
    "transportation_communications_and_utilities_uses." +
    "transportation_facilities.airports";
  const airportSource = sourceLedgers.flatMap(({ jobs }) => jobs)
    .find(({ catalogEntryId }) => catalogEntryId === airportCatalogEntryId);
  assert.deepEqual(first.requirements.find(({ questionId }) =>
    questionId === "within_500_ft_residential"), {
    boundarySha256: airportSource.locationFixture.boundarySha256,
    catalogEntryId: airportCatalogEntryId,
    expectedBaseZoningCode: "CN-P",
    locationId: airportSource.locationFixture.locationId,
    locationVersion: airportSource.locationFixture.locationVersion,
    ownership: "site_fact",
    parcelKey: airportSource.locationFixture.parcelKey,
    questionId: "within_500_ft_residential",
    questionSignatureSha256: createNormalizedQuestionSignatureSha256(
      createSyntheticQuestion("within_500_ft_residential")),
    rollupId: airportSource.locationFixture.rollupId,
    scenarioId: "airport-within-500-foot-residential-buffer",
    value: "Yes"
  });
});

test("previews a finite authorized wave covering every first-pass substantive fact", () => {
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definition);
  const first = buildScenarioBranchWavePreview({
    catalog, definition, freeze, siteFactEvidence, siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const second = buildScenarioBranchWavePreview({
    catalog, definition, freeze, siteFactEvidence, siteFactEvidenceArtifacts,
    sourceLedgers
  });

  assert.equal(first.previewSha256, second.previewSha256);
  assert.equal(first.plannedRunCount, 20);
  assert.equal(first.coverage.substantiveQuestionCount, 48);
  assert.equal(first.coverage.uncoveredSubstantiveQuestionIds.length, 0);
  assert.equal(new Set(first.scenarios.map(({ scenarioId }) => scenarioId)).size, 20);
  assert.deepEqual(first.requiredAuthorization, {
    maximumProviderProjects: 20,
    previewSha256: first.previewSha256,
    required: true
  });
  assert.equal(first.sourceFreezeId, freeze.freezeId);
  assert.deepEqual(first.proposalFactPolicy, {
    appliesToOwnership: ["mixed_fact", "proposal_fact"],
    kind: "explicitly_synthetic_coverage_scenario",
    notRealProjectFacts: true,
    schemaVersion: 1
  });
  const incineratedMaterialRule = first.scenarios
    .flatMap(({ answerRules }) => answerRules)
    .find(({ questionId }) => questionId === "incinerated_material");
  assert.equal(incineratedMaterialRule.ownership, "mixed_fact");
  assert.equal(incineratedMaterialRule.siteFactEvidence.questionId,
    "incinerated_material");
  const ownershipByQuestionId = new Map(first.scenarios
    .flatMap(({ answerRules }) => answerRules)
    .map((rule) => [rule.questionId, rule.ownership]));
  assert.equal(ownershipByQuestionId.get("existing_use_before_code"),
    "proposal_fact");
  assert.equal(ownershipByQuestionId.get("not_in_marina_or_boatyard"),
    "mixed_fact");
  assert.equal(ownershipByQuestionId.get("barge_facilities"),
    "mixed_fact");
  const proposalRule = first.scenarios
    .flatMap(({ answerRules }) => answerRules)
    .find(({ ownership }) => ownership === "proposal_fact");
  assert.deepEqual(proposalRule.proposalFactDeclaration, {
    declarationSha256: proposalRule.proposalFactDeclaration.declarationSha256,
    kind: "explicitly_synthetic_coverage_fact",
    notRealProjectFact: true
  });
  assert.match(proposalRule.proposalFactDeclaration.declarationSha256,
    /^[0-9a-f]{64}$/);
  assert.deepEqual(incineratedMaterialRule.proposalFactDeclaration, {
    declarationSha256:
      incineratedMaterialRule.proposalFactDeclaration.declarationSha256,
    kind: "explicitly_synthetic_coverage_fact",
    notRealProjectFact: true
  });
  assert.equal(first.scenarios
    .flatMap(({ answerRules }) => answerRules)
    .find(({ questionId }) => questionId === "arterial_street")
    .proposalFactDeclaration, undefined);
  const airportScenario = first.scenarios.find(({ catalogEntryId }) =>
    catalogEntryId === "transportation_communications_and_utilities_uses." +
      "transportation_facilities.airports");
  assert.equal(airportScenario.scenarioId,
    "airport-within-500-foot-residential-buffer");
  assert.deepEqual(airportScenario.answerRules.find(({ questionId }) =>
    questionId === "within_500_ft_residential")?.value, "Yes");
  const driveBoxScenario = first.scenarios.find(({ catalogEntryId }) =>
    catalogEntryId === "accessory_uses.drive_box");
  assert.equal(driveBoxScenario.answerRules.find(({ questionId }) =>
    questionId === "within_100_ft_of_residential")?.value, "Yes");
  const liveWorkScenario = first.scenarios.find(({ catalogEntryId }) =>
    catalogEntryId === "commercial_uses.loft_dwelling_units");
  assert.equal(liveWorkScenario.scenarioId,
    "loft-dwelling-outside-designated-live-work");
  assert.equal(liveWorkScenario.answerRules.find(({ questionId }) =>
    questionId === "live_work")?.value, "No");
  assert.throws(() => buildScenarioBranchWavePreview({
    catalog,
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts: [],
    sourceLedgers
  }), /artifact/i);
  assert.equal(first.scenarios.every((scenario) =>
    scenario.answerRules.every((rule) =>
      (["mixed_fact", "proposal_fact", "site_fact"].includes(rule.ownership))
      && /^[0-9a-f]{64}$/.test(rule.questionSignatureSha256)
      && /^ocq_[0-9a-f]{64}$/.test(rule.questionKey)
      && (rule.ownership === "proposal_fact"
        ? rule.siteFactEvidence === undefined
        : rule.siteFactEvidence?.parcelKey.length === 12))), true);
});

test("rejects a scenario answer outside the exact observed options", () => {
  const invalid = structuredClone(definition);
  invalid.scenarios[0].answerRules[0].value = "Maybe";
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definition);
  assert.throws(() => buildScenarioBranchWavePreview({
    catalog,
    definition: invalid,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  }), /answer|option/i);
});

test("plans stable authorized jobs with exact synthetic scenario answers", () => {
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definition);
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const input = {
    authorization: {
      approvedAt: "2026-08-04T20:05:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-scenario-wave-1",
      maximumProviderProjects: 20,
      previewSha256: preview.previewSha256
    },
    catalog,
    createdAt: "2026-08-04T20:10:00.000Z",
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  };

  const first = createScenarioBranchLedger(input);
  const second = createScenarioBranchLedger(input);

  assert.equal(first.schemaVersion, 6);
  assert.equal(first.jobs.length, 20);
  assert.equal(first.ledgerId, second.ledgerId);
  assert.deepEqual(
    first.jobs.map(({ jobId }) => jobId),
    second.jobs.map(({ jobId }) => jobId)
  );
  assert.equal(first.jobs.every(({ nextAction, status }) =>
    nextAction.kind === "start" && status === "queued"), true);
  assert.equal(first.jobs.every(({ scenario }) =>
    scenario.previewSha256 === preview.previewSha256
    && scenario.answerRules.every(({ questionId }) =>
      questionId !== "opencounter-address")), true);
  assert.deepEqual(validateDiscoveryLedger(first), first);
  assert.equal(first.campaign.authorization.previewSha256, preview.previewSha256);

  const tampered = structuredClone(first);
  const tamperedJob = tampered.jobs.find(({ scenario }) =>
    scenario.answerRules.some(({ ownership }) => ownership === "site_fact"));
  const tamperedRule = tamperedJob.scenario.answerRules.find(
    ({ ownership }) => ownership === "site_fact"
  );
  tamperedRule.siteFactEvidence.parcelKey = "999999999999";
  tamperedJob.jobSha256 = createScenarioBranchJobSha256({
    campaign: tampered.campaign,
    catalog: tampered.catalog,
    catalogEntryId: tamperedJob.catalogEntryId,
    locationFixture: tamperedJob.locationFixture,
    providerInputSha256: tamperedJob.providerInputSha256,
    scenario: tamperedJob.scenario
  });
  tamperedJob.jobId = `ocdj_${tamperedJob.jobSha256}`;
  tampered.ledgerSha256 = createScenarioBranchLedgerSha256({
    campaign: tampered.campaign,
    catalog: tampered.catalog,
    jobs: tampered.jobs
  });
  tampered.ledgerId = `ocdl_${tampered.ledgerSha256}`;
  assert.throws(() => validateDiscoveryLedger(tampered), /site_fact_evidence/);

  const tamperedProposal = structuredClone(first);
  const proposalJob = tamperedProposal.jobs.find(({ scenario }) =>
    scenario.answerRules.some(({ ownership }) => ownership === "proposal_fact"));
  const proposalRule = proposalJob.scenario.answerRules.find(
    ({ ownership }) => ownership === "proposal_fact"
  );
  proposalRule.proposalFactDeclaration.declarationSha256 = "0".repeat(64);
  proposalJob.jobSha256 = createScenarioBranchJobSha256({
    campaign: tamperedProposal.campaign,
    catalog: tamperedProposal.catalog,
    catalogEntryId: proposalJob.catalogEntryId,
    locationFixture: proposalJob.locationFixture,
    providerInputSha256: proposalJob.providerInputSha256,
    scenario: proposalJob.scenario
  });
  proposalJob.jobId = `ocdj_${proposalJob.jobSha256}`;
  tamperedProposal.ledgerSha256 = createScenarioBranchLedgerSha256({
    campaign: tamperedProposal.campaign,
    catalog: tamperedProposal.catalog,
    jobs: tamperedProposal.jobs
  });
  tamperedProposal.ledgerId = `ocdl_${tamperedProposal.ledgerSha256}`;
  assert.throws(() => validateDiscoveryLedger(tamperedProposal),
    /proposal_fact/);

  assert.throws(() => createScenarioBranchLedger({
    ...input,
    authorization: { ...input.authorization, maximumProviderProjects: 19 }
  }), /authorization/i);
  assert.throws(() => createScenarioBranchLedger({
    ...input,
    authorization: {
      ...input.authorization,
      previewSha256: digest("different-approved-preview")
    }
  }), /authorization/i);

  const mutatedSourceLedgers = structuredClone(sourceLedgers);
  mutatedSourceLedgers[0].snapshotMutation = true;
  assert.throws(() => createScenarioBranchLedger({
    ...input,
    sourceLedgers: mutatedSourceLedgers
  }), /source_snapshot_mismatch/);
});

test("queues signature-bound mixed-provenance scenario answers from the approved preview", () => {
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definition);
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  let ledger = createScenarioBranchLedger({
    authorization: {
      approvedAt: "2026-08-04T20:05:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-scenario-wave-1",
      maximumProviderProjects: 20,
      previewSha256: preview.previewSha256
    },
    catalog,
    createdAt: "2026-08-04T20:10:00.000Z",
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-04T20:11:00.000Z",
    workerId: "scenario-runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-04T20:12:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "scenario-runner-1"
  });
  const providerReference = "opencounter:project:2999999";
  const questions = leased.job.scenario.answerRules.map(({ questionId }) =>
    createSyntheticQuestion(questionId));
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:13:00.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T20:13:00.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    },
    workerId: "scenario-runner-1"
  });
  const checkpointed = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  const answers = checkpointed.scenario.answerRules.map(({ questionId, value }) => ({
    questionId,
    value
  }));
  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      kind: "scenario_fixture",
      previewSha256: preview.previewSha256,
      scenarioId: checkpointed.scenario.scenarioId,
      scenarioVersion: checkpointed.scenario.scenarioVersion
    },
    answers,
    checkpointSha256,
    jobId: checkpointed.jobId,
    queuedAt: "2026-08-04T20:14:00.000Z"
  });

  const queued = ledger.jobs.find(({ jobId }) => jobId === checkpointed.jobId);
  assert.equal(queued.status, "queued");
  assert.deepEqual(queued.nextAction.answerBasis, {
    kind: "scenario_fixture",
    previewSha256: preview.previewSha256,
    scenarioId: checkpointed.scenario.scenarioId,
    scenarioVersion: checkpointed.scenario.scenarioVersion
  });
  assert.deepEqual(queued.nextAction.input.answers, answers);
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);
});

test("queues one checkpoint containing location and approved scenario answers", () => {
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definition);
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  let ledger = createScenarioBranchLedger({
    authorization: {
      approvedAt: "2026-08-04T20:05:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-scenario-wave-1",
      maximumProviderProjects: 20,
      previewSha256: preview.previewSha256
    },
    catalog,
    createdAt: "2026-08-04T20:10:00.000Z",
    definition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-04T20:11:00.000Z",
    workerId: "scenario-runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-04T20:12:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "scenario-runner-1"
  });
  const providerReference = "opencounter:project:2999999";
  const questions = [{
    id: "opencounter-address",
    options: [{
      label: leased.job.locationFixture.address,
      value: leased.job.locationFixture.address
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }, ...leased.job.scenario.answerRules.map(({ questionId }) =>
    createSyntheticQuestion(questionId))];
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:13:00.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T20:13:00.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    },
    workerId: "scenario-runner-1"
  });
  const checkpointed = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  const answers = [{
    questionId: "opencounter-address",
    value: checkpointed.locationFixture.address
  }, ...checkpointed.scenario.answerRules.map(({ questionId, value }) => ({
    questionId,
    value
  }))];
  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      kind: "scenario_and_location_fixtures",
      locationId: checkpointed.locationFixture.locationId,
      locationVersion: checkpointed.locationFixture.locationVersion,
      previewSha256: preview.previewSha256,
      scenarioId: checkpointed.scenario.scenarioId,
      scenarioVersion: checkpointed.scenario.scenarioVersion
    },
    answers,
    checkpointSha256,
    jobId: checkpointed.jobId,
    queuedAt: "2026-08-04T20:14:00.000Z"
  });

  const queued = ledger.jobs.find(({ jobId }) => jobId === checkpointed.jobId);
  assert.equal(queued.status, "queued");
  assert.deepEqual(queued.nextAction.answerBasis, {
    kind: "scenario_and_location_fixtures",
    locationId: checkpointed.locationFixture.locationId,
    locationVersion: checkpointed.locationFixture.locationVersion,
    previewSha256: preview.previewSha256,
    scenarioId: checkpointed.scenario.scenarioId,
    scenarioVersion: checkpointed.scenario.scenarioVersion
  });
  assert.deepEqual(queued.nextAction.input.answers, answers);
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);
});

function createScenarioFixtures(value) {
  const sourceLedgers = createSourceLedgers(value);
  const siteFacts = createSiteFactEvidence(value, sourceLedgers);
  return {
    freeze: buildVerifiedObservationPortfolio({
      catalog,
      frozenAt: "2026-08-04T20:00:00.000Z",
      ledgers: sourceLedgers
    }),
    ...siteFacts,
    sourceLedgers
  };
}

function createSourceLedgers(value) {
  const scenarios = new Map(value.scenarios.map((scenario) => [
    scenario.catalogEntryId,
    scenario
  ]));
  const entries = catalog.categories.flatMap((category) => [
    ...category.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label]
    })),
    ...category.groups.flatMap((group) => group.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label, group.label]
    })))
  ]).sort((left, right) => left.catalogEntryId.localeCompare(right.catalogEntryId));
  const jobs = entries.map(({ catalogEntryId, categoryPath }, index) => {
    const scenario = scenarios.get(catalogEntryId);
    const expectedBaseZoningCode = scenario?.expectedBaseZoningCode ?? "SF-2";
    const questions = (scenario?.answerRules ?? [{ questionId: "existing_use" }])
      .map(({ questionId }) => createSyntheticQuestion(questionId));
    const checkpointSha256 = digest(`source-checkpoint-${index}`);
    const providerReference = `opencounter:project:${2_920_000 + index}`;
    return {
      catalogEntryId,
      categoryPath,
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T19:00:00.000Z",
        questions,
        schemaVersion: 1
      },
      jobId: `ocdj_${digest(`source-job-${index}`)}`,
      locationFixture: {
        address: `SYNTHETIC SCENARIO LOCATION ${index + 1} — NOT A PROVIDER ADDRESS`,
        boundarySha256: digest(`boundary-${index}`),
        evidence: [{
          evidenceRef: `synthetic-location-evidence-${index + 1}`,
          observedAt: "2026-08-04T19:00:00.000Z",
          source: "test-fixture:scenario-source-location"
        }],
        expectedBaseZoningCode,
        locationId: `synthetic-scenario-location-${index + 1}`,
        locationVersion: 1,
        municipality: "City of Cincinnati",
        observedZoningCode: expectedBaseZoningCode,
        overlayFlags: [],
        parcelKey: String(index + 1).padStart(12, "0"),
        rollupId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      },
      observations: [{
        answers: [],
        checkpointSha256,
        observedAt: "2026-08-04T19:00:00.000Z",
        operation: "start",
        questions,
        resultStatus: "needs_requester_input"
      }],
      providerReference,
      scenario: {
        answerRules: [],
        assumptions: {},
        scenarioId: "first-pass-question-observation",
        scenarioVersion: 1
      },
      status: "needs_input",
      terminalResult: null,
      verification: {
        checkpointSha256,
        observedAt: "2026-08-04T19:00:00.000Z",
        providerReference,
        status: "needs_requester_input"
      }
    };
  });
  return [{
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    jobs,
    ledgerId: `ocdl_${digest("synthetic-source-ledger")}`,
    ledgerSha256: digest("synthetic-source-ledger"),
    schemaVersion: 4
  }];
}

function createSiteFactEvidence(value, ledgers) {
  const jobs = new Map(ledgers.flatMap((ledger) => ledger.jobs.map((job) => [
    job.catalogEntryId,
    job
  ])));
  const siteFactEvidence = [];
  const siteFactEvidenceArtifacts = [];
  for (const scenario of value.scenarios) {
    for (const { questionId, value: answerValue } of scenario.answerRules) {
      if (value.answerRuleOwnership[questionId] !== "site_fact"
        && value.answerRuleOwnership[questionId] !== "mixed_fact") continue;
      const job = jobs.get(scenario.catalogEntryId);
      const fixture = job.locationFixture;
      const assertion = {
        boundarySha256: fixture.boundarySha256,
        locationId: fixture.locationId,
        locationVersion: fixture.locationVersion,
        parcelKey: fixture.parcelKey,
        questionId,
        questionSignatureSha256: createNormalizedQuestionSignatureSha256(
          createSyntheticQuestion(questionId)
        ),
        rollupId: fixture.rollupId,
        scenarioId: scenario.scenarioId,
        value: answerValue
      };
      const created = createScenarioSiteFactEvidenceArtifact({
        assertion,
        conclusionRationale: "Synthetic test evidence verifies the exact rule.",
        observedAt: "2026-08-04T19:30:00.000Z",
        sources: [{
          evidenceRef: `synthetic-site-fact:${scenario.scenarioId}:${questionId}`,
          payload: { synthetic: true },
          retrievedAt: "2026-08-04T19:30:00.000Z",
          source: "test-fixture:parcel-specific-site-fact"
        }]
      });
      siteFactEvidenceArtifacts.push(created.artifact);
      siteFactEvidence.push({
        ...assertion,
        evidenceArtifactSha256: created.evidenceArtifactSha256,
        evidenceRef: created.evidenceRef,
        observedAt: created.artifact.observedAt,
        source: "content-addressed-site-evidence:v1"
      });
    }
  }
  return { siteFactEvidence, siteFactEvidenceArtifacts };
}

function createSyntheticQuestion(questionId) {
  return {
    id: questionId,
    options: [
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" }
    ],
    prompt: `Synthetic prompt for ${questionId}`,
    required: true,
    type: "single_select"
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
