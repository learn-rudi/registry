# ADR 0006: Generated Release Provenance

## Status

Accepted

## Context

The registry compiler produces a base index, five platform-specific indexes,
and a catalog hash tree. A file list and generation timestamp identify expected
outputs, but do not detect a canonical artifact changed after compilation.

The catalog content tree is the registry source of truth. Generated indexes and
release metadata describe that source and must not become a competing authority.

## Decision

`dist/release.json` defines an unsigned consistency envelope for exactly seven
canonical generated artifacts:

- `index.json`;
- `index.darwin-arm64.json`;
- `index.darwin-x64.json`;
- `index.linux-arm64.json`;
- `index.linux-x64.json`;
- `index.win32-x64.json`; and
- `catalog.sha256.json`.

For that set, `dist/release.json` records:

- source repository and source revision context;
- a SHA-256 hash keyed by generated artifact path; and
- the catalog hash algorithm and catalog root used for the release.

The verifier requires the declared file set and provenance artifact map to match
the seven canonical names exactly. `release.json` and all seven artifacts must
be regular files rather than symlinks or other filesystem object types. Artifact
paths must remain relative and contained within `dist/`, and each recorded
SHA-256 value must match the corresponding artifact bytes.

The verifier also requires `catalogRoot` and `provenance.catalog` to declare the
same SHA-256 root recorded inside `catalog.sha256.json`. That catalog root is
authoritative for catalog content. Per-artifact hashes check the generated
representations in this envelope but do not supersede or redefine the catalog
root.

The source repository and hexadecimal source revision are recorded context.
They are not cryptographically bound to the artifact bytes, do not prove that
the named commit produced them, and do not prove that the build used a clean
working tree.

Unrelated compiler outputs under `dist/`, `release.json` itself, and the npm
package tarball are outside the seven-artifact hash map. The verifier does not
reject arbitrary additional files under `dist/`.

Package lifecycle, maturity, support, and deprecation semantics are governed by
ADR 0007 and remain separate from release provenance.

## Consequences

Release verification detects a missing canonical artifact, a changed canonical
artifact whose recorded hash was not updated, a noncanonical declared set, a
symlink or non-regular artifact, and disagreement among the recorded catalog
roots. It also exposes the source revision recorded for the release while
retaining one authoritative catalog-content identity.

Because the envelope is unsigned, an actor who can coherently rewrite the seven
artifacts and `release.json` can produce a self-consistent replacement. This is
not publisher identity, proof of origin, tamper prevention, or a signed
attestation. Signing, transparency logs, and external attestation services would
require a later decision.
