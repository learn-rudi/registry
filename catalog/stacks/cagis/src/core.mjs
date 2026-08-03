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
      const zoning = parseZoningContext(payload.live_zoning);
      return {
        address,
        auditorParcelId,
        parcelKey,
        payload,
        retrievedAt: optionalText(payload._retrieved_at, 35) ?? new Date().toISOString(),
        schemaVersion: 1,
        source: "cagis",
        sourceUrl: url.toString(),
        ...zoning
      };
    }
  };
}

function parseZoningContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return incompleteZoningContext();
  }
  const zoningCode = optionalText(value.code, 200);
  const zoningFetchedAt = optionalIsoTimestamp(value.fetched_at);
  const zoningSource = optionalText(
    value.source_identity ?? value.source,
    200
  );
  const overlays = Array.isArray(value.overlay_districts)
    ? value.overlay_districts.map((entry) => optionalText(entry, 300))
    : null;
  const zoningOverlayDistrictNames = overlays !== null
    && overlays.every((entry) => entry !== null)
      ? [...new Set(overlays)].sort()
      : null;
  const jurisdictionSlug = optionalText(value.jurisdiction?.slug, 100);
  const zoningContextComplete =
    zoningCode !== null
    && zoningFetchedAt !== null
    && zoningSource !== null
    && zoningOverlayDistrictNames !== null
    && value.outcome === "matched"
    && value.source === "cagis_zoning_service"
    && jurisdictionSlug === "cincinnati";

  return zoningContextComplete
    ? {
        zoningCode,
        zoningContextComplete: true,
        zoningFetchedAt,
        zoningOverlayDistrictNames,
        zoningSource
      }
    : incompleteZoningContext();
}

function incompleteZoningContext() {
  return {
    zoningCode: null,
    zoningContextComplete: false,
    zoningFetchedAt: null,
    zoningOverlayDistrictNames: [],
    zoningSource: null
  };
}

function optionalIsoTimestamp(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) {
    return null;
  }
  try {
    return new Date(value).toISOString() === value ? value : null;
  } catch {
    return null;
  }
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
