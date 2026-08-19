import { randomUUID } from "node:crypto";
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

import { validateDiscoveryLedgerShape } from "./discovery-ledger-schema.mjs";
import {
  createScenarioWaveAdjudicationPreviewSha256,
  createScenarioWaveAdjudicationResolutionSha256,
  createScenarioWaveAdjudicationSha256,
  createScenarioWaveCompletionClaimSha256,
  createScenarioWaveDriftPacketSha256,
  createScenarioWaveFenceSha256,
  createScenarioWaveResidualJobSha256,
  createScenarioWaveResidualLedgerSha256,
  createScenarioWaveResidualSnapshotSha256,
  createScenarioWaveResidualValueSha256
} from "./discovery-scenario-residual-identity.mjs";
import {
  extractProviderTerminalZoningCode,
  findZoningContextDrifts
} from "./discovery-zoning-context.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const JOB_ID_PATTERN = /^ocdj_[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const START_DISPATCH_EVENT = "start_dispatch_started";
const RESIDUAL_CAMPAIGN_BY_SOURCE = new Map([
  [
    "cincinnati-zoning-common-fictional-branch-wave-2",
    "cincinnati-zoning-common-fictional-branch-wave-2-residual"
  ],
  [
    "cincinnati-zoning-scenario-branch-wave-1",
    "cincinnati-zoning-scenario-branch-wave-1-residual"
  ]
]);
const MAXIMUM_ARTIFACT_BYTES = 20 * 1024 * 1024;

export function buildScenarioWaveAdjudicationPreview({
  driftPacket,
  residualLedger,
  sourceLedger
}) {
  const source = requireScenarioWaveSource(sourceLedger);
  const packet = validateDriftPacket(driftPacket, source);
  const residual = requireCompletedScenarioWaveResidual({
    driftPacket: packet,
    residualLedger,
    sourceLedger: source
  });
  const dispositions = packet.drifts.map((drift) => ({
    acceptedBaseZoningCode: drift.providerZoningCode,
    catalogEntryId: drift.catalogEntryId,
    disposition: "accept_verified_terminal_result_in_observed_context",
    expectedBaseZoningCode: drift.expectedBaseZoningCode,
    officialEvidenceRef: drift.officialEvidence.evidenceRef,
    officialEvidenceSha256: drift.officialEvidence.evidenceSha256,
    providerReference: drift.providerReference,
    providerTerminalResultSha256: drift.providerTerminalResultSha256,
    providerVerificationSha256: drift.providerVerificationSha256,
    scenarioId: drift.scenarioId,
    sourceJobId: drift.sourceJobId
  })).sort((left, right) => left.sourceJobId.localeCompare(right.sourceJobId));
  const logicalScenarioIds = new Set([
    ...packet.adjudication.affectedScenarioIds,
    ...residual.jobs.map(({ scenario }) => scenario.scenarioId),
    ...packet.drifts.map(({ scenarioId }) => scenarioId),
    ...residual.campaign.residualOf.consumedJobs.map(({ scenarioId }) =>
      scenarioId)
  ]);
  const payload = {
    artifactKind: "scenario_wave_zoning_drift_adjudication_preview",
    authorizedOutcome: "scenario_wave_1_complete",
    coverageMetric: "first_pass_provider_question_id_coverage",
    dispositions,
    excludedClaims: ["answer_branch_complete"],
    limitations: [
      "The accepted drive-box disposition is evidence for SF-20 only; it does not establish an SF-2 drive-box disposition.",
      "The completion outcome measures first-pass provider-question-ID coverage only."
    ],
    logicalScenarioCount: logicalScenarioIds.size,
    requiredAuthorization: {
      maximumProviderProjects: 0,
      required: true
    },
    schemaVersion: 1,
    source: {
      driftPacketId: packet.driftPacketId,
      driftPacketSha256: packet.driftPacketSha256,
      pendingAdjudicationId: packet.adjudication.adjudicationId,
      pendingAdjudicationSha256: packet.adjudication.adjudicationSha256,
      residualAuthorizationId: residual.campaign.authorization.authorizationId,
      residualLedgerId: residual.ledgerId,
      residualLedgerSha256: residual.ledgerSha256,
      residualLedgerSnapshotSha256:
        createScenarioWaveResidualSnapshotSha256(residual),
      residualPreviewSha256: residual.campaign.authorization.previewSha256,
      sourceAuthorizationId: source.campaign.authorization.authorizationId,
      sourceLedgerId: source.ledgerId,
      sourceLedgerSha256: source.ledgerSha256,
      sourceLedgerSnapshotSha256: packet.sourceLedgerSnapshotSha256,
      sourcePreviewSha256: source.campaign.sourceObservation.previewSha256
    }
  };
  if (payload.logicalScenarioCount !== 20
    || dispositions.length !== packet.adjudication.affectedScenarioIds.length) {
    throw new Error("opencounter_scenario_adjudication_coverage_invalid");
  }
  const previewSha256 = createScenarioWaveAdjudicationPreviewSha256(payload);
  return {
    ...payload,
    previewSha256,
    requiredAuthorization: {
      ...payload.requiredAuthorization,
      previewSha256
    }
  };
}

export function resolveScenarioWaveAdjudication({
  authorization,
  driftPacket,
  preview,
  residualLedger,
  resolvedAt,
  sourceLedger
}) {
  const expectedPreview = validateAdjudicationPreview(preview, {
    driftPacket,
    residualLedger,
    sourceLedger
  });
  const timestamp = isoTimestamp(resolvedAt, "resolvedAt");
  const approved = validateAdjudicationAuthorization(
    authorization,
    expectedPreview,
    timestamp
  );
  if (Date.parse(timestamp) < Date.parse(residualLedger.updatedAt)
    || Date.parse(timestamp) < Date.parse(sourceLedger.updatedAt)) {
    throw new Error("opencounter_scenario_adjudication_resolution_time_invalid");
  }
  const claimPayload = {
    coverageMetric: expectedPreview.coverageMetric,
    excludedClaims: structuredClone(expectedPreview.excludedClaims),
    issuedAt: timestamp,
    kind: expectedPreview.authorizedOutcome,
    limitations: structuredClone(expectedPreview.limitations),
    logicalScenarioCount: expectedPreview.logicalScenarioCount,
    previewSha256: expectedPreview.previewSha256,
    source: structuredClone(expectedPreview.source)
  };
  const claimSha256 = createScenarioWaveCompletionClaimSha256(claimPayload);
  const completionClaim = {
    ...claimPayload,
    claimId: `ocswc_${claimSha256}`,
    claimSha256
  };
  const payload = {
    artifactKind: "scenario_wave_zoning_drift_adjudication_resolution",
    authorization: approved,
    completionClaim,
    decision: "accept_verified_observed_context",
    dispositions: structuredClone(expectedPreview.dispositions),
    previewSha256: expectedPreview.previewSha256,
    resolvedAt: timestamp,
    schemaVersion: 1,
    source: structuredClone(expectedPreview.source),
    status: "resolved"
  };
  const adjudicationSha256 =
    createScenarioWaveAdjudicationResolutionSha256(payload);
  return {
    ...payload,
    adjudicationId: `ocswa_${adjudicationSha256}`,
    adjudicationSha256
  };
}

export function buildScenarioWaveResidualDriftPacket({
  observedAt,
  officialEvidence,
  sourceLedger
}) {
  const source = requireScenarioWaveSource(sourceLedger);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  if (Date.parse(timestamp) < Date.parse(source.updatedAt)) {
    throw new Error("opencounter_scenario_residual_drift_time_invalid");
  }
  const sourceLedgerSnapshotSha256 =
    createScenarioWaveResidualSnapshotSha256(source);
  const drifts = findZoningContextDrifts(source);
  if (drifts.length < 1 || !Array.isArray(officialEvidence)
    || officialEvidence.length !== drifts.length) {
    throw new Error("opencounter_scenario_residual_drift_evidence_invalid");
  }
  const evidenceByJob = new Map(officialEvidence.map((value) => {
    const evidence = validateOfficialEvidence(value);
    if (evidenceByJobHasDuplicate(officialEvidence, evidence.sourceJobId)) {
      throw new Error("opencounter_scenario_residual_drift_evidence_invalid");
    }
    return [evidence.sourceJobId, evidence];
  }));
  const driftRecords = drifts.map((drift) => {
    const job = source.jobs.find(({ jobId }) => jobId === drift.jobId);
    const evidence = evidenceByJob.get(drift.jobId);
    if (job === undefined || evidence === undefined
      || job.status !== "completed"
      || job.verification?.status !== "completed"
      || evidence.observedZoningCode !== drift.providerZoningCode
      || evidence.observedZoningCode === drift.expectedBaseZoningCode) {
      throw new Error("opencounter_scenario_residual_drift_evidence_invalid");
    }
    return {
      address: job.locationFixture.address,
      catalogEntryId: job.catalogEntryId,
      expectedBaseZoningCode: drift.expectedBaseZoningCode,
      locationIdentitySha256: createLocationIdentitySha256(job.locationFixture),
      locationFixtureSha256: createScenarioWaveResidualValueSha256(
        job.locationFixture
      ),
      officialEvidence: evidence,
      parcelKey: job.locationFixture.parcelKey,
      providerReference: job.providerReference,
      providerTerminalResultSha256: createScenarioWaveResidualValueSha256(
        job.terminalResult
      ),
      providerVerificationSha256: createScenarioWaveResidualValueSha256(
        job.verification
      ),
      providerZoningCode: drift.providerZoningCode,
      reason: drift.reason,
      scenarioId: job.scenario.scenarioId,
      sourceJobId: job.jobId
    };
  }).sort((left, right) => left.sourceJobId.localeCompare(right.sourceJobId));
  if (evidenceByJob.size !== driftRecords.length) {
    throw new Error("opencounter_scenario_residual_drift_evidence_invalid");
  }
  const adjudicationPayload = {
    affectedScenarioIds: driftRecords.map(({ scenarioId }) => scenarioId).sort(),
    requiredResolution:
      "explicit_adjudication_or_separately_authorized_corrective_project",
    schemaVersion: 1,
    status: "pending"
  };
  const adjudicationSha256 = createScenarioWaveAdjudicationSha256(
    adjudicationPayload
  );
  const adjudication = {
    ...adjudicationPayload,
    adjudicationId: `ocswa_${adjudicationSha256}`,
    adjudicationSha256
  };
  const fencePayload = {
    driftJobIds: driftRecords.map(({ sourceJobId }) => sourceJobId).sort(),
    kind: "verified_zoning_context_drift",
    newStartsAllowed: false,
    schemaVersion: 1,
    sourceLedgerSnapshotSha256
  };
  const fenceSha256 = createScenarioWaveFenceSha256(fencePayload);
  const parentFence = {
    ...fencePayload,
    fenceId: `ocswf_${fenceSha256}`,
    fenceSha256
  };
  const payload = {
    adjudication,
    artifactKind: "scenario_wave_source_zoning_drift",
    drifts: driftRecords,
    observedAt: timestamp,
    parentFence,
    schemaVersion: 1,
    sourceLedgerId: source.ledgerId,
    sourceLedgerSha256: source.ledgerSha256,
    sourceLedgerSnapshotSha256
  };
  const driftPacketSha256 = createScenarioWaveDriftPacketSha256(payload);
  return {
    ...payload,
    driftPacketId: `ocswd_${driftPacketSha256}`,
    driftPacketSha256
  };
}

export function buildScenarioWaveResidualPreview({ driftPacket, sourceLedger }) {
  const source = requireScenarioWaveSource(sourceLedger);
  const packet = validateDriftPacket(driftPacket, source);
  const { consumedJobs, remainingJobs } = partitionSourceJobs(source);
  const affectedLocations = new Set(packet.drifts.map(
    ({ locationIdentitySha256 }) => locationIdentitySha256
  ));
  if (remainingJobs.some((job) => affectedLocations.has(
    createLocationIdentitySha256(job.locationFixture)
  ))) {
    throw new Error("opencounter_scenario_residual_affected_location_selected");
  }
  const consumedManifest = consumedJobs.map(createConsumedManifestRecord);
  const remainingManifest = remainingJobs.map(createRemainingManifestRecord);
  const residualOf = {
    consumedJobs: consumedManifest,
    driftPacket: packet,
    parentAuthorization: structuredClone(source.campaign.authorization),
    parentCampaign: {
      campaignId: source.campaign.campaignId,
      campaignVersion: source.campaign.campaignVersion
    },
    remainingJobs: remainingManifest,
    sourceLedgerId: source.ledgerId,
    sourceLedgerSha256: source.ledgerSha256,
    sourceLedgerSnapshotSha256: packet.sourceLedgerSnapshotSha256,
    sourcePreviewSha256: source.campaign.sourceObservation.previewSha256
  };
  const scenarios = remainingJobs.map((job) => ({
    catalogEntryId: job.catalogEntryId,
    categoryPath: structuredClone(job.categoryPath),
    locationFixture: structuredClone(job.locationFixture),
    providerInputSha256: job.providerInputSha256,
    scenario: structuredClone(job.scenario),
    sourceJobId: job.jobId,
    sourceJobSha256: job.jobSha256
  }));
  const payload = {
    campaignId: residualCampaignId(source.campaign.campaignId),
    campaignVersion: 1,
    catalog: structuredClone(source.catalog),
    maximumProviderConcurrency: source.campaign.maximumProviderConcurrency,
    plannedRunCount: remainingJobs.length,
    proposalFactPolicy: structuredClone(source.campaign.proposalFactPolicy),
    requiredAuthorization: {
      maximumProviderProjects: remainingJobs.length,
      required: true
    },
    residualOf,
    scenarios,
    schemaVersion: 1,
    sourceObservation: structuredClone(source.campaign.sourceObservation)
  };
  const previewSha256 = createScenarioWaveResidualValueSha256(payload);
  return {
    ...payload,
    previewSha256,
    requiredAuthorization: {
      ...payload.requiredAuthorization,
      previewSha256
    }
  };
}

export function createScenarioWaveResidualLedger({
  authorization,
  createdAt,
  driftPacket,
  sourceLedger
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const source = requireScenarioWaveSource(sourceLedger);
  const preview = buildScenarioWaveResidualPreview({ driftPacket, sourceLedger: source });
  const approvedVolume = validateAuthorization(
    authorization,
    preview,
    source.campaign.authorization,
    timestamp
  );
  const campaign = {
    authorization: approvedVolume,
    authorizationRequired: true,
    campaignId: preview.campaignId,
    campaignVersion: preview.campaignVersion,
    leaseDurationSeconds: source.campaign.leaseDurationSeconds,
    maximumProviderConcurrency: preview.maximumProviderConcurrency,
    plannedRunCount: preview.plannedRunCount,
    previewSha256: preview.previewSha256,
    proposalFactPolicy: structuredClone(preview.proposalFactPolicy),
    residualOf: structuredClone(preview.residualOf),
    sourceObservation: structuredClone(preview.sourceObservation)
  };
  const sourceJobs = new Map(source.jobs.map((job) => [job.jobId, job]));
  const jobs = preview.scenarios.map((selected) => {
    const sourceJob = sourceJobs.get(selected.sourceJobId);
    if (sourceJob === undefined) {
      throw new Error("opencounter_scenario_residual_source_job_invalid");
    }
    const job = {
      answerPath: [],
      answersSupplied: [],
      catalogEntryId: sourceJob.catalogEntryId,
      categoryPath: structuredClone(sourceJob.categoryPath),
      checkpoint: null,
      createdAt: timestamp,
      errors: [],
      evidence: [{
        actorId: "coordinator",
        eventId: randomUUID(),
        eventType: "job_planned",
        observedAt: timestamp
      }],
      jobId: "",
      jobSha256: "",
      lease: null,
      locationFixture: structuredClone(sourceJob.locationFixture),
      nextAction: structuredClone(sourceJob.nextAction),
      observations: [],
      pendingMutation: null,
      providerInputSha256: sourceJob.providerInputSha256,
      providerReference: null,
      scenario: structuredClone(sourceJob.scenario),
      status: "queued",
      terminalResult: null,
      updatedAt: timestamp,
      verification: null
    };
    job.jobSha256 = createScenarioWaveResidualJobSha256({
      campaign,
      catalog: preview.catalog,
      job,
      sourceJob: {
        jobId: selected.sourceJobId,
        jobSha256: selected.sourceJobSha256
      }
    });
    job.jobId = `ocdj_${job.jobSha256}`;
    return job;
  });
  const ledgerSha256 = createScenarioWaveResidualLedgerSha256({
    campaign,
    catalog: preview.catalog,
    jobs
  });
  return {
    campaign,
    catalog: structuredClone(preview.catalog),
    createdAt: timestamp,
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 7,
    updatedAt: timestamp
  };
}

export function createScenarioWaveResidualArtifactStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "stateDirectory");
  const directory = privateDirectory(
    path.join(root, "scenario-wave-residuals"),
    "residualDirectory"
  );
  const driftPackets = privateDirectory(
    path.join(directory, "drift-packets"),
    "driftPacketDirectory"
  );
  const previews = privateDirectory(
    path.join(directory, "previews"),
    "previewDirectory"
  );
  const adjudicationPreviews = privateDirectory(
    path.join(directory, "adjudication-previews"),
    "adjudicationPreviewDirectory"
  );
  const adjudicationResolutions = privateDirectory(
    path.join(directory, "adjudication-resolutions"),
    "adjudicationResolutionDirectory"
  );
  return {
    readAdjudicationPreview(previewSha256, inputs) {
      return readArtifact({
        digest: previewSha256,
        directory: adjudicationPreviews,
        validate: (value) => validateAdjudicationPreview(value, inputs)
      });
    },
    readDriftPacket(driftPacketSha256, sourceLedger) {
      return readArtifact({
        digest: driftPacketSha256,
        directory: driftPackets,
        validate: (value) => validateDriftPacket(value, sourceLedger)
      });
    },
    readAdjudicationResolution(adjudicationSha256, inputs) {
      return readArtifact({
        digest: adjudicationSha256,
        directory: adjudicationResolutions,
        validate: (value) => validateAdjudicationResolution(value, inputs)
      });
    },
    readPreview(previewSha256, { driftPacket, sourceLedger }) {
      return readArtifact({
        digest: previewSha256,
        directory: previews,
        validate: (value) => validateResidualPreview(
          value,
          driftPacket,
          sourceLedger
        )
      });
    },
    writeDriftPacket(value, sourceLedger) {
      const artifact = validateDriftPacket(value, sourceLedger);
      return writeArtifact({
        artifact,
        digest: artifact.driftPacketSha256,
        directory: driftPackets
      });
    },
    writeAdjudicationPreview(value, inputs) {
      const artifact = validateAdjudicationPreview(value, inputs);
      return writeArtifact({
        artifact,
        digest: artifact.previewSha256,
        directory: adjudicationPreviews
      });
    },
    writeAdjudicationResolution(value, inputs) {
      const artifact = validateAdjudicationResolution(value, inputs);
      return writeArtifact({
        artifact,
        digest: artifact.adjudicationSha256,
        directory: adjudicationResolutions
      });
    },
    writePreview(value, { driftPacket, sourceLedger }) {
      const artifact = validateResidualPreview(value, driftPacket, sourceLedger);
      return writeArtifact({
        artifact,
        digest: artifact.previewSha256,
        directory: previews
      });
    }
  };
}

function requireScenarioWaveSource(value) {
  const source = validateDiscoveryLedgerShape(value);
  if (source.schemaVersion !== 6
    || !RESIDUAL_CAMPAIGN_BY_SOURCE.has(source.campaign.campaignId)
    || source.campaign.campaignVersion !== 3
    || source.jobs.length !== 20) {
    throw new Error("opencounter_scenario_residual_source_invalid");
  }
  return source;
}

function residualCampaignId(sourceCampaignId) {
  const campaignId = RESIDUAL_CAMPAIGN_BY_SOURCE.get(sourceCampaignId);
  if (campaignId === undefined) {
    throw new Error("opencounter_scenario_residual_source_invalid");
  }
  return campaignId;
}

function partitionSourceJobs(source) {
  const consumedJobs = [];
  const remainingJobs = [];
  for (const job of source.jobs) {
    if (hasStartIntent(job)) {
      if (job.status !== "completed"
        || job.providerReference === null
        || job.pendingMutation !== null
        || job.lease !== null
        || job.verification?.status !== "completed") {
        throw new Error("opencounter_scenario_residual_consumed_job_invalid");
      }
      consumedJobs.push(job);
      continue;
    }
    if (job.status !== "queued"
      || job.providerReference !== null
      || job.pendingMutation !== null
      || job.lease !== null
      || job.checkpoint !== null
      || job.terminalResult !== null
      || job.verification !== null
      || job.nextAction?.kind !== "start"
      || job.observations.length !== 0
      || job.answersSupplied.length !== 0
      || job.answerPath.length !== 0) {
      throw new Error("opencounter_scenario_residual_remaining_job_invalid");
    }
    remainingJobs.push(job);
  }
  if (consumedJobs.length < 1 || remainingJobs.length < 1
    || consumedJobs.length + remainingJobs.length !== 20) {
    throw new Error("opencounter_scenario_residual_partition_invalid");
  }
  return { consumedJobs, remainingJobs };
}

function validateDriftPacket(value, source) {
  source = requireScenarioWaveSource(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_scenario_residual_drift_packet_invalid");
  }
  const payload = structuredClone(value);
  const driftPacketId = payload.driftPacketId;
  const driftPacketSha256 = payload.driftPacketSha256;
  delete payload.driftPacketId;
  delete payload.driftPacketSha256;
  if (!SHA256_PATTERN.test(driftPacketSha256)
    || driftPacketId !== `ocswd_${driftPacketSha256}`
    || createScenarioWaveDriftPacketSha256(payload) !== driftPacketSha256
    || payload.sourceLedgerId !== source.ledgerId
    || payload.sourceLedgerSha256 !== source.ledgerSha256
    || payload.sourceLedgerSnapshotSha256
      !== createScenarioWaveResidualSnapshotSha256(source)
    || payload.parentFence?.sourceLedgerSnapshotSha256
      !== payload.sourceLedgerSnapshotSha256) {
    throw new Error("opencounter_scenario_residual_drift_packet_invalid");
  }
  const actualDrifts = findZoningContextDrifts(source);
  if (!Array.isArray(payload.drifts)
    || payload.drifts.length !== actualDrifts.length
    || actualDrifts.some((drift) => !payload.drifts.some((record) =>
      record.sourceJobId === drift.jobId
      && record.expectedBaseZoningCode === drift.expectedBaseZoningCode
      && record.providerZoningCode === drift.providerZoningCode
      && record.reason === drift.reason))) {
    throw new Error("opencounter_scenario_residual_drift_packet_invalid");
  }
  validateEmbeddedAdjudication(payload.adjudication);
  validateEmbeddedFence(payload.parentFence, payload.drifts);
  return structuredClone(value);
}

function validateResidualPreview(value, driftPacket, sourceLedger) {
  const expected = buildScenarioWaveResidualPreview({
    driftPacket,
    sourceLedger
  });
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.previewSha256 !== expected.previewSha256
    || createScenarioWaveResidualValueSha256(value)
      !== createScenarioWaveResidualValueSha256(expected)) {
    throw new Error("opencounter_scenario_residual_preview_invalid");
  }
  return structuredClone(expected);
}

function validateAdjudicationPreview(value, inputs) {
  const expected = buildScenarioWaveAdjudicationPreview(inputs);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.previewSha256 !== expected.previewSha256
    || createScenarioWaveResidualValueSha256(value)
      !== createScenarioWaveResidualValueSha256(expected)) {
    throw new Error("opencounter_scenario_adjudication_preview_invalid");
  }
  return structuredClone(expected);
}

function validateAdjudicationResolution(value, inputs) {
  const expected = resolveScenarioWaveAdjudication(inputs);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.adjudicationSha256 !== expected.adjudicationSha256
    || createScenarioWaveResidualValueSha256(value)
      !== createScenarioWaveResidualValueSha256(expected)) {
    throw new Error("opencounter_scenario_adjudication_resolution_invalid");
  }
  return structuredClone(expected);
}

function validateAdjudicationAuthorization(value, preview, resolvedAt) {
  const keys = [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects",
    "previewSha256"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())
    || !ID_PATTERN.test(value.approvedBy)
    || !ID_PATTERN.test(value.authorizationId)
    || value.maximumProviderProjects !== 0
    || value.previewSha256 !== preview.previewSha256) {
    throw new Error("opencounter_scenario_adjudication_authorization_invalid");
  }
  const approvedAt = isoTimestamp(
    value.approvedAt,
    "adjudicationAuthorization.approvedAt"
  );
  if (Date.parse(approvedAt) > Date.parse(resolvedAt)) {
    throw new Error("opencounter_scenario_adjudication_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: value.approvedBy,
    authorizationId: value.authorizationId,
    maximumProviderProjects: 0,
    previewSha256: value.previewSha256
  };
}

function requireCompletedScenarioWaveResidual({
  driftPacket,
  residualLedger,
  sourceLedger
}) {
  const residual = validateDiscoveryLedgerShape(residualLedger);
  if (residual.schemaVersion !== 7
    || residual.campaign.campaignId
      !== residualCampaignId(sourceLedger.campaign.campaignId)
    || residual.jobs.length
      !== sourceLedger.jobs.filter((job) => !hasStartIntent(job)).length
    || residual.campaign.residualOf.sourceLedgerId !== sourceLedger.ledgerId
    || residual.campaign.residualOf.sourceLedgerSha256
      !== sourceLedger.ledgerSha256
    || residual.campaign.residualOf.sourceLedgerSnapshotSha256
      !== driftPacket.sourceLedgerSnapshotSha256
    || residual.campaign.residualOf.driftPacket.driftPacketSha256
      !== driftPacket.driftPacketSha256
    || residual.jobs.some((job) => job.status !== "completed"
      || job.verification?.status !== "completed"
      || job.providerReference === null
      || job.terminalResult === null
      || job.lease !== null
      || job.nextAction !== null
      || job.pendingMutation !== null)
    || new Set(residual.jobs.map(({ providerReference }) => providerReference)).size
      !== residual.jobs.length
    || findZoningContextDrifts(residual).length !== 0) {
    throw new Error("opencounter_scenario_adjudication_residual_complete_invalid");
  }
  return residual;
}

function validateEmbeddedAdjudication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_scenario_residual_adjudication_invalid");
  }
  const payload = structuredClone(value);
  const adjudicationId = payload.adjudicationId;
  const adjudicationSha256 = payload.adjudicationSha256;
  delete payload.adjudicationId;
  delete payload.adjudicationSha256;
  if (!SHA256_PATTERN.test(adjudicationSha256)
    || adjudicationId !== `ocswa_${adjudicationSha256}`
    || createScenarioWaveAdjudicationSha256(payload) !== adjudicationSha256
    || payload.status !== "pending") {
    throw new Error("opencounter_scenario_residual_adjudication_invalid");
  }
}

function validateEmbeddedFence(value, drifts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_scenario_residual_fence_invalid");
  }
  const payload = structuredClone(value);
  const fenceId = payload.fenceId;
  const fenceSha256 = payload.fenceSha256;
  delete payload.fenceId;
  delete payload.fenceSha256;
  if (!SHA256_PATTERN.test(fenceSha256)
    || fenceId !== `ocswf_${fenceSha256}`
    || createScenarioWaveFenceSha256(payload) !== fenceSha256
    || payload.kind !== "verified_zoning_context_drift"
    || payload.newStartsAllowed !== false
    || JSON.stringify(payload.driftJobIds)
      !== JSON.stringify(drifts.map(({ sourceJobId }) => sourceJobId).sort())) {
    throw new Error("opencounter_scenario_residual_fence_invalid");
  }
}

function validateOfficialEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      "evidenceRef", "evidenceSha256", "observedAt", "observedZoningCode",
      "parcelIntersectionMethod", "source", "sourceJobId"
    ].sort())
    || typeof value.evidenceRef !== "string"
    || value.evidenceRef.length < 1
    || value.evidenceRef.length > 500
    || !SHA256_PATTERN.test(value.evidenceSha256)
    || !ZONING_CODE_PATTERN.test(value.observedZoningCode)
    || value.parcelIntersectionMethod !== "full_parcel_polygon_intersection"
    || value.source !== "city_of_cincinnati_cagis"
    || !JOB_ID_PATTERN.test(value.sourceJobId)) {
    throw new Error("opencounter_scenario_residual_drift_evidence_invalid");
  }
  return {
    evidenceRef: value.evidenceRef,
    evidenceSha256: value.evidenceSha256,
    observedAt: isoTimestamp(value.observedAt, "officialEvidence.observedAt"),
    observedZoningCode: value.observedZoningCode,
    parcelIntersectionMethod: value.parcelIntersectionMethod,
    source: value.source,
    sourceJobId: value.sourceJobId
  };
}

function validateAuthorization(value, preview, parentAuthorization, createdAt) {
  const keys = [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects",
    "previewSha256"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())
    || !ID_PATTERN.test(value.approvedBy)
    || !ID_PATTERN.test(value.authorizationId)
    || value.authorizationId === parentAuthorization.authorizationId
    || value.maximumProviderProjects !== preview.plannedRunCount
    || value.previewSha256 !== preview.previewSha256) {
    throw new Error("opencounter_scenario_residual_authorization_invalid");
  }
  const approvedAt = isoTimestamp(value.approvedAt, "authorization.approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)) {
    throw new Error("opencounter_scenario_residual_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: value.approvedBy,
    authorizationId: value.authorizationId,
    maximumProviderProjects: value.maximumProviderProjects,
    previewSha256: value.previewSha256
  };
}

function createConsumedManifestRecord(job) {
  return {
    jobId: job.jobId,
    jobSha256: job.jobSha256,
    providerReference: job.providerReference,
    scenarioId: job.scenario.scenarioId,
    startDispatchEventIds: job.evidence
      .filter(({ eventType }) => eventType === START_DISPATCH_EVENT)
      .map(({ eventId }) => eventId)
      .sort()
  };
}

function createRemainingManifestRecord(job) {
  return {
    jobId: job.jobId,
    jobSha256: job.jobSha256,
    locationFixtureSha256: createScenarioWaveResidualValueSha256(
      job.locationFixture
    ),
    providerInputSha256: job.providerInputSha256,
    scenarioId: job.scenario.scenarioId,
    scenarioSha256: createScenarioWaveResidualValueSha256(job.scenario)
  };
}

function createLocationIdentitySha256(fixture) {
  return createScenarioWaveResidualValueSha256({
    boundarySha256: fixture.boundarySha256,
    locationId: fixture.locationId,
    locationVersion: fixture.locationVersion,
    parcelKey: fixture.parcelKey,
    rollupId: fixture.rollupId
  });
}

function hasStartIntent(job) {
  return job.evidence.some(({ eventType }) => eventType === START_DISPATCH_EVENT);
}

function evidenceByJobHasDuplicate(values, sourceJobId) {
  return values.filter((value) => value?.sourceJobId === sourceJobId).length !== 1;
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_000) {
    throw new Error(`opencounter_scenario_residual_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const details = lstatSync(value);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`opencounter_scenario_residual_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function resolveArtifactPath(directory, digest) {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error("opencounter_scenario_residual_artifact_digest_invalid");
  }
  return path.join(directory, `${digest}.json`);
}

function writeArtifact({ artifact, digest, directory }) {
  const artifactPath = resolveArtifactPath(directory, digest);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_scenario_residual_artifact_too_large");
  }
  if (existsSync(artifactPath)) {
    const existing = readJsonArtifact(artifactPath);
    if (createScenarioWaveResidualValueSha256(existing)
      !== createScenarioWaveResidualValueSha256(artifact)) {
      throw new Error("opencounter_scenario_residual_artifact_conflict");
    }
    return { bytes, digest, path: artifactPath };
  }
  const temporaryPath = path.join(directory, `${digest}.${randomUUID()}.tmp`);
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
    if (error?.code !== "EEXIST") throw error;
    const existing = readJsonArtifact(artifactPath);
    if (createScenarioWaveResidualValueSha256(existing)
      !== createScenarioWaveResidualValueSha256(artifact)) {
      throw new Error("opencounter_scenario_residual_artifact_conflict");
    }
  }
  return { bytes, digest, path: artifactPath };
}

function readArtifact({ digest, directory, validate }) {
  const artifactPath = resolveArtifactPath(directory, digest);
  const artifact = validate(readJsonArtifact(artifactPath));
  return { artifact, digest, path: artifactPath };
}

function readJsonArtifact(artifactPath) {
  const details = lstatSync(artifactPath);
  if (!details.isFile() || details.isSymbolicLink()
    || details.size > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_scenario_residual_artifact_invalid");
  }
  return JSON.parse(readFileSync(artifactPath, "utf8"));
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`opencounter_scenario_residual_${path}_invalid`);
  }
  return value;
}
