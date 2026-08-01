# CAGIS Public Data

Read-only MCP boundary for one Cincinnati address. The stack delegates to the
configured Pre Dev Intel public-data API so CAGIS provider logic has one
implementation owner. It exposes no mutation or unrestricted HTTP tool.

Required configuration: `CINCINNATI_PUBLIC_DATA_API_BASE_URL`. An optional
scoped `CINCINNATI_PUBLIC_DATA_API_KEY` is sent only as `x-api-key`.
