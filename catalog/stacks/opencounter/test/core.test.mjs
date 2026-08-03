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

test("exports one completed project as bounded PDF artifact metadata", async () => {
  const sha256 = "b".repeat(64);
  const driver = {
    async exportGuidance({ providerReference }) {
      assert.equal(providerReference, "opencounter:project:2818724");
      return {
        artifact: {
          artifactRef: `rudi-artifact:opencounter:${sha256}`,
          fileName: `opencounter-project-2818724-${sha256}.pdf`,
          localPath: `/Users/example/.rudi/artifacts/opencounter/opencounter-project-2818724-${sha256}.pdf`,
          mediaType: "application/pdf",
          sha256,
          sizeBytes: 42_000
        },
        providerReference,
        sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2818724/apply/summary",
        status: "exported"
      };
    }
  };
  const service = createOpenCounterService({ driver });

  assert.deepEqual(await service.exportGuidance({
    providerReference: "opencounter:project:2818724"
  }), {
    artifact: {
      artifactRef: `rudi-artifact:opencounter:${sha256}`,
      fileName: `opencounter-project-2818724-${sha256}.pdf`,
      localPath: `/Users/example/.rudi/artifacts/opencounter/opencounter-project-2818724-${sha256}.pdf`,
      mediaType: "application/pdf",
      sha256,
      sizeBytes: 42_000
    },
    providerReference: "opencounter:project:2818724",
    schemaVersion: 1,
    source: "opencounter",
    sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2818724/apply/summary",
    status: "exported"
  });
});

test("resolves one closed Zoning catalog entry before provider dispatch", async () => {
  let dispatches = 0;
  const zoningCatalog = {
    catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
    catalogSha256: "a".repeat(64),
    categories: [{
      categoryId: "commercial_uses",
      displayOrder: 0,
      entries: [{
        catalogEntryId: "commercial_uses.personal_services",
        description: "Personal services including self-service laundries.",
        displayOrder: 0,
        providerLabel: "Personal services",
        providerUseSlug: "personal-services"
      }],
      groups: [],
      label: "Commercial Uses",
      providerCategoryId: 3262,
      providerCategorySlug: "commercial-uses"
    }],
    jurisdiction: "cincinnati-oh",
    provider: {
      tenantId: 71,
      tenantVersion: 307
    },
    schemaVersion: 1,
    workflow: "zoning"
  };
  const driver = {
    async startZoningGuidance(input) {
      dispatches += 1;
      assert.deepEqual(input, {
        address: "3800 Vine Street, Cincinnati, OH",
        catalogEntryId: "commercial_uses.personal_services",
        catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
        catalogSha256: "a".repeat(64),
        categoryPath: ["Commercial Uses"],
        description: "Personal services including self-service laundries.",
        jurisdiction: "cincinnati-oh",
        proposedUse: "Personal services",
        providerUseSlug: "personal-services",
        workflow: "zoning"
      });
      return {
        providerReference: "opencounter:project:2819999",
        questions: [{
          id: "opencounter-address",
          options: [
            { label: "3800 Vine St, Cincinnati, Ohio 45220", value: "3800 Vine St, Cincinnati, Ohio 45220" },
            { label: "3800 Vine St Rear, Cincinnati, Ohio 45220", value: "3800 Vine St Rear, Cincinnati, Ohio 45220" }
          ],
          prompt: "Which OpenCounter address match is the intended location?",
          required: true,
          type: "single_select"
        }],
        status: "needs_requester_input"
      };
    }
  };
  const service = createOpenCounterService({ driver, zoningCatalog });

  assert.equal((await service.getZoningUseCatalog({})).catalogSha256, "a".repeat(64));
  assert.equal((await service.startZoningGuidance({
    address: "3800 Vine Street, Cincinnati, OH",
    catalogEntryId: "commercial_uses.personal_services",
    catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
    jurisdiction: "cincinnati-oh",
    schemaVersion: 1
  })).status, "needs_requester_input");
  await assert.rejects(
    service.startZoningGuidance({
      address: "3800 Vine Street, Cincinnati, OH",
      catalogEntryId: "commercial_uses.retired_use",
      catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
      jurisdiction: "cincinnati-oh",
      schemaVersion: 1
    }),
    /opencounter_use_not_found/
  );
  assert.equal(dispatches, 1);
});
