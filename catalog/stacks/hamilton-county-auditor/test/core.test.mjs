import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuditorClient } from "../src/core.mjs";

test("returns source-attributed Auditor facts", async () => {
  const client = createAuditorClient({
    baseUrl: "https://public-data.example.test",
    fetchImpl: async (url) => {
      assert.match(String(url), /auditor_parcel_id=014-5000-1002-9/);
      return new Response(JSON.stringify({
        _retrieved_at: "2026-08-01T15:00:00.000Z",
        auditor_parcel_id: "014-5000-1002-9",
        parcel_key: "014500010029",
        summary: { owner_name: "EXAMPLE OWNER" }
      }), { status: 200 });
    }
  });
  const result = await client.lookupParcelFacts({
    auditorParcelId: "014-5000-1002-9",
    jurisdiction: "hamilton-county-oh"
  });
  assert.equal(result.source, "hamilton_county_auditor");
  assert.equal(result.parcelKey, "014500010029");
});
