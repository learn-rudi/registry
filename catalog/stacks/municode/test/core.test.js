import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createMunicodeClient } from "../src/core.js";

test("resolves the latest publication for a reviewed jurisdiction profile", async () => {
  let calls = 0;
  const client = createMunicodeClient({
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(
        String(url),
        "https://library.municode.com/api/Jobs/product/19996"
      );
      assert.equal(new Headers(options.headers).get("X-CSRF"), "1");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify([
        { Id: 492500, IsLatest: false, Name: "Supplement 48" },
        { Id: 492574, IsLatest: true, Name: "Supplement 48 Update 1" }
      ]), { status: 200 });
    },
    now: () => new Date("2026-08-01T18:00:00.000Z")
  });

  const result = await client.getPublication({ jurisdiction: "cincinnati-oh" });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    jurisdiction: "cincinnati-oh",
    publication: {
      clientId: 1650,
      isLatest: true,
      jobId: 492574,
      name: "Supplement 48 Update 1",
      productId: 19996
    },
    retrievedAt: "2026-08-01T18:00:00.000Z",
    schemaVersion: 1,
    source: "municode",
    sourceUrl: "https://library.municode.com/oh/cincinnati/codes/code_of_ordinances",
    status: "succeeded"
  });
});

test("lists one bounded page of child code sections", async () => {
  const requestedUrls = [];
  const client = createMunicodeClient({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/Jobs/product/19996")) {
        return new Response(JSON.stringify([
          { Id: 492574, IsLatest: true, Name: "Supplement 48 Update 1" }
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([
        { Id: "TIXIZOCOCI_CH1401", Heading: "Chapter 1401", HasChildren: true },
        { Id: "TIXIZOCOCI_CH1403", Heading: "Chapter 1403", HasChildren: true }
      ]), { status: 200 });
    },
    now: () => new Date("2026-08-01T18:05:00.000Z")
  });

  const result = await client.listCodeSections({
    jurisdiction: "cincinnati-oh",
    limit: 1,
    parentNodeId: "TIXIZOCOCI"
  });

  assert.deepEqual(requestedUrls, [
    "https://library.municode.com/api/Jobs/product/19996",
    "https://library.municode.com/api/codesToc/children?productId=19996&jobId=492574&nodeId=TIXIZOCOCI"
  ]);
  assert.deepEqual(result.sections, [{
    hasChildren: true,
    nodeId: "TIXIZOCOCI_CH1401",
    sourceUrl: "https://library.municode.com/oh/cincinnati/codes/code_of_ordinances?nodeId=TIXIZOCOCI_CH1401",
    title: "Chapter 1401"
  }]);
  assert.deepEqual(result.page, {
    cursor: null,
    limit: 1,
    nextCursor: "1"
  });
  assert.equal(result.parentNodeId, "TIXIZOCOCI");
  assert.equal(result.publication.jobId, 492574);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.source, "municode");
  assert.equal(result.status, "succeeded");
});

test("returns normalized text and provenance for an HTML-backed code section", async () => {
  const client = createMunicodeClient({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/Jobs/product/19996")) {
        return new Response(JSON.stringify([
          { Id: 492574, IsLatest: true, Name: "Supplement 48 Update 1" }
        ]), { status: 200 });
      }
      assert.equal(
        String(url),
        "https://library.municode.com/api/CodesContent?productId=19996&jobId=492574&nodeId=TIXIZOCOCI_CH1403_S1403-07"
      );
      return new Response(JSON.stringify({
        Docs: [{
          ChunkGroupStartingNodeId: "TIXIZOCOCI_CH1403",
          Content: "<p>Minimum width: 6&frac12; ft.</p><p>Maximum height: 35 ft.</p>",
          DocType: 1,
          Id: "TIXIZOCOCI_CH1403_S1403-07",
          Title: "Sec. 1403-07"
        }]
      }), { status: 200 });
    },
    now: () => new Date("2026-08-01T18:10:00.000Z")
  });

  const result = await client.getCodeSection({
    jurisdiction: "cincinnati-oh",
    nodeId: "TIXIZOCOCI_CH1403_S1403-07"
  });
  const expectedText = "Minimum width: 6½ ft.\nMaximum height: 35 ft.";

  assert.deepEqual(result.section, {
    contentFormat: "text",
    contentSha256: createHash("sha256").update(expectedText).digest("hex"),
    nodeId: "TIXIZOCOCI_CH1403_S1403-07",
    text: expectedText,
    title: "Sec. 1403-07"
  });
  assert.equal(
    result.sourceUrl,
    "https://library.municode.com/oh/cincinnati/codes/code_of_ordinances?nodeId=TIXIZOCOCI_CH1403_S1403-07"
  );
  assert.equal(result.publication.jobId, 492574);
});

test("extracts PDF-backed code text only from the canonical Municode blob origin", async () => {
  const requestedUrls = [];
  const client = createMunicodeClient({
    extractPdfText: async (bytes, context) => {
      assert.deepEqual([...bytes], [37, 80, 68, 70]);
      assert.equal(
        context.documentUrl,
        "https://mcclibrary.blob.core.usgovcloudapi.net/codecontent/19996/492574/Section%201703-2%20Specific%20to%20Transect%20Zones.pdf"
      );
      return "Transect standards\nMaximum height: 4 stories";
    },
    fetchImpl: async (url, options) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/Jobs/product/19996")) {
        return new Response(JSON.stringify([
          { Id: 492574, IsLatest: true, Name: "Supplement 48 Update 1" }
        ]), { status: 200 });
      }
      if (String(url).includes("/api/CodesContent?")) {
        return new Response(JSON.stringify({
          Docs: [{
            ChunkGroupStartingNodeId: "Section 1703-2 Specific to Transect Zones",
            Content: null,
            DocType: 2,
            Id: "Section 1703-2 Specific to Transect Zones",
            Title: "Section 1703-2 Specific to Transect Zones"
          }]
        }), { status: 200 });
      }
      assert.equal(new Headers(options.headers).get("Accept"), "application/pdf");
      assert.equal(options.redirect, "error");
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { "content-type": "application/pdf" },
        status: 200
      });
    },
    now: () => new Date("2026-08-01T18:15:00.000Z")
  });

  const result = await client.getCodeSection({
    jurisdiction: "cincinnati-oh",
    nodeId: "Section 1703-2 Specific to Transect Zones"
  });

  assert.equal(requestedUrls.length, 3);
  assert.equal(result.section.contentFormat, "pdf_text");
  assert.equal(result.section.text, "Transect standards\nMaximum height: 4 stories");
  assert.equal(
    result.section.documentUrl,
    "https://mcclibrary.blob.core.usgovcloudapi.net/codecontent/19996/492574/Section%201703-2%20Specific%20to%20Transect%20Zones.pdf"
  );
});

test("classifies missing jurisdiction as invalid tool input before network access", async () => {
  let calls = 0;
  const client = createMunicodeClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network must not be called");
    }
  });

  await assert.rejects(
    client.getPublication({}),
    (error) => error?.code === "invalid_input"
  );
  assert.equal(calls, 0);
});

test("rejects unreviewed jurisdictions before network access", async () => {
  let calls = 0;
  const client = createMunicodeClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network must not be called");
    }
  });

  await assert.rejects(
    client.getPublication({ jurisdiction: "louisville-ky" }),
    (error) => error?.code === "unsupported_jurisdiction"
  );
  assert.equal(calls, 0);
});

test("rejects malformed node identifiers before network access", async () => {
  let calls = 0;
  const client = createMunicodeClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network must not be called");
    }
  });

  await assert.rejects(
    client.getCodeSection({
      jurisdiction: "cincinnati-oh",
      nodeId: "../../other-origin"
    }),
    (error) => error?.code === "invalid_input"
  );
  assert.equal(calls, 0);
});

test("builds one reviewed zoning evidence bundle against the accepted fixed job", async () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../manifest.json", import.meta.url),
    "utf8"
  ));
  const publicServerSource = readFileSync(
    new URL("../src/index.js", import.meta.url),
    "utf8"
  );
  assert.deepEqual(manifest.provides.tools, [
    "municode_get_reviewed_zoning_evidence_bundle"
  ]);
  assert.doesNotMatch(publicServerSource, /name: "municode_(?:get_publication|list_code_sections|get_code_section)"/);
  const selectorPolicy = {
    schemaVersion: 1,
    sectionReasons: [
      { nodeId: "NODE DEFINITION", reasonCode: "use_definition" },
      { nodeId: "NODE USE TABLE", reasonCode: "base_district_use_table" },
      { nodeId: "NODE CONDITIONS", reasonCode: "use_specific_condition" },
      { nodeId: "NODE PARKING", reasonCode: "parking_and_loading" }
    ],
    selectorPolicyId: "cincinnati-restaurant-zoning-evidence-v1"
  };
  const selectorPolicySha256 = createHash("sha256")
    .update(JSON.stringify(selectorPolicy))
    .digest("hex");
  const snapshot = {
    schemaVersion: 1,
    snapshotId: "synthetic-cincinnati-zoning-v1",
    jurisdiction: "cincinnati-oh",
    clientId: 1650,
    productId: 19996,
    jobId: 700001,
    publicationName: "Synthetic Cincinnati Publication",
    isLatest: false,
    observedAt: "2026-08-02T12:00:00.000Z",
    selectorPolicyId: "cincinnati-restaurant-zoning-evidence-v1",
    selectorPolicySha256,
    attestation: {
      kind: "synthetic_fixture",
      attestorRef: "synthetic-fixture-only"
    },
    parents: [{
      nodeId: "PARENT ZONING",
      title: "Synthetic Zoning Parent",
      children: [
        { nodeId: "NODE DEFINITION", title: "Synthetic Definition" },
        { nodeId: "NODE USE TABLE", title: "Synthetic Use Table" },
        { nodeId: "NODE CONDITIONS", title: "Synthetic Conditions" },
        { nodeId: "NODE PARKING", title: "Synthetic Parking" }
      ]
    }],
    selections: [{
      zoningCode: "SYNTHETIC-ZONE-1",
      zoningOverlayDistrictNames: ["Synthetic Overlay A"],
      proposedUseCategory: "restaurant_full_service",
      sectionNodeIds: [
        "NODE DEFINITION",
        "NODE USE TABLE",
        "NODE CONDITIONS",
        "NODE PARKING"
      ]
    }]
  };
  const snapshotSha256 = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const requestedUrls = [];
  const client = createMunicodeClient({
    fetchImpl: async (url) => {
      const requestedUrl = String(url);
      requestedUrls.push(requestedUrl);
      assert.doesNotMatch(requestedUrl, /\/Jobs\/product\//);
      if (requestedUrl.includes("/api/codesToc/children?")) {
        return new Response(JSON.stringify(snapshot.parents[0].children.map(
          ({ nodeId, title }) => ({
            HasChildren: false,
            Heading: title,
            Id: nodeId
          })
        )), { status: 200 });
      }
      const nodeId = new URL(requestedUrl).searchParams.get("nodeId");
      const child = snapshot.parents[0].children.find(
        (candidate) => candidate.nodeId === nodeId
      );
      assert.ok(child);
      return new Response(JSON.stringify({
        Docs: [{
          ChunkGroupStartingNodeId: child.nodeId,
          Content: `<p>${child.title} evidence.</p>`,
          DocType: 1,
          Id: child.nodeId,
          Title: child.title
        }]
      }), { status: 200 });
    },
    now: () => new Date("2026-08-02T13:00:00.000Z"),
    reviewedZoningEvidenceRelease: {
      selectorPolicy,
      snapshot,
      snapshotSha256
    }
  });

  const readiness = client.getReviewedZoningEvidenceReadiness();
  assert.deepEqual(readiness, {
    productionReady: false,
    reason: "planning_domain_attestation_required",
    selectorPolicyId: snapshot.selectorPolicyId,
    selectorPolicySha256,
    snapshotId: snapshot.snapshotId,
    snapshotSha256
  });

  const result = await client.getReviewedZoningEvidenceBundle({
    operationInput: {
      jurisdiction: "cincinnati-oh",
      proposedUseCategory: "restaurant_full_service",
      schemaVersion: 1,
      selectorPolicyId: "cincinnati-restaurant-zoning-evidence-v1"
    },
    cagisContext: {
      auditorParcelId: "014-5000-1002-9",
      parcelKey: "014500010029",
      provider: "cagis",
      resultSha256: "a".repeat(64),
      retrievedAt: "2026-08-02T12:30:00.000Z",
      sourceUrl: "https://example.invalid/synthetic-cagis-result",
      zoningCode: "SYNTHETIC-ZONE-1",
      zoningContextComplete: true,
      zoningFetchedAt: "2026-08-02T12:30:00.000Z",
      zoningOverlayDistrictNames: ["Synthetic Overlay A"],
      zoningSource: "synthetic_fixture"
    }
  });

  assert.equal(requestedUrls.length, 5);
  assert.equal(
    requestedUrls.filter((url) => url.includes("/codesToc/children?")).length,
    1
  );
  for (const requestedUrl of requestedUrls) {
    assert.match(requestedUrl, /productId=19996/);
    assert.match(requestedUrl, /jobId=700001/);
  }
  assert.deepEqual(result.selection, {
    selectorPolicyId: snapshot.selectorPolicyId,
    selectorPolicySha256,
    snapshotId: snapshot.snapshotId,
    snapshotSha256
  });
  assert.deepEqual(
    result.sections.map(({ nodeId, reasonCode, title }) => ({
      nodeId,
      reasonCode,
      title
    })),
    [
      {
        nodeId: "NODE DEFINITION",
        reasonCode: "use_definition",
        title: "Synthetic Definition"
      },
      {
        nodeId: "NODE USE TABLE",
        reasonCode: "base_district_use_table",
        title: "Synthetic Use Table"
      },
      {
        nodeId: "NODE CONDITIONS",
        reasonCode: "use_specific_condition",
        title: "Synthetic Conditions"
      },
      {
        nodeId: "NODE PARKING",
        reasonCode: "parking_and_loading",
        title: "Synthetic Parking"
      }
    ]
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.mappingContext.zoningCode, "SYNTHETIC-ZONE-1");
  assert.equal(result.publication.jobId, 700001);
  assert.equal(
    result.disclaimer,
    "This reviewed baseline zoning-code evidence bundle is source evidence only. It is not legal advice and does not determine legal completeness, applicability, approval, or permitting."
  );
});
