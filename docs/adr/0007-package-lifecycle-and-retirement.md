# ADR 0007: Package Lifecycle And Retirement

## Status

Accepted

## Context

Schema-v2 packages previously exposed no machine-readable distinction between
experimental, stable, maintained, deprecated, or unsupported catalog entries.
Consumers therefore had to guess from package versions and descriptions. The
catalog also contained a Stripe manifest that declared ten MCP tools and a
runtime entrypoint although no implementation or verification contract existed.

Lifecycle metadata must be additive because canonical schema-v2 paths and
existing CLI compatibility remain invariants. It must communicate policy
without making generated indexes depend on the current clock.

## Decision

Packages may declare this optional top-level contract:

```json
{
  "lifecycle": {
    "maturity": "experimental | stable",
    "support": "supported | maintenance | unsupported",
    "deprecation": {
      "announcedAt": "YYYY-MM-DD",
      "message": "actionable migration guidance",
      "replacementId": "optional canonical package ID",
      "removalAfter": "optional YYYY-MM-DD"
    }
  }
}
```

Omission means unclassified. It never implies stable or supported. When
`lifecycle` exists, both maturity and support are required. Unsupported public
packages require deprecation guidance. A replacement must be another published
canonical package. Removal cannot be dated earlier than announcement.

Deprecation dates are informational. Validation compares declared dates for
internal consistency, but compilation, indexing, installation, and CLI display
never branch on wall-clock time. The CLI validates lifecycle metadata at its
registry boundary and displays the posture and migration guidance in package
search, listing, and installed-package information.

Retired packages are absent from the canonical catalog and generated public
indexes. There is no hidden retirement state, version-suffixed manifest, or
parallel legacy catalog. A package may remain published as unsupported only
while it provides truthful installable behavior and explicit deprecation
guidance.

The non-implementing Stripe placeholder is retired immediately. It advertised
behavior that could not execute, so a grace period would preserve a false
contract rather than compatibility. Its tracked source is removed and the
canonical generated indexes are regenerated.

## Consequences

- Existing packages and old schema-v2 consumers continue to work because the
  field is optional and paths are unchanged.
- Package posture becomes explicit to current CLI users without expanding the
  registry into an execution or scheduling service.
- Maintainers must classify deliberately; broad automatic labels are not
  inferred from version numbers, test counts, or package age.
- Unsupported packages cannot remain silently published, and retired packages
  cannot be installed through stale catalog declarations.
- Time-based automated removal, grace-period enforcement, and signed lifecycle
  attestations remain out of scope.
