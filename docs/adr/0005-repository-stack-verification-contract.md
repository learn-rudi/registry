# ADR 0005: Repository Stack Verification Contract

## Status

Accepted

## Context

Registry stacks use different runtimes and deployment models. Some contain a
local MCP implementation that can be exercised offline, while others are hosted
bridges whose provider cannot be contacted safely or deterministically in CI.
Putting verification commands in public manifests would make a repository
quality concern part of the CLI-facing package contract and would expand the
public schema without a consumer need.

Existing stacks also predate a common verification entrypoint. Requiring every
historical stack to migrate before changed packages can be checked would delay
enforcement for new work.

## Decision

Stack verification is a repository convention, not a public manifest field.

- Node stacks expose a non-empty `scripts.verify` in their stack-local
  `package.json`. When dependencies or development dependencies exist,
  preparation requires a committed `package-lock.json` and runs `npm ci` with
  lifecycle scripts disabled. A package may also define a non-empty
  `scripts.verify:prepare`; when `--prepare` is requested, the runner invokes it
  after `npm ci` and before `scripts.verify`.
- Python stacks expose a stack-local `verify.py`.
- Changed official stacks are verified in CI. Text and JSON results identify the
  selected package; a missing runtime-native contract reports the canonical
  package ID and the missing contract.
- The runner starts subprocesses from an executable and argument vector with
  `shell: false`. Node verification still uses `npm run verify`, so the
  package-defined npm script retains npm's own script-shell semantics.
- The runner creates one isolated `HOME` and `RUDI_HOME` for the package
  session. That state persists across dependency preparation, optional
  package-owned preparation, and verification, then is removed after the
  package passes or fails. Subprocesses receive only an allowlist of process
  environment variables and no inherited secret or provider variables. Each
  subprocess has a ten-minute default timeout.
- Verification is non-interactive and must not require credentials, paid calls,
  or live provider access.
- Local MCP implementations should verify their build or import, focused
  behavior, and the tool surface declared by their manifest.
- Hosted bridges verify an offline, statically pinned local adapter contract;
  they do not contact the hosted provider to list or invoke tools.

The repository provides generic live-contract helpers for Node and Python. They
initialize the stack's configured stdio MCP, request `tools/list`, require
unique non-empty tool names, and compare that name set with manifest
`provides.tools` without treating declaration order as significant. The Python
helper also runs `unittest` discovery when `tests/test_*.py` files exist and
fails closed when discovery runs zero tests or any test fails.

These shared helpers live at repository paths such as
`scripts/verify-node-stack.mjs` and `scripts/verify-python-stack.py`. They are
repository verification surfaces that package-owned verification contracts may
invoke; they are not standalone entrypoints promised to exist in an installed
stack package.

`RUDI_VERIFY_OFFLINE=1` communicates the offline policy to each contract. It is
advisory: the runner does not create an operating-system network sandbox and
cannot by itself prove that a package contract made no network request or that
local or hosted evidence is sufficient. Those are package-contract obligations
that code review and the verification implementation must enforce.

Dependency preparation is separate from offline verification. With `--prepare`,
`npm ci`, Python `pip install`, and package-owned preparation may use the network
to obtain dependencies or download assets such as browser runtimes. Verification
still receives the narrow, secret-free environment and advisory
`RUDI_VERIFY_OFFLINE` signal described above.

Python preparation accepts `requirements.txt` at the package root or at
`python/requirements.txt`. A package containing both locations is rejected as
an ambiguous layout. Dependencies are range-resolved into a temporary virtual
environment and are not currently lockfile-reproducible or hash-locked.

The manifest schema recognizes Node, Python, Deno, and Bun runtimes. The
repository verifier currently defines contracts only for Node and Python, so a
changed Deno or Bun stack fails verification until a runtime-specific contract
is designed and implemented.

Full-catalog adoption is incremental. The changed-stack gate establishes the
contract when a stack is added or modified; catalog-wide verification remains
available to measure and complete the migration without weakening changed-stack
CI.

Package lifecycle, maturity, support, and deprecation semantics are governed by
ADR 0007 and remain separate from executable verification metadata.

## Consequences

The CLI and public schema do not need to interpret executable verification
metadata. Package authors still have one visible, runtime-native entrypoint, and
CI reports the pass or failure against its selected package.

Local and hosted stacks use different evidence appropriate to their trust
boundary while sharing the same offline and secret-free policy. The environment
boundary is enforced by the runner; offline behavior and evidence quality remain
the responsibility of the package contract. npm script-shell behavior and
networked dependency preparation also remain explicit review surfaces.

Historical stacks may remain unverified until changed, so the repository must
track the remaining migration rather than treating changed-stack success as
proof that the entire catalog has adopted the contract.
