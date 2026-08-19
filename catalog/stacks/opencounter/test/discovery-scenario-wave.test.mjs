import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
import {
  buildObservedQuestionGraph,
  createNormalizedQuestionSignatureSha256
} from
  "../src/discovery-question-graph.mjs";
import { createScenarioSiteFactEvidenceArtifact } from
  "../src/discovery-site-fact-evidence.mjs";
import {
  buildScenarioWaveAdjudicationPreview,
  buildScenarioWaveResidualDriftPacket,
  buildScenarioWaveResidualPreview,
  createScenarioWaveResidualArtifactStore,
  createScenarioWaveResidualLedger,
  resolveScenarioWaveAdjudication
} from "../src/discovery-scenario-residual.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryAnswers,
  queueDiscoveryReconciliation,
  recordDiscoveryFailure,
  recordDiscoveryResult,
  recordDiscoveryVerification,
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

test("admits only the closed common-fictional Wave 2 campaign identity", () => {
  const waveTwoDefinition = structuredClone(definition);
  waveTwoDefinition.campaignId =
    "cincinnati-zoning-common-fictional-branch-wave-2";
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(waveTwoDefinition);
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition: waveTwoDefinition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const input = {
    authorization: {
      approvedAt: "2026-08-05T03:00:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-common-fictional-wave-2",
      maximumProviderProjects: 20,
      previewSha256: preview.previewSha256
    },
    catalog,
    createdAt: "2026-08-05T03:00:00.001Z",
    definition: waveTwoDefinition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  };
  const ledger = createScenarioBranchLedger(input);

  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);

  const unknownDefinition = structuredClone(waveTwoDefinition);
  unknownDefinition.campaignId = "unapproved-scenario-campaign";
  const unknownPreview = buildScenarioBranchWavePreview({
    catalog,
    definition: unknownDefinition,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  const unknownLedger = createScenarioBranchLedger({
    ...input,
    authorization: {
      ...input.authorization,
      previewSha256: unknownPreview.previewSha256
    },
    definition: unknownDefinition
  });
  assert.throws(() => validateDiscoveryLedger(unknownLedger),
    /scenario_campaign_invalid/);
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

test("promotes an uncertain scenario continuation when readback proves completion", () => {
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
  let leased = leaseNextDiscoveryJob(ledger, {
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
  const checkpointResult = {
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
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:13:00.000Z",
    result: checkpointResult,
    workerId: "scenario-runner-1"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-04T20:13:30.000Z",
    result: checkpointResult
  });
  const checkpointed = ledger.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  const answers = checkpointed.scenario.answerRules.map(
    ({ questionId, value }) => ({ questionId, value })
  );
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
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-04T20:15:00.000Z",
    workerId: "scenario-runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-04T20:16:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "scenario-runner-1"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "provider_dispatch_unusable",
      effect: "unknown",
      message: "Continuation result was unusable."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:17:00.000Z",
    workerId: "scenario-runner-1"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-04T20:18:00.000Z"
  });
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-04T20:19:00.000Z",
    workerId: "scenario-runner-2"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-04T20:20:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "scenario-runner-2"
  });
  const reconcilingLedger = structuredClone(ledger);
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:21:00.000Z",
    result: checkpointResult,
    workerId: "scenario-runner-2"
  });

  const terminalResult = { zoningDistrict: "MA" };
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-04T20:22:00.000Z",
    result: {
      providerReference,
      result: terminalResult,
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    }
  });

  const completed = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.terminalResult, terminalResult);
  assert.deepEqual(completed.answersSupplied.at(-1).answers, answers);
  assert.equal(completed.verification.status, "completed");
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);

  let indeterminateLedger = recordDiscoveryResult(reconcilingLedger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T20:21:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference,
      providerRoute: "/projects/2999999/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "scenario-runner-2"
  });
  indeterminateLedger = recordDiscoveryVerification(indeterminateLedger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-04T20:22:00.000Z",
    result: {
      providerReference,
      result: terminalResult,
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    }
  });
  const recovered = indeterminateLedger.jobs.find(
    ({ jobId }) => jobId === leased.job.jobId
  );
  assert.equal(recovered.status, "completed");
  assert.deepEqual(recovered.terminalResult, terminalResult);
  assert.deepEqual(recovered.answersSupplied.at(-1).answers, answers);
  assert.equal(recovered.verification.status, "completed");
  assert.deepEqual(validateDiscoveryLedger(indeterminateLedger), indeterminateLedger);
  const graph = buildObservedQuestionGraph(indeterminateLedger);
  assert.equal(graph.edges.some(({ terminalStatus }) =>
    terminalStatus === "completed"), true);
});

test("plans an exact preview-bound residual for only never-started scenarios", () => {
  const { driftPacket, sourceLedger } = createScenarioResidualFixture();
  const sourceBefore = structuredClone(sourceLedger);
  const preview = buildScenarioWaveResidualPreview({
    driftPacket,
    sourceLedger
  });

  assert.equal(preview.plannedRunCount, 14);
  assert.deepEqual(preview.requiredAuthorization, {
    maximumProviderProjects: 14,
    previewSha256: preview.previewSha256,
    required: true
  });
  assert.equal(preview.residualOf.consumedJobs.length, 6);
  assert.equal(preview.residualOf.remainingJobs.length, 14);
  assert.equal(preview.scenarios.length, 14);
  assert.equal(preview.scenarios.some(({ sourceJobId }) =>
    preview.residualOf.consumedJobs.some(({ jobId }) => jobId === sourceJobId)),
  false);
  assert.deepEqual(sourceLedger, sourceBefore);

  const authorization = {
    approvedAt: "2026-08-04T21:00:00.000Z",
    approvedBy: "requester",
    authorizationId: "requester-approved-scenario-wave-1-residual",
    maximumProviderProjects: 14,
    previewSha256: preview.previewSha256
  };
  const first = createScenarioWaveResidualLedger({
    authorization,
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  });
  const second = createScenarioWaveResidualLedger({
    authorization,
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  });

  assert.equal(first.schemaVersion, 7);
  assert.equal(first.jobs.length, 14);
  assert.equal(first.ledgerId, second.ledgerId);
  assert.deepEqual(first.jobs.map(({ jobId }) => jobId),
    second.jobs.map(({ jobId }) => jobId));
  assert.equal(first.jobs.every(({ providerReference, status }) =>
    providerReference === null && status === "queued"), true);
  assert.deepEqual(validateDiscoveryLedger(first), first);
  assert.deepEqual(sourceLedger, sourceBefore);
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-scenario-residual-test-"
  ));
  try {
    const store = createScenarioWaveResidualArtifactStore({ stateDirectory });
    const storedPacket = store.writeDriftPacket(driftPacket, sourceLedger);
    const storedPreview = store.writePreview(preview, {
      driftPacket,
      sourceLedger
    });
    assert.equal(statSync(storedPacket.path).mode & 0o777, 0o600);
    assert.equal(statSync(storedPreview.path).mode & 0o777, 0o600);
    assert.deepEqual(
      store.readDriftPacket(driftPacket.driftPacketSha256, sourceLedger).artifact,
      driftPacket
    );
    assert.deepEqual(
      store.readPreview(preview.previewSha256, {
        driftPacket,
        sourceLedger
      }).artifact,
      preview
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
  const changedSnapshot = structuredClone(sourceLedger);
  changedSnapshot.updatedAt = "2026-08-04T20:39:30.000Z";
  assert.throws(() => buildScenarioWaveResidualPreview({
    driftPacket,
    sourceLedger: changedSnapshot
  }), /drift_packet|snapshot|source/i);
  assert.throws(() => createScenarioWaveResidualLedger({
    authorization: sourceLedger.campaign.authorization,
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  }), /authorization/i);
});

test("plans a closed Wave 2 residual after every started project is verified", () => {
  const waveTwoDefinition = structuredClone(definition);
  waveTwoDefinition.campaignId =
    "cincinnati-zoning-common-fictional-branch-wave-2";
  for (const scenario of waveTwoDefinition.scenarios) {
    scenario.scenarioVersion = 3;
  }
  const { driftPacket, sourceLedger } = createScenarioResidualFixture({
    completedJobCount: 7,
    definitionValue: waveTwoDefinition,
    driftedJobIndex: 6
  });

  const preview = buildScenarioWaveResidualPreview({
    driftPacket,
    sourceLedger
  });

  assert.equal(preview.campaignId,
    "cincinnati-zoning-common-fictional-branch-wave-2-residual");
  assert.equal(preview.plannedRunCount, 13);
  assert.equal(preview.requiredAuthorization.maximumProviderProjects, 13);
  assert.equal(preview.residualOf.consumedJobs.length, 7);
  assert.equal(preview.residualOf.remainingJobs.length, 13);
  assert.deepEqual(preview.residualOf.parentCampaign, {
    campaignId: "cincinnati-zoning-common-fictional-branch-wave-2",
    campaignVersion: 3
  });
  const residualLedger = createScenarioWaveResidualLedger({
    authorization: {
      approvedAt: "2026-08-04T21:00:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-common-fictional-wave-2-residual",
      maximumProviderProjects: 13,
      previewSha256: preview.previewSha256
    },
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  });
  assert.equal(residualLedger.jobs.length, 13);
  assert.equal(residualLedger.jobs.every(({ providerReference, status }) =>
    providerReference === null && status === "queued"), true);
  assert.deepEqual(validateDiscoveryLedger(residualLedger), residualLedger);
});

test("binds residual continuation answers to the new residual preview", () => {
  const { driftPacket, sourceLedger } = createScenarioResidualFixture();
  const preview = buildScenarioWaveResidualPreview({ driftPacket, sourceLedger });
  let ledger = createScenarioWaveResidualLedger({
    authorization: {
      approvedAt: "2026-08-04T21:00:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-scenario-wave-1-residual",
      maximumProviderProjects: 14,
      previewSha256: preview.previewSha256
    },
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-04T21:02:00.000Z",
    workerId: "scenario-residual-runner"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-04T21:02:01.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "scenario-residual-runner"
  });
  const providerReference = "opencounter:project:2999998";
  const questions = leased.job.scenario.answerRules.map(({ questionId }) =>
    createSyntheticQuestion(questionId));
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-04T21:02:02.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T21:02:02.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    },
    workerId: "scenario-residual-runner"
  });
  const checkpointed = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  const answers = checkpointed.scenario.answerRules.map(({ questionId, value }) => ({
    questionId,
    value
  }));
  const basis = {
    kind: "scenario_fixture",
    previewSha256: preview.previewSha256,
    scenarioId: checkpointed.scenario.scenarioId,
    scenarioVersion: checkpointed.scenario.scenarioVersion
  };

  assert.throws(() => queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      ...basis,
      previewSha256: checkpointed.scenario.previewSha256
    },
    answers,
    checkpointSha256,
    jobId: checkpointed.jobId,
    queuedAt: "2026-08-04T21:02:03.000Z"
  }), /answer_basis/i);
  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: basis,
    answers,
    checkpointSha256,
    jobId: checkpointed.jobId,
    queuedAt: "2026-08-04T21:02:03.000Z"
  });

  assert.equal(ledger.jobs.find(({ jobId }) => jobId === checkpointed.jobId)
    .nextAction.answerBasis.previewSha256, preview.previewSha256);
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);
});

test("previews zero-project adjudication only after the residual is verified", () => {
  const { driftPacket, residualLedger, sourceLedger } =
    createCompletedScenarioResidualFixture();
  const sourceBefore = structuredClone(sourceLedger);
  const residualBefore = structuredClone(residualLedger);
  const first = buildScenarioWaveAdjudicationPreview({
    driftPacket,
    residualLedger,
    sourceLedger
  });
  const second = buildScenarioWaveAdjudicationPreview({
    driftPacket,
    residualLedger,
    sourceLedger
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.requiredAuthorization, {
    maximumProviderProjects: 0,
    previewSha256: first.previewSha256,
    required: true
  });
  assert.equal(first.authorizedOutcome, "scenario_wave_1_complete");
  assert.equal(first.coverageMetric, "first_pass_provider_question_id_coverage");
  assert.deepEqual(first.excludedClaims, ["answer_branch_complete"]);
  assert.equal(first.logicalScenarioCount, 20);
  assert.equal(first.dispositions.length, 1);
  assert.deepEqual(first.dispositions[0], {
    acceptedBaseZoningCode: "SF-20",
    catalogEntryId: "accessory_uses.drive_box",
    disposition: "accept_verified_terminal_result_in_observed_context",
    expectedBaseZoningCode: "SF-2",
    officialEvidenceRef: "city-cagis-feature-333",
    officialEvidenceSha256: digest("city-cagis-feature-333-sf-20"),
    providerReference: sourceLedger.jobs[5].providerReference,
    providerTerminalResultSha256:
      driftPacket.drifts[0].providerTerminalResultSha256,
    providerVerificationSha256:
      driftPacket.drifts[0].providerVerificationSha256,
    scenarioId: "drive-box-screened-outside-floodplain",
    sourceJobId: sourceLedger.jobs[5].jobId
  });
  assert.equal(first.limitations.some((value) => /SF-2/.test(value)), true);
  assert.equal(first.source.residualLedgerSnapshotSha256.length, 64);
  assert.deepEqual(sourceLedger, sourceBefore);
  assert.deepEqual(residualLedger, residualBefore);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-scenario-adjudication-test-"
  ));
  try {
    const store = createScenarioWaveResidualArtifactStore({ stateDirectory });
    const stored = store.writeAdjudicationPreview(first, {
      driftPacket,
      residualLedger,
      sourceLedger
    });
    assert.equal(statSync(stored.path).mode & 0o777, 0o600);
    assert.deepEqual(store.readAdjudicationPreview(first.previewSha256, {
      driftPacket,
      residualLedger,
      sourceLedger
    }).artifact, first);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }

  const incompleteResidual = structuredClone(residualLedger);
  incompleteResidual.jobs[0].status = "needs_input";
  assert.throws(() => buildScenarioWaveAdjudicationPreview({
    driftPacket,
    residualLedger: incompleteResidual,
    sourceLedger
  }), /residual.*complete|verification|ledger/i);
});

test("resolves only the exact approved zero-project adjudication", () => {
  const { driftPacket, residualLedger, sourceLedger } =
    createCompletedScenarioResidualFixture();
  const preview = buildScenarioWaveAdjudicationPreview({
    driftPacket,
    residualLedger,
    sourceLedger
  });
  const authorization = {
    approvedAt: "2026-08-04T22:00:00.000Z",
    approvedBy: "requester",
    authorizationId: "requester-approved-sf20-adjudication",
    maximumProviderProjects: 0,
    previewSha256: preview.previewSha256
  };
  const inputs = {
    authorization,
    driftPacket,
    preview,
    residualLedger,
    resolvedAt: "2026-08-04T22:01:00.000Z",
    sourceLedger
  };
  const first = resolveScenarioWaveAdjudication(inputs);
  const second = resolveScenarioWaveAdjudication(inputs);

  assert.deepEqual(first, second);
  assert.equal(first.status, "resolved");
  assert.equal(first.authorization.maximumProviderProjects, 0);
  assert.equal(first.authorization.previewSha256, preview.previewSha256);
  assert.equal(first.completionClaim.kind, "scenario_wave_1_complete");
  assert.equal(first.completionClaim.logicalScenarioCount, 20);
  assert.equal(first.completionClaim.coverageMetric,
    "first_pass_provider_question_id_coverage");
  assert.deepEqual(first.completionClaim.excludedClaims,
    ["answer_branch_complete"]);
  assert.match(first.adjudicationId, /^ocswa_[0-9a-f]{64}$/);
  assert.match(first.completionClaim.claimId, /^ocswc_[0-9a-f]{64}$/);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-scenario-adjudication-resolution-test-"
  ));
  try {
    const store = createScenarioWaveResidualArtifactStore({ stateDirectory });
    const stored = store.writeAdjudicationResolution(first, inputs);
    assert.equal(statSync(stored.path).mode & 0o777, 0o600);
    assert.deepEqual(store.readAdjudicationResolution(
      first.adjudicationSha256,
      inputs
    ).artifact, first);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }

  assert.throws(() => resolveScenarioWaveAdjudication({
    ...inputs,
    authorization: { ...authorization, maximumProviderProjects: 1 }
  }), /authorization/i);
  assert.throws(() => resolveScenarioWaveAdjudication({
    ...inputs,
    authorization: { ...authorization, previewSha256: digest("wrong-preview") }
  }), /authorization/i);
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

function createScenarioResidualFixture({
  completedJobCount = 6,
  definitionValue = definition,
  driftedJobIndex = 5
} = {}) {
  const { freeze, siteFactEvidence, siteFactEvidenceArtifacts, sourceLedgers } =
    createScenarioFixtures(definitionValue);
  const preview = buildScenarioBranchWavePreview({
    catalog,
    definition: definitionValue,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  let sourceLedger = createScenarioBranchLedger({
    authorization: {
      approvedAt: "2026-08-04T20:05:00.000Z",
      approvedBy: "requester",
      authorizationId: definitionValue.campaignId
        === "cincinnati-zoning-common-fictional-branch-wave-2"
        ? "requester-approved-common-fictional-wave-2"
        : "requester-approved-scenario-wave-1",
      maximumProviderProjects: 20,
      previewSha256: preview.previewSha256
    },
    catalog,
    createdAt: "2026-08-04T20:10:00.000Z",
    definition: definitionValue,
    freeze,
    siteFactEvidence,
    siteFactEvidenceArtifacts,
    sourceLedgers
  });
  for (let index = 0; index < completedJobCount; index += 1) {
    const leasedAt = new Date(Date.parse("2026-08-04T20:11:00.000Z")
      + index * 4_000).toISOString();
    const dispatchedAt = new Date(Date.parse(leasedAt) + 1_000).toISOString();
    const observedAt = new Date(Date.parse(leasedAt) + 2_000).toISOString();
    const verifiedAt = new Date(Date.parse(leasedAt) + 3_000).toISOString();
    const leased = leaseNextDiscoveryJob(sourceLedger, {
      leasedAt,
      workerId: "scenario-source-runner"
    });
    sourceLedger = beginDiscoveryDispatch(leased.ledger, {
      dispatchedAt,
      jobId: leased.job.jobId,
      leaseToken: leased.job.lease.leaseToken,
      workerId: "scenario-source-runner"
    });
    const providerReference = `opencounter:project:${2_999_900 + index}`;
    const zoningCode = index === driftedJobIndex
      ? "SF-20"
      : leased.job.locationFixture.expectedBaseZoningCode;
    const result = {
      providerReference,
      result: {
        classification: "Permitted",
        landUseCode: leased.job.catalogEntryId,
        zoningDistrict: `Synthetic zoning (${zoningCode})`
      },
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    };
    sourceLedger = recordDiscoveryResult(sourceLedger, {
      jobId: leased.job.jobId,
      leaseToken: leased.job.lease.leaseToken,
      observedAt,
      result,
      workerId: "scenario-source-runner"
    });
    sourceLedger = recordDiscoveryVerification(sourceLedger, {
      actorId: "validator",
      jobId: leased.job.jobId,
      observedAt: verifiedAt,
      result
    });
  }
  const driftedJob = sourceLedger.jobs[driftedJobIndex];
  if (driftedJobIndex === 5) {
    assert.equal(driftedJob.scenario.scenarioId,
      "drive-box-screened-outside-floodplain");
  }
  const driftPacket = buildScenarioWaveResidualDriftPacket({
    observedAt: "2026-08-04T20:40:00.000Z",
    officialEvidence: [{
      evidenceRef: "city-cagis-feature-333",
      evidenceSha256: digest("city-cagis-feature-333-sf-20"),
      observedAt: "2026-08-04T20:39:00.000Z",
      observedZoningCode: "SF-20",
      parcelIntersectionMethod: "full_parcel_polygon_intersection",
      source: "city_of_cincinnati_cagis",
      sourceJobId: driftedJob.jobId
    }],
    sourceLedger
  });
  return { driftPacket, sourceLedger };
}

function createCompletedScenarioResidualFixture() {
  const { driftPacket, sourceLedger } = createScenarioResidualFixture();
  const preview = buildScenarioWaveResidualPreview({ driftPacket, sourceLedger });
  let residualLedger = createScenarioWaveResidualLedger({
    authorization: {
      approvedAt: "2026-08-04T21:00:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-scenario-wave-1-residual",
      maximumProviderProjects: 14,
      previewSha256: preview.previewSha256
    },
    createdAt: "2026-08-04T21:01:00.000Z",
    driftPacket,
    sourceLedger
  });
  for (let index = 0; index < residualLedger.jobs.length; index += 1) {
    const leasedAt = new Date(Date.parse("2026-08-04T21:02:00.000Z")
      + index * 4_000).toISOString();
    const dispatchedAt = new Date(Date.parse(leasedAt) + 1_000).toISOString();
    const observedAt = new Date(Date.parse(leasedAt) + 2_000).toISOString();
    const verifiedAt = new Date(Date.parse(leasedAt) + 3_000).toISOString();
    const leased = leaseNextDiscoveryJob(residualLedger, {
      leasedAt,
      workerId: "scenario-residual-runner"
    });
    residualLedger = beginDiscoveryDispatch(leased.ledger, {
      dispatchedAt,
      jobId: leased.job.jobId,
      leaseToken: leased.job.lease.leaseToken,
      workerId: "scenario-residual-runner"
    });
    const zoningCode = leased.job.locationFixture.expectedBaseZoningCode;
    const result = {
      providerReference: `opencounter:project:${3_100_000 + index}`,
      result: {
        classification: "Permitted",
        landUseCode: leased.job.catalogEntryId,
        zoningDistrict: `Synthetic zoning (${zoningCode})`
      },
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    };
    residualLedger = recordDiscoveryResult(residualLedger, {
      jobId: leased.job.jobId,
      leaseToken: leased.job.lease.leaseToken,
      observedAt,
      result,
      workerId: "scenario-residual-runner"
    });
    residualLedger = recordDiscoveryVerification(residualLedger, {
      actorId: "validator",
      jobId: leased.job.jobId,
      observedAt: verifiedAt,
      result
    });
  }
  return { driftPacket, residualLedger, sourceLedger };
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
