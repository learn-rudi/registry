# Municode Public Codes

`stack:municode` is a read-only MCP boundary for one release-configured,
fixed-job reviewed baseline Cincinnati zoning-code evidence bundle. Callers do
not browse Municode or select sections. The configured selector policy and
accepted snapshot map complete CAGIS zoning context plus one admitted
restaurant category to a bounded set of provider-native nodes.

## Tools

### `municode_get_reviewed_zoning_evidence_bundle`

Input:

```json
{
  "operationInput": {
    "jurisdiction": "cincinnati-oh",
    "proposedUseCategory": "restaurant_full_service",
    "schemaVersion": 1,
    "selectorPolicyId": "cincinnati-restaurant-zoning-evidence-v1"
  },
  "cagisContext": {
    "auditorParcelId": "014-5000-1002-9",
    "parcelKey": "014500010029",
    "provider": "cagis",
    "resultSha256": "<sha256>",
    "retrievedAt": "2026-08-02T12:30:00.000Z",
    "sourceUrl": "https://example.invalid/synthetic-cagis-result",
    "zoningCode": "SYNTHETIC-ZONE-1",
    "zoningContextComplete": true,
    "zoningFetchedAt": "2026-08-02T12:30:00.000Z",
    "zoningOverlayDistrictNames": ["Synthetic Overlay A"],
    "zoningSource": "synthetic_fixture"
  }
}
```

Returns a closed success/failure union. Success preserves fixed publication,
policy, snapshot, mapping-context, section-content, digest, URL, retrieval-time,
and reason provenance with the required non-legal disclaimer.

## Boundary And Failure Behavior

- Tool callers cannot provide an origin, publication ID, product ID, client ID,
  job ID, node ID, or raw endpoint.
- The public MCP surface exposes the composite only; publication, inventory,
  and section-read primitives remain internal implementation details.
- Each call uses one accepted numeric job ID. It never resolves `latest` for a
  child call, reads each configured parent inventory once, compares the full
  ordered inventory, then reads all selected sections against that same job.
- Requests use exact HTTPS origins, reject redirects, enforce a 30-second
  timeout, and do not retry internally.
- JSON, PDF, collection, node, rendered-text, parent, child, and aggregate
  inventory sizes are bounded.
- Unknown fields, unknown jurisdictions, malformed node IDs, invalid provider
  JSON, missing sections, unsupported content, dependency failures, and PDF
  extraction failures return stable machine-readable MCP error payloads.
- Raw provider bodies and internal exception details are not included in public
  errors.
- Synthetic fixtures prove the engine only and report production readiness
  false. Production requires release-configured live-observed artifacts and a
  named planning-domain attestor.
- The stack reports source evidence. It does not determine legal completeness,
  applicability, approval, permitting, or legal conclusions.

## Relationship To Dwellow And Site Engines

Municode answers “what does the published code say?” A site engine or Dwellow's
normalized `get_zoning_rules` capability may transform reviewed source
snapshots into structured zoning rules. CAGIS or another authoritative mapping
provider determines which zoning designation applies to a property. These
sources must remain distinct in downstream provenance.

## Verification

```bash
npm test
```

The deterministic suite uses injected provider responses and does not call the
live Municode service. A live smoke is read-only and optional during local
verification.
