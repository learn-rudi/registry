---
name: "Brand Assets Operator"
description: "Operate Brand Assets through RUDI's stack tools when a user asks to inspect, vectorize, normalize, compose, or validate raster-generated logo assets."
version: 1.0.1
category: "media"
tags:
  - rudi
  - operator
  - brand-assets
  - vectorization
  - svg
  - capability:design
requires:
  stacks:
    - stack:brand-assets
---

# Brand Assets Operator

Use this skill as the operating layer for `stack:brand-assets`. This stack is
the post-generation handoff after `stack:image-generator`: it turns a raster
logo candidate into a reviewable vector artifact, then composes variants from a
validated SVG master.

## Operating contract

The source image is evidence, not authority. The caller must name the candidate
that is being traced as `canonical_label` (for example, `compact-monogram-b` or
`wide-monogram-a`). The stack records that label and the source SHA-256; it never
decides which competing geometry is the mark.

Use only explicit local paths returned by an upstream tool or supplied by the
user. Keep generated files in a deliberate working/output directory. Do not
overwrite an existing SVG or provenance sidecar unless the user has explicitly
authorized replacement.

## Workflow

1. Inspect the raster with `inspect_brand_source`. Confirm the format,
   dimensions, and source hash before tracing.
2. Confirm the canonical candidate label and choose trace parameters. For a
   multi-color mark, use a threshold that isolates the intended component and
   document any accent components that will be added during composition.
3. Call `trace_brand_asset` to write a one-color SVG and its `.svg.json`
   provenance sidecar. The trace uses ImageMagick for a white-background binary
   mask and Potrace for the vector path.
4. Review the trace visually at useful sizes. A successful trace is not an
   automatic approval of geometry, spacing, or brand correctness.
5. Call `compose_brand_variant` for `standalone`, `stacked`, or `horizontal`
   layouts. Descriptor text such as “Responsible Use of Digital Intelligence”
   remains live SVG text with the declared font family; it is not traced.
6. Call `validate_brand_asset` on every final SVG. For full-name variants,
   require the expected live font family and use `allowed_colors` when a palette
   boundary matters.
7. Report exact output and sidecar paths, hashes, the selected canonical label,
   review status, and any remaining human decisions.

## RUDI-specific guidance

When working on RUDI, treat the compact and wide monogram candidates as
separate inputs until the owner explicitly selects one. Existing canonical SVG
masters may be composed directly; do not retrace a full-name render merely to
recreate the descriptor. Use real IBM Plex Mono text for the descriptor family,
and keep an outlined-for-print copy as a later production deliverable when a
vendor requires it.

## Failure behavior

- Missing or unsupported source: report the validation error and ask for a local
  PNG, JPEG, or WebP path; do not invent a result.
- Missing ImageMagick or Potrace: report the dependency and install hint; do not
  fall back to an opaque or unverified trace.
- Existing output: stop unless explicit overwrite authorization was supplied.
- Unsafe or malformed SVG: stop before composition or validation succeeds.
- Geometry, threshold, font, spacing, or candidate disagreement: preserve the
  artifact, mark it for human review, and do not claim canonical approval.
- Partial completion: distinguish the written trace, sidecar, composed variant,
  and validation result so a retry cannot accidentally duplicate or overwrite
  work.

## Tool surface

- `inspect_brand_source`
- `trace_brand_asset`
- `compose_brand_variant`
- `validate_brand_asset`

Use only tools present in the active router. The live MCP schema is authoritative
for field names, defaults, and bounds.
