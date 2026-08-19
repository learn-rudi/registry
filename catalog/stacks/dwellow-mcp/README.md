# Dwellow MCP RUDI Stack

This stack is a transport bridge to the hosted Dwellow / Co-Llab MCP service.
It contains no site-analysis business logic. `src/index.js` launches the pinned
`mcp-remote` package and forwards stdio MCP traffic to the configured hosted MCP
URL.

## Contract Authority

- The hosted server's `tools/list` response is runtime truth.
- `manifest.json` is the exact contract RUDI may advertise.
- `test/contract.test.mjs` pins the complete advertised name set and the bridge
  package/endpoint contract for offline verification.
- `test/live-contract.test.mjs` is an opt-in read-only comparison between the
  hosted `tools/list` result and `manifest.json`.

Do not add a tool to `manifest.json` because it exists only on a local source
branch. Promote tools in this order:

1. implement and test the hosted MCP source;
2. deploy it;
3. verify live `tools/list` and a safe representative call;
4. update this manifest and its exact offline contract test;
5. run the opt-in live verifier;
6. refresh/publish the RUDI index and upgrade installed copies; and
7. enable dependent production workflows only after their own readiness gates.

## Verification

Offline contract:

```bash
npm run verify
```

Hosted read-only contract comparison:

```bash
npm run verify:live
```

Set `DWELLOW_MCP_URL` to verify a non-default deployment candidate. The live
verification calls only `tools/list`; it does not invoke a business tool or
create records.
