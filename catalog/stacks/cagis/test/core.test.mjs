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
