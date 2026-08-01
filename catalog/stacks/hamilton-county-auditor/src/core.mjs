const MAX_RESPONSE_BYTES = 500_000;

export function createAuditorClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const origin = parseBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required.");
  return {
    async lookupParcelFacts(input) {
      if (input?.jurisdiction !== "hamilton-county-oh") {
        throw new Error("jurisdiction must be hamilton-county-oh.");
      }
      const auditorParcelId = optionalText(input?.auditorParcelId, 100);
      const parcelKey = optionalText(input?.parcelKey, 100);
      if ((auditorParcelId ? 1 : 0) + (parcelKey ? 1 : 0) !== 1) {
        throw new Error("Provide exactly one authoritative parcel identifier.");
      }
      const url = new URL("/api/auditor/parcel", origin);
      if (auditorParcelId) url.searchParams.set("auditor_parcel_id", auditorParcelId);
      if (parcelKey) url.searchParams.set("parcel_key", parcelKey);
      const response = await fetchImpl(url, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
        signal: AbortSignal.timeout(30_000)
      });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("Auditor response exceeds the bounded response size.");
      }
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error("Auditor returned invalid JSON."); }
      if (!response.ok) throw new Error(`Auditor dependency failed with HTTP ${response.status}.`);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Auditor response is invalid.");
      }
      return {
        auditorParcelId: optionalText(payload.auditor_parcel_id, 100) ?? auditorParcelId,
        parcelKey: optionalText(payload.parcel_key, 100) ?? parcelKey,
        payload,
        retrievedAt: optionalText(payload._retrieved_at, 35) ?? new Date().toISOString(),
        schemaVersion: 1,
        source: "hamilton_county_auditor",
        sourceUrl: url.toString()
      };
    }
  };
}

function parseBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
    throw new Error("baseUrl is invalid.");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("baseUrl must use HTTP or HTTPS.");
  }
  return parsed;
}

function optionalText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
}
