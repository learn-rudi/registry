# RUDI Registry Agent Notes

Follow [AGENTS.md](AGENTS.md) for the canonical catalog layout, package rules,
and verification gates.

The registry has one schema-v2 source per package at an unversioned path and one
generated root `index.json`. Never add version-suffixed metadata files or edit
the generated index by hand.
