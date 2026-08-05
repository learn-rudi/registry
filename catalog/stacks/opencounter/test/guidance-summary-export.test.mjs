import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import {
  exportGuidancePdfFromSummary,
  parseSummaryHeadings,
  providerUseLabelMatches,
  providerUseRadioSelector,
  runResumableReconciliation,
  verifyZoningUseBeforeProjectMutation,
  waitForProviderRouteToSettle
} from "../src/playwright-driver.mjs";

test("reads the value after the Zoning District heading", () => {
  assert.deepEqual(parseSummaryHeadings([
    "Your project is Permitted with Limitations at this location.",
    "Location",
    "Zoning Details",
    "Zoning Clearance",
    "Permitted with Limitations",
    "Zoning District",
    "Residential Mixed (1-3 family units) (RMX)",
    "Land Use Code",
    "Multi-family dwelling",
    "Overlay Districts",
    "Avondale"
  ], "880 Ridgeway Avenue, Cincinnati, Ohio 45229"), {
    address: "880 Ridgeway Avenue, Cincinnati, Ohio 45229",
    classification: "Permitted with Limitations",
    disclaimer: "Information is subject to final approval by City staff.",
    evaluationScope: "selected_opencounter_land_use",
    landUseCode: "Multi-family dwelling",
    parcelId: null,
    summaryHeadings: [
      "Your project is Permitted with Limitations at this location.",
      "Location",
      "Zoning Details",
      "Zoning Clearance",
      "Permitted with Limitations",
      "Zoning District",
      "Residential Mixed (1-3 family units) (RMX)",
      "Land Use Code",
      "Multi-family dwelling",
      "Overlay Districts",
      "Avondale"
    ],
    zoningDistrict: "Residential Mixed (1-3 family units) (RMX)"
  });
});

test("normalizes the provider's prohibited summary heading", () => {
  assert.equal(parseSummaryHeadings([
    "Unfortunately, your project is Prohibited at this location."
  ], "4818 Stewart Avenue, Cincinnati, Ohio 45227").classification, "Prohibited");
});

test("targets the current exact provider use radio and descriptive label", () => {
  assert.equal(
    providerUseRadioSelector("multi-family-dwelling"),
    'input[type="radio"][value="multi-family-dwelling"]'
  );
  assert.equal(providerUseLabelMatches(
    "Multi-family dwellingA building or group of buildings that contain four or more dwelling units....Read more",
    "Multi-family dwelling"
  ), true);
  assert.equal(providerUseLabelMatches(
    "Two-family dwellingA single building that contains two dwelling units....Read more",
    "Multi-family dwelling"
  ), false);
});

test("persists the active checkpoint returned by same-project reconciliation", async () => {
  const saves = [];
  const providerReference = "opencounter:project:2819756";
  const questions = [{
    id: "opencounter-address",
    options: [{
      label: "880 Ridgeway Avenue, Cincinnati, Ohio 45229",
      value: "880 Ridgeway Avenue, Cincinnati, Ohio 45229"
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const page = {
    url() {
      return "https://opencounter.cincinnati-oh.gov/projects/2819756/guide/location";
    }
  };
  const result = await runResumableReconciliation({
    action: async (_page, _input, controls) => {
      await controls.onProjectVerified();
      return { providerReference, questions, status: "needs_requester_input" };
    },
    bindingSha256: "d".repeat(64),
    context: {
      async storageState() { return { cookies: [] }; }
    },
    input: {
      address: "880 Ridgeway Avenue, Cincinnati, OH 45229",
      providerReference
    },
    needsBindingMigration: false,
    now: () => new Date("2026-08-03T15:00:00.000Z"),
    page,
    stateStore: {
      async save(reference, storageState, expiresAt, bindingSha256, guidanceState) {
        saves.push({
          bindingSha256,
          expiresAt,
          guidanceState,
          reference,
          storageState
        });
      }
    }
  });

  assert.equal(result.status, "needs_requester_input");
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].guidanceState, {
    activeCheckpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(
        providerReference,
        questions
      ),
      questions
    },
    requestedAddress: "880 ridgeway avenue cincinnati oh 45229"
  });
});

test("waits through a delayed client-side redirect to the summary route", async () => {
  const urls = [
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/summary"
  ];
  let index = 0;
  const page = {
    async waitForTimeout() {
      index += 1;
    },
    url() {
      return `https://opencounter.cincinnati-oh.gov${urls[Math.min(index, urls.length - 1)]}`;
    }
  };

  assert.equal(
    await waitForProviderRouteToSettle(page),
    "https://opencounter.cincinnati-oh.gov/projects/2818705/apply/summary"
  );
});

test("registers the PDF download wait before clicking the unique provider control", async () => {
  let modalDismissed = false;
  let waitRegistered = false;
  let clicked = false;
  const artifact = {
    artifactRef: `rudi-artifact:opencounter:${"c".repeat(64)}`,
    fileName: `opencounter-project-2818724-${"c".repeat(64)}.pdf`,
    localPath: `/tmp/opencounter-project-2818724-${"c".repeat(64)}.pdf`,
    mediaType: "application/pdf",
    sha256: "c".repeat(64),
    sizeBytes: 1_024
  };
  const download = {
    async failure() { return null; },
    async path() { return "/tmp/provider-download.pdf"; }
  };
  const button = {
    async click() {
      assert.equal(modalDismissed, true);
      assert.equal(waitRegistered, true);
      clicked = true;
    },
    async count() { return 1; },
    async getAttribute(name) {
      assert.equal(name, "data-download-pdf-button");
      return "true";
    },
    async isEnabled() { return true; },
    async isVisible() { return true; }
  };
  const skip = {
    async click() { modalDismissed = true; },
    async count() { return modalDismissed ? 0 : 1; },
    async isVisible() { return !modalDismissed; },
    async waitFor(options) {
      assert.deepEqual(options, { state: "hidden", timeout: 15_000 });
      assert.equal(modalDismissed, true);
    }
  };
  const page = {
    getByRole(role, options) {
      assert.equal(role, "button");
      if (options.name === "Skip for now") {
        assert.deepEqual(options, { exact: true, name: "Skip for now" });
        return skip;
      }
      if (options.name === "Download PDF") {
        assert.deepEqual(options, { exact: true, name: "Download PDF" });
        return button;
      }
      throw new Error(`unexpected button: ${options.name}`);
    },
    async goto(url) {
      assert.equal(url, "https://opencounter.cincinnati-oh.gov/projects/2818724/apply/summary");
      return { status: () => 200 };
    },
    waitForEvent(name) {
      assert.equal(name, "download");
      waitRegistered = true;
      return Promise.resolve(download);
    }
  };
  const artifactStore = {
    async persistPdf(input) {
      assert.deepEqual(input, {
        downloadPath: "/tmp/provider-download.pdf",
        providerReference: "opencounter:project:2818724"
      });
      return artifact;
    }
  };

  assert.deepEqual(await exportGuidancePdfFromSummary(page, artifactStore, {
    providerReference: "opencounter:project:2818724"
  }), {
    artifact,
    providerReference: "opencounter:project:2818724",
    sourceUrl: "https://opencounter.cincinnati-oh.gov/projects/2818724/apply/summary",
    status: "exported"
  });
  assert.equal(clicked, true);
});

test("proves one exact provider use fingerprint through a read-only request", async () => {
  let requested = false;
  const page = {
    request: {
      async get(url, options) {
        requested = true;
        assert.equal(url, "https://opencounter.cincinnati-oh.gov/api/zoning/uses");
        assert.deepEqual(options.params, {
          "filter[query_string]": "Personal services"
        });
        assert.deepEqual(options.headers, { accept: "application/json" });
        assert.equal(options.timeout, 15_000);
        return providerSearchResponse([
          providerUse({
            categoryId: 3262,
            categoryIds: [3262],
            categoryName: "Commercial Uses",
            description: "Personal services including self-service laundries.",
            fullName: "Commercial Uses > Personal services",
            id: 42372,
            name: "Personal services",
            slug: "personal-services"
          })
        ]);
      }
    }
  };

  await verifyZoningUseBeforeProjectMutation(page, {
    categoryPath: ["Commercial Uses"],
    description: "Personal services including self-service laundries.",
    proposedUse: "Personal services",
    providerUseSlug: "personal-services"
  });
  assert.equal(requested, true);
});

test("retries a truncated label search with the full catalog path", async () => {
  const queries = [];
  const page = {
    request: {
      async get(url, options) {
        assert.equal(url, "https://opencounter.cincinnati-oh.gov/api/zoning/uses");
        queries.push(options.params["filter[query_string]"]);
        if (queries.length === 1) {
          return providerSearchResponse([
            providerUse({
              categoryId: 3260,
              categoryIds: [3260],
              categoryName: "Accessory Uses",
              description: null,
              fullName: "Accessory Uses > Retail and repair",
              id: 42325,
              name: "Retail and repair",
              slug: "retail-and-repair"
            })
          ]);
        }
        return providerSearchResponse([
          providerUse({
            categoryId: 3261,
            categoryIds: [3261],
            categoryName: "Agriculture and Extractive Uses",
            description: "A use subordinate to the principal use.",
            fullName: "Agriculture and Extractive Uses > Accessory Uses",
            id: 42330,
            name: "Accessory Uses",
            slug: "accessory-uses"
          })
        ]);
      }
    }
  };

  const verifiedUse = await verifyZoningUseBeforeProjectMutation(page, {
    categoryPath: ["Agriculture and Extractive Uses"],
    description: "A use subordinate to the principal use.",
    proposedUse: "Accessory Uses",
    providerUseSlug: "accessory-uses"
  });
  assert.deepEqual(queries, [
    "Accessory Uses",
    "Agriculture and Extractive Uses Accessory Uses"
  ]);
  assert.deepEqual(verifiedUse, {
    providerSearchQuery: "Agriculture and Extractive Uses Accessory Uses"
  });
});

test("uses the catalog slug to disambiguate duplicate provider labels before mutation", async () => {
  const exact = providerUse({
    categoryId: 3262,
    categoryIds: [3262],
    categoryName: "Commercial Uses",
    description: "Changed provider description.",
    fullName: "Commercial Uses > Personal services",
    id: 42372,
    name: "Personal services",
    slug: "personal-services"
  });
  const page = {
    request: {
      async get() { return providerSearchResponse([exact]); }
    }
  };
  await assert.rejects(
    verifyZoningUseBeforeProjectMutation(page, {
      categoryPath: ["Commercial Uses"],
      description: "Personal services including self-service laundries.",
      proposedUse: "Personal services",
      providerUseSlug: "personal-services"
    }),
    /provider_ui_changed/
  );

  const duplicateLabelPage = {
    request: {
      async get() {
        return providerSearchResponse([
          exact,
          providerUse({
            categoryId: 3262,
            categoryIds: [3262],
            categoryName: "Commercial Uses",
            description: "Changed provider description.",
            fullName: "Commercial Uses > Personal services",
            id: 49999,
            name: "Personal services",
            slug: "personal-services-copy"
          })
        ]);
      }
    }
  };
  await verifyZoningUseBeforeProjectMutation(duplicateLabelPage, {
    categoryPath: ["Commercial Uses"],
    description: "Changed provider description.",
    proposedUse: "Personal services",
    providerUseSlug: "personal-services"
  });

  const ambiguousPage = {
    request: {
      async get() {
        return providerSearchResponse([
          exact,
          providerUse({
            categoryId: 3262,
            categoryIds: [3262],
            categoryName: "Commercial Uses",
            description: "Changed provider description.",
            fullName: "Commercial Uses > Personal services",
            id: 49999,
            name: "Personal services",
            slug: "personal-services"
          })
        ]);
      }
    }
  };
  await assert.rejects(
    verifyZoningUseBeforeProjectMutation(ambiguousPage, {
      categoryPath: ["Commercial Uses"],
      description: "Changed provider description.",
      proposedUse: "Personal services",
      providerUseSlug: "personal-services"
    }),
    /opencounter_use_ambiguous/
  );
});

function providerUse({
  categoryId,
  categoryIds,
  categoryName,
  description,
  fullName,
  id,
  name,
  slug
}) {
  return {
    attributes: {
      category_id: categoryId,
      category_ids: categoryIds,
      category_name: categoryName,
      description,
      featured: false,
      full_name: fullName,
      name,
      reference_url: null,
      slug
    },
    id
  };
}

function providerSearchResponse(data) {
  return {
    async body() { return Buffer.from(JSON.stringify({ data }), "utf8"); },
    headers() { return { "content-type": "application/json; charset=utf-8" }; },
    ok() { return true; },
    status() { return 200; }
  };
}
