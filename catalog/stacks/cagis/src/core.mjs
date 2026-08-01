const MAX_RESPONSE_BYTES = 500_000;

export function createCagisClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const origin = parseBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required.");

  return {
    async lookupPropertyActivity(input) {
      const address = boundedText(input?.address, "address", 500);
      if (input?.jurisdiction !== "cincinnati-oh") {
        throw new Error("jurisdiction must be cincinnati-oh.");
      }
      const url = new URL("/api/cagis/parcel", origin);
      url.searchParams.set("address", address);
      url.searchParams.set("include_rules", "true");
      const response = await fetchImpl(url, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
        signal: AbortSignal.timeout(30_000)
      });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error("CAGIS response exceeds the bounded response size.");
      }
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error("CAGIS returned invalid JSON."); }
      if (!response.ok) throw new Error(`CAGIS dependency failed with HTTP ${response.status}.`);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !payload.parcel) {
        throw new Error("CAGIS response is missing its parcel payload.");
      }
      const parcel = payload.parcel;
      const auditorParcelId = optionalText(parcel.auditor_parcel_id ?? parcel.auditorParcelId, 100);
      const parcelKey = optionalText(parcel.parcel_key ?? parcel.parcelKey, 100);
      if (!auditorParcelId && !parcelKey) {
        throw new Error("CAGIS parcel is missing both authoritative parcel identifiers.");
      }
      return {
        address,
        auditorParcelId,
        parcelKey,
        payload,
        retrievedAt: optionalText(payload._retrieved_at, 35) ?? new Date().toISOString(),
        schemaVersion: 1,
        source: "cagis",
        sourceUrl: url.toString()
      };
    }
  };
}

function parseBaseUrl(value) {
  const text = boundedText(value, "baseUrl", 2_000);
  const parsed = new URL(text);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("baseUrl must use HTTP or HTTPS.");
  }
  return parsed;
}

function boundedText(value, field, max) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`${field} is invalid.`);
  }
  return value.trim();
}

function optionalText(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}
