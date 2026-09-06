# ADR 0013: Skill folders, primitive categories and stack relationships

Status: implemented candidate; publication pending separate authorization.

The approved catalog audit found mixed loose-file and folder sources, many
overlapping categories, generic discovery text, and ambiguity between a skill's
subject and its relationship to a stack. A source-only move would also leave
installed format collisions and metadata loss unaddressed.

Author one same-ID folder per skill. Use exactly one of Web, Code, Data,
Documents, Media, Communication or Agents as the primary category. Store
capability, domain and provider facets in existing namespaced tags. Derive
operator roles from `related.operatorSkill`; retain `requires.stacks` for hard
requirements and `related.skills` for operators and optional companions.

Keep package IDs, resource paths and host invocation policies stable. Human
display names can improve independently. Registry compilation validates the
authoring contract while legacy parsing and CLI installation remain compatible.
The CLI must preserve metadata and safely replace owned flat installs before
the moved catalog is published. Native projections remain derived artifacts
with their existing ownership and conflict rules.

Typed facet fields, authored roles, a new skill-dependency schema, nested
category directories and a new catalog website are excluded. See
[Skill catalog organization](../skill-catalog.md) for the shared contract and
the execution ledger for verification and rollout status.
