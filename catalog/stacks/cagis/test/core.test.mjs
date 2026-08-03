import assert from "node:assert/strict";
import { test } from "node:test";
import { createCagisClient } from "../src/core.mjs";

test("returns source-attributed parcel identities", async () => {
  const client = createCagisClient({
    baseUrl: "https://public-data.example.test",
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/cagis\/parcel\?address=/);
      return new Response(JSON.stringify({
        _retrieved_at: "2026-08-01T15:00:00.000Z",
        parcel: { auditor_parcel_id: "014-5000-1002-9", parcel_key: "014500010029" }
      }), { status: 200 });
    }
  });
  const result = await client.lookupPropertyActivity({
    address: "414 Central Avenue, Cincinnati, OH",
    jurisdiction: "cincinnati-oh"
  });
  assert.equal(result.source, "cagis");
  assert.equal(result.parcelKey, "014500010029");
  assert.equal(result.auditorParcelId, "014-5000-1002-9");
});

test("returns complete provider-native Cincinnati zoning context", async () => {
  const client = createCagisClient({
    baseUrl: "https://public-data.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      _retrieved_at: "2026-08-02T14:00:00.000Z",
      live_zoning: {
        code: "SYNTHETIC-ZONE-1",
        fetched_at: "2026-08-02T13:59:00.000Z",
        jurisdiction: {
          name: "Cincinnati",
          slug: "cincinnati",
          zoning_type: "City of Cincinnati"
        },
        outcome: "matched",
        overlay_districts: ["Synthetic Overlay B", "Synthetic Overlay A"],
        source: "cagis_zoning_service",
        source_identity: "synthetic_fixture"
      },
      parcel: {
        auditor_parcel_id: "014-5000-1002-9",
        parcel_key: "014500010029"
      }
    }), { status: 200 })
  });

  const result = await client.lookupPropertyActivity({
    address: "414 Central Avenue, Cincinnati, OH",
    jurisdiction: "cincinnati-oh"
  });

  assert.deepEqual({
    zoningCode: result.zoningCode,
    zoningContextComplete: result.zoningContextComplete,
    zoningFetchedAt: result.zoningFetchedAt,
    zoningOverlayDistrictNames: result.zoningOverlayDistrictNames,
    zoningSource: result.zoningSource
  }, {
    zoningCode: "SYNTHETIC-ZONE-1",
    zoningContextComplete: true,
    zoningFetchedAt: "2026-08-02T13:59:00.000Z",
    zoningOverlayDistrictNames: ["Synthetic Overlay A", "Synthetic Overlay B"],
    zoningSource: "synthetic_fixture"
  });
});
