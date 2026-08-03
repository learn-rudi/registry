import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createGuidanceCheckpointSha256,
  createOpenCounterService,
  createOpenCounterToolResponse
} from "../src/core.mjs";

test("returns the same bounded checkpoint through MCP text and structured content", () => {
  const result = {
    checkpoint: {
      checkpointSha256: "a".repeat(64),
      expiresAt: "2026-08-04T15:00:00.000Z",
      questions: [{
        id: "opencounter-address",
        options: [{
          label: "4818 Stewart Avenue, Cincinnati, Ohio 45227",
          value: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
        }],
        prompt: "Which OpenCounter address match is the intended location?",
        required: true,
        type: "single_select"
      }],
      schemaVersion: 1
    },
    providerReference: "opencounter:project:2819848",
    schemaVersion: 1,
    source: "opencounter",
    status: "needs_requester_input"
  };

  assert.deepEqual(createOpenCounterToolResponse(result), {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result
  });
});

test("returns a bounded requester checkpoint and resumes to a sourced result", async () => {
  const providerReference = "opencounter:project:2818607";
  const pdfSha256 = "f".repeat(64);
  const providerPdfArtifact = {
    artifactRef: `rudi-artifact:opencounter:${pdfSha256}`,
    fileName: `opencounter-project-2818607-${pdfSha256}.pdf`,
    localPath: `/tmp/opencounter-project-2818607-${pdfSha256}.pdf`,
    mediaType: "application/pdf",
    sha256: pdfSha256,
    sizeBytes: 42_000
  };
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
        providerPdf: {
          artifact: providerPdfArtifact,
          providerReference,
          sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2818607/apply/summary",
          status: "exported"
        },
        providerReference,
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
  assert.equal(
    started.checkpoint.checkpointSha256,
    createGuidanceCheckpointSha256(
      "opencounter:project:2818607",
      started.checkpoint.questions
    )
  );
  const completed = await service.continueGuidance({
    answers: [{ questionId: "outdoor-dining", value: "no" }],
    checkpointSha256: started.checkpoint.checkpointSha256,
    providerReference: started.providerReference
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.source, "opencounter");
  assert.deepEqual(completed.providerPdf, {
    artifact: providerPdfArtifact,
    sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2818607/apply/summary",
    status: "exported"
  });
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

test("contains invalid post-reconciliation output as indeterminate", async () => {
  const zoningCatalog = {
    catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
    catalogSha256: "a".repeat(64),
    categories: [{
      categoryId: "residential_uses",
      displayOrder: 0,
      entries: [{
        catalogEntryId: "residential_uses.multi_family_dwelling",
        description: "Four or more dwelling units.",
        displayOrder: 0,
        providerLabel: "Multi-family dwelling",
        providerUseSlug: "multi-family-dwelling"
      }],
      groups: [],
      label: "Residential Uses",
      providerCategoryId: 1,
      providerCategorySlug: "residential-uses"
    }],
    jurisdiction: "cincinnati-oh",
    provider: { tenantId: 71, tenantVersion: 307 },
    schemaVersion: 1,
    workflow: "zoning"
  };
  const normalized = {
    address: "880 Ridgeway Avenue, Cincinnati, OH 45229",
    catalogEntryId: "residential_uses.multi_family_dwelling",
    catalogId: zoningCatalog.catalogId,
    catalogSha256: zoningCatalog.catalogSha256,
    categoryPath: ["Residential Uses"],
    description: "Four or more dwelling units.",
    jurisdiction: "cincinnati-oh",
    proposedUse: "Multi-family dwelling",
    providerUseSlug: "multi-family-dwelling",
    workflow: "zoning"
  };
  const providerInputSha256 = createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(
      Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))
    )))
    .digest("hex");
  const service = createOpenCounterService({
    driver: {
      async reconcileZoningStart({ providerReference }) {
        return {
          providerReference,
          questions: [{
            id: "provider-question",
            options: [{ label: "Only", value: "only" }],
            prompt: "Malformed provider question",
            required: true,
            type: "single_select"
          }],
          status: "needs_requester_input"
        };
      }
    },
    zoningCatalog
  });

  assert.deepEqual(await service.reconcileZoningStart({
    address: normalized.address,
    catalogEntryId: normalized.catalogEntryId,
    catalogId: normalized.catalogId,
    jurisdiction: "cincinnati-oh",
    providerInputSha256,
    providerReference: "opencounter:project:2819756",
    schemaVersion: 1
  }), {
    failureClass: "indeterminate",
    providerReference: "opencounter:project:2819756",
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

test("reconciles only the same project with the exact digest-bound Zoning input", async () => {
  const zoningCatalog = {
    catalogId: "cincinnati-opencounter-zoning-use-catalog-v1",
    catalogSha256: "a".repeat(64),
    categories: [{
      categoryId: "residential_uses",
      displayOrder: 0,
      entries: [],
      groups: [{
        entries: [{
          catalogEntryId: "residential_uses.permanent_residential.multi_family_dwelling",
          description: "A building or group of buildings that contain four or more dwelling units.",
          displayOrder: 0,
          providerLabel: "Multi-family dwelling",
          providerUseSlug: "multi-family-dwelling"
        }],
        label: "Permanent Residential"
      }],
      label: "Residential Uses",
      providerCategoryId: 1,
      providerCategorySlug: "residential-uses"
    }],
    jurisdiction: "cincinnati-oh",
    provider: { tenantId: 71, tenantVersion: 307 },
    schemaVersion: 1,
    workflow: "zoning"
  };
  const normalized = {
    address: "880 Ridgeway Avenue, Cincinnati, OH 45229",
    catalogEntryId: "residential_uses.permanent_residential.multi_family_dwelling",
    catalogId: zoningCatalog.catalogId,
    catalogSha256: zoningCatalog.catalogSha256,
    categoryPath: ["Residential Uses", "Permanent Residential"],
    description: "A building or group of buildings that contain four or more dwelling units.",
    jurisdiction: "cincinnati-oh",
    proposedUse: "Multi-family dwelling",
    providerUseSlug: "multi-family-dwelling",
    workflow: "zoning"
  };
  const providerInputSha256 = createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(
      Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))
    )))
    .digest("hex");
  const driver = {
    async reconcileZoningStart(input) {
      assert.deepEqual(input, {
        ...normalized,
        providerInputSha256,
        providerReference: "opencounter:project:2819756"
      });
      return {
        providerReference: input.providerReference,
        questions: [{
          id: "opencounter-address",
          options: [
            { label: "880 Ridgeway Avenue, Cincinnati, Ohio 45229", value: "880 Ridgeway Avenue, Cincinnati, Ohio 45229" }
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
  const input = {
    address: normalized.address,
    catalogEntryId: normalized.catalogEntryId,
    catalogId: normalized.catalogId,
    jurisdiction: "cincinnati-oh",
    providerInputSha256,
    providerReference: "opencounter:project:2819756",
    schemaVersion: 1
  };

  assert.equal((await service.reconcileZoningStart(input)).status, "needs_requester_input");
  await assert.rejects(
    service.reconcileZoningStart({ ...input, providerInputSha256: "b".repeat(64) }),
    /opencounter_provider_input_digest_mismatch/
  );
});
