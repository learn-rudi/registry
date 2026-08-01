import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
