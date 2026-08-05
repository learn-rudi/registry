import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createDiscoveryCampaignController } from "../src/discovery-controller.mjs";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import { createDiscoveryLedgerStore } from "../src/discovery-ledger-store.mjs";
import { createCatalogDiscoveryLedger } from "../src/discovery-plan.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const discoveryDefinition = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-first-pass.json",
  import.meta.url
), "utf8"));

function createTestLedger() {
  return createCatalogDiscoveryLedger({
    authorization: {
      approvedAt: "2026-08-03T12:15:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-126-first-pass",
      maximumProviderProjects: 126
    },
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    discoveryDefinition,
    locationFixture: {
      address: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS",
      evidence: [{
        observedAt: "2026-08-03T12:00:00.000Z",
        source: "test-fixture:requester-confirmed-location"
      }],
      locationId: "confirmed-test-location",
      locationVersion: 1
    }
  });
}

test("persists mutation intent before releasing a provider dispatch request", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-test-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });

    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.equal(request.tool, "opencounter_start_zoning_guidance");
    assert.equal(job.status, "active");
    assert.equal(job.pendingMutation.dispatchId, request.dispatchId);
    assert.equal(job.lease.leaseToken, request.leaseToken);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("records an exact provider result after the original dispatch lease expires", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-late-result-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:47:00.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000399";
    const questions = [{
      id: "existing_use",
      options: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" }
      ],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    }];
    const result = {
      checkpoint: {
        checkpointSha256: createGuidanceCheckpointSha256(
          providerReference,
          questions
        ),
        expiresAt: "2026-08-04T12:47:00.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };

    const verificationRequest = await controller.recordLateDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(verificationRequest, {
      args: { providerReference },
      jobId: request.jobId,
      tool: "opencounter_get_guidance_result"
    });
    assert.equal(job.status, "needs_input");
    assert.equal(job.providerReference, providerReference);
    assert.equal(job.lease, null);
    assert.equal(job.evidence.at(-1).eventType, "start_needs_input_observed");
    assert.equal(
      job.evidence.some(({ eventType }) => eventType === "late_dispatch_result_recovered"),
      true
    );
    assert.equal(
      persisted.jobs.filter(({ status }) => status === "active").length,
      0
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("rejects the late-result path while the original dispatch lease is active", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-early-result-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:45:00.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000398";
    const questions = [{
      id: "existing_use",
      options: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" }
      ],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    }];

    await assert.rejects(controller.recordLateDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result: {
        checkpoint: {
          checkpointSha256: createGuidanceCheckpointSha256(
            providerReference,
            questions
          ),
          expiresAt: "2026-08-04T12:45:00.000Z",
          questions,
          schemaVersion: 1
        },
        providerReference,
        schemaVersion: 1,
        source: "opencounter",
        status: "needs_requester_input"
      }
    }), /expired_lease_required/);

    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);
    assert.equal(job.status, "active");
    assert.equal(job.providerReference, null);
    assert.equal(job.pendingMutation.dispatchId, request.dispatchId);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("leases the exact queued continuation instead of another worker's job", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-affinity-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    let tick = 0;
    const controller = createDiscoveryCampaignController({
      now: () => new Date(Date.parse("2026-08-03T12:31:00.000Z") + tick++ * 1_000)
        .toISOString(),
      store
    });
    const first = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const second = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-2"
    });
    const question = {
      id: "existing_use",
      options: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" }
      ],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    };
    const results = new Map();
    for (const [request, providerReference] of [
      [first, "opencounter:project:3000501"],
      [second, "opencounter:project:3000502"]
    ]) {
      const checkpointSha256 = createGuidanceCheckpointSha256(
        providerReference,
        [question]
      );
      const result = {
        checkpoint: {
          checkpointSha256,
          expiresAt: "2026-08-04T12:31:00.000Z",
          questions: [question],
          schemaVersion: 1
        },
        providerReference,
        schemaVersion: 1,
        source: "opencounter",
        status: "needs_requester_input"
      };
      const verificationRequest = await controller.recordDispatchResult({
        ledgerId: ledger.ledgerId,
        request,
        result
      });
      await controller.recordVerificationResult({
        actorId: "validator",
        ledgerId: ledger.ledgerId,
        request: verificationRequest,
        result
      });
      await store.queueAnswers({
        actorId: "coordinator",
        answerBasis: {
          approvalId: "requester-approved-affinity-test",
          approvedAt: "2026-08-03T12:15:00.000Z",
          approvedBy: "requester",
          kind: "requester_approval"
        },
        answers: [{ questionId: "existing_use", value: "No" }],
        checkpointSha256,
        jobId: request.jobId,
        ledgerId: ledger.ledgerId,
        queuedAt: new Date(
          Date.parse("2026-08-03T12:31:00.000Z") + tick++ * 1_000
        ).toISOString()
      });
      results.set(request.jobId, { providerReference });
    }

    const exact = await controller.prepareJobDispatch({
      jobId: second.jobId,
      ledgerId: ledger.ledgerId,
      workerId: "runner-2"
    });
    assert.equal(exact.jobId, second.jobId);
    assert.equal(exact.tool, "opencounter_continue_guidance");
    assert.equal(
      exact.args.providerReference,
      results.get(second.jobId).providerReference
    );
    const persisted = await store.read(ledger.ledgerId);
    assert.equal(
      persisted.jobs.find(({ jobId }) => jobId === first.jobId).status,
      "queued"
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("persists a provider result and requests read-back before address continuation", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-result-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:31:02.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000400";
    const questions = [{
      id: "opencounter-address",
      options: [{
        label: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS",
        value: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS"
      }],
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    }];
    const checkpointSha256 = createGuidanceCheckpointSha256(
      providerReference,
      questions
    );
    const result = {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:31:02.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };

    const verificationRequest = await controller.recordDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(verificationRequest, {
      args: { providerReference },
      jobId: request.jobId,
      tool: "opencounter_get_guidance_result"
    });
    assert.equal(job.status, "needs_input");
    assert.equal(job.verification, null);
    assert.equal(job.nextAction, null);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("queues the exact location only after matching provider read-back", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-verify-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:31:02.000Z",
      "2026-08-03T12:31:03.000Z",
      "2026-08-03T12:31:04.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000401";
    const questions = [{
      id: "opencounter-address",
      options: [{
        label: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS",
        value: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS"
      }],
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    }];
    const checkpointSha256 = createGuidanceCheckpointSha256(
      providerReference,
      questions
    );
    const result = {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:31:02.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };
    const verificationRequest = await controller.recordDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result
    });

    const outcome = await controller.recordVerificationResult({
      actorId: "validator",
      ledgerId: ledger.ledgerId,
      request: verificationRequest,
      result
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(outcome, {
      automaticallyQueuedLocation: true,
      jobId: request.jobId,
      status: "queued"
    });
    assert.equal(job.verification.status, "needs_requester_input");
    assert.equal(job.nextAction.kind, "continue");
    assert.deepEqual(job.nextAction.input.answers, [{
      questionId: "opencounter-address",
      value: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS"
    }]);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("reconciles an unverified checkpoint with an authoritative strict superset", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-expanded-readback-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:31:02.000Z",
      "2026-08-03T12:31:03.000Z",
      "2026-08-03T12:31:04.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000403";
    const addressQuestion = {
      id: "opencounter-address",
      options: [{
        label: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS",
        value: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS"
      }],
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    };
    const arterialQuestion = {
      id: "arterial_street",
      options: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" }
      ],
      prompt: "Is the property located on an arterial street?",
      required: true,
      type: "single_select"
    };
    const existingUseQuestion = {
      id: "existing_use",
      options: [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" }
      ],
      prompt: "Does this use already exist in this location?",
      required: true,
      type: "single_select"
    };
    const provisionalQuestions = [addressQuestion, arterialQuestion];
    const authoritativeQuestions = [
      addressQuestion,
      existingUseQuestion,
      arterialQuestion
    ];
    const resultFor = (questions, observedAt) => ({
      checkpoint: {
        checkpointSha256: createGuidanceCheckpointSha256(
          providerReference,
          questions
        ),
        expiresAt: observedAt,
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    });
    const provisionalResult = resultFor(
      provisionalQuestions,
      "2026-08-04T12:31:02.000Z"
    );
    const authoritativeResult = resultFor(
      authoritativeQuestions,
      "2026-08-04T12:31:03.000Z"
    );
    const verificationRequest = await controller.recordDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result: provisionalResult
    });

    const changedQuestionResult = resultFor([
      {
        ...addressQuestion,
        prompt: "A changed prompt must not be accepted as an expansion."
      },
      existingUseQuestion,
      arterialQuestion
    ], "2026-08-04T12:31:03.000Z");
    await assert.rejects(controller.recordVerificationResult({
      actorId: "validator",
      ledgerId: ledger.ledgerId,
      request: verificationRequest,
      result: changedQuestionResult
    }), /verification_checkpoint_mismatch/);
    const unchanged = await store.read(ledger.ledgerId);
    const unchangedJob = unchanged.jobs.find(({ jobId }) =>
      jobId === request.jobId);
    assert.equal(
      unchangedJob.checkpoint.checkpointSha256,
      provisionalResult.checkpoint.checkpointSha256
    );
    assert.equal(unchangedJob.verification, null);

    const outcome = await controller.recordVerificationResult({
      actorId: "validator",
      ledgerId: ledger.ledgerId,
      request: verificationRequest,
      result: authoritativeResult
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(outcome, {
      automaticallyQueuedLocation: false,
      jobId: request.jobId,
      status: "needs_input"
    });
    assert.deepEqual(job.checkpoint.questions, authoritativeQuestions);
    assert.equal(
      job.checkpoint.checkpointSha256,
      authoritativeResult.checkpoint.checkpointSha256
    );
    assert.equal(
      job.verification.checkpointSha256,
      authoritativeResult.checkpoint.checkpointSha256
    );
    assert.deepEqual(job.observations.at(-1).questions, authoritativeQuestions);
    assert.equal(job.answersSupplied.length, 0);
    assert.equal(job.nextAction, null);
    assert.equal(
      job.evidence.some(({ eventType }) =>
        eventType === "provider_read_back_checkpoint_reconciled"),
      true
    );
    assert.equal(
      persisted.questionGraph.questions.some(({ providerQuestionId }) =>
        providerQuestionId === "existing_use"),
      true
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("stops at the first verified substantive question without inventing an answer", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-stop-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:31:02.000Z",
      "2026-08-03T12:31:03.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });
    const providerReference = "opencounter:project:3000402";
    const questions = [{
      id: "new-construction",
      options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
      prompt: "Is this new construction?",
      required: true,
      type: "single_select"
    }];
    const checkpointSha256 = createGuidanceCheckpointSha256(
      providerReference,
      questions
    );
    const result = {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:31:02.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };
    const verificationRequest = await controller.recordDispatchResult({
      ledgerId: ledger.ledgerId,
      request,
      result
    });

    const outcome = await controller.recordVerificationResult({
      actorId: "validator",
      ledgerId: ledger.ledgerId,
      request: verificationRequest,
      result
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(outcome, {
      automaticallyQueuedLocation: false,
      jobId: request.jobId,
      status: "needs_input"
    });
    assert.equal(job.nextAction, null);
    assert.deepEqual(job.answersSupplied, []);
    assert.deepEqual(job.checkpoint.questions, questions);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("contains an unusable provider response as indeterminate without replacement", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-controller-failure-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createTestLedger();
    await store.initialize(ledger);
    const timestamps = [
      "2026-08-03T12:31:00.000Z",
      "2026-08-03T12:31:01.000Z",
      "2026-08-03T12:31:02.000Z"
    ];
    const controller = createDiscoveryCampaignController({
      now: () => timestamps.shift(),
      store
    });
    const request = await controller.prepareNextDispatch({
      ledgerId: ledger.ledgerId,
      workerId: "runner-1"
    });

    const outcome = await controller.recordUnknownDispatchFailure({
      ledgerId: ledger.ledgerId,
      request
    });
    const persisted = await store.read(ledger.ledgerId);
    const job = persisted.jobs.find(({ jobId }) => jobId === request.jobId);

    assert.deepEqual(outcome, {
      jobId: request.jobId,
      status: "indeterminate"
    });
    assert.equal(job.nextAction.kind, "start");
    assert.equal(job.pendingMutation.dispatchId, request.dispatchId);
    assert.equal(job.errors.at(-1).code, "provider_dispatch_unusable");
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});
