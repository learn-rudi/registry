import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exportGuidancePdfFromSummary,
  verifyZoningUseBeforeProjectMutation,
  waitForProviderRouteToSettle
} from "../src/playwright-driver.mjs";

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
      assert.equal(waitRegistered, true);
      clicked = true;
    },
    async count() { return 1; },
    async isEnabled() { return true; },
    async isVisible() { return true; }
  };
  const page = {
    getByRole(role, options) {
      assert.equal(role, "button");
      assert.deepEqual(options, { exact: true, name: "Download PDF" });
      return button;
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

test("fails closed on ambiguous or drifted provider search before project mutation", async () => {
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
            slug: "personal-services-copy"
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
