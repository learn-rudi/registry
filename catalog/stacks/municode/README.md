# Municode Public Codes

`stack:municode` is a read-only MCP boundary for published municipal-code text
and provenance from reviewed Municode jurisdictions. The package is named for
the provider, not for its first municipality. Cincinnati, Ohio is the first
registered profile; additional jurisdictions require their own reviewed,
versioned profile metadata and contract fixtures.

## Tools

### `municode_get_publication`

Input:

```json
{ "jurisdiction": "cincinnati-oh" }
```

Returns the configured client/product identity, current publication job and
name, retrieval time, and exact public library URL.

### `municode_list_code_sections`

Input:

```json
{
  "jurisdiction": "cincinnati-oh",
  "parentNodeId": "TIXIZOCOCI",
  "limit": 50,
  "cursor": "0"
}
```

Returns at most 100 direct child nodes and an opaque-for-callers decimal cursor
for the next page. The provider response is bounded before parsing.

### `municode_get_code_section`

Input:

```json
{
  "jurisdiction": "cincinnati-oh",
  "nodeId": "TIXIZOCOCI_CH1403SIMIDI"
}
```

Returns bounded normalized text, a SHA-256 content digest, publication
identity, retrieval time, and exact public source URL. HTML-backed code is
normalized directly. PDF-backed code is fetched only from Municode's canonical
code-content blob origin and converted with Poppler's `pdftotext`.

## Boundary And Failure Behavior

- Tool callers cannot provide an origin, product ID, client ID, job ID, or raw
  endpoint.
- Every call is bound to a closed jurisdiction profile and its fixed Municode
  product.
- Requests use exact HTTPS origins, reject redirects, enforce a 30-second
  timeout, and do not retry internally.
- JSON, PDF, collection, node, and rendered-text sizes are bounded.
- Unknown fields, unknown jurisdictions, malformed node IDs, invalid provider
  JSON, missing sections, unsupported content, dependency failures, and PDF
  extraction failures return stable machine-readable MCP error payloads.
- Raw provider bodies and internal exception details are not included in public
  errors.
- The stack reports published source text. It does not determine which zoning
  designation applies to a parcel and does not produce legal conclusions.

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
