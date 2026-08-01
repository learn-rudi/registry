import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenCounterService } from "../src/core.mjs";

test("returns a bounded requester checkpoint and resumes to a sourced result", async () => {
  const driver = {
    async startGuidance(input) {
      assert.equal(input.workflow, "zoning");
      return {
        providerReference: "opencounter:project:2818607",
        questions: [{
          id: "outdoor-dining",
          options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
          prompt: "Will you have outdoor dining?",
          required: true,
          type: "single_select"
        }],
        status: "needs_requester_input"
      };
    },
    async continueGuidance(input) {
      assert.equal(input.answers[0].value, "no");
      return {
        providerReference: input.providerReference,
        result: { classification: "Permitted with Limitations", parcelId: "014500010029" },
        status: "completed"
      };
    }
  };
  const service = createOpenCounterService({ driver, now: () => "2026-08-01T15:00:00.000Z" });
  const started = await service.startGuidance({
    address: "414 Central Avenue, Cincinnati, OH",
    jurisdiction: "cincinnati-oh",
    proposedUse: "Restaurants, full service",
    workflow: "zoning"
  });
  assert.equal(started.status, "needs_requester_input");
  assert.equal(started.checkpoint.expiresAt, "2026-08-02T15:00:00.000Z");
  const completed = await service.continueGuidance({
    answers: [{ questionId: "outdoor-dining", value: "no" }],
    checkpointSha256: "a".repeat(64),
    providerReference: started.providerReference
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.source, "opencounter");
});

test("preserves a known project reference when reconciliation is indeterminate", async () => {
  const driver = {
    async reconcileGuidance({ providerReference }) {
      return {
        providerReference,
        route: "/projects/2818678/apply/questions",
        status: "indeterminate"
      };
    }
  };
  const service = createOpenCounterService({ driver });

  assert.deepEqual(await service.reconcileGuidance({
    providerReference: "opencounter:project:2818678"
  }), {
    failureClass: "indeterminate",
    providerReference: "opencounter:project:2818678",
    providerRoute: "/projects/2818678/apply/questions",
    schemaVersion: 1,
    source: "opencounter",
    status: "indeterminate"
  });
});
