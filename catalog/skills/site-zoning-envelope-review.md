---
name: Site Zoning Envelope Review
description: Run the Pre Dev Intel site-engine workflow from address, parcel key, rollup, or saved site-record through zoning and buildable envelope only. Use when the user asks whether a parcel's zoning can be determined, how zoning feeds the site envelope, what the net buildable area or largest rectangle is, or when frontage/MapLibre review is needed before shell frontier, building type fit, or parking feasibility. Stop before building-type fit, shell frontier, parking feasibility, site-option-set, or concept generation unless the user explicitly asks to continue.
version: 1.0.0
category: real-estate
tags: [zoning, site-engine, envelope, frontage, parcels, feasibility]
---

# Site Zoning Envelope Review

Use this skill to answer: "Given this site or parcel, what zoning applies, what is the gross site geometry, and what legal net envelope does zoning create?"

The decision boundary is `site-envelope.json`. Do not treat shell frontier, building type fit, parking feasibility, or unit yield as part of this skill unless explicitly requested.

## Workflow

1. Resolve the site.
   - Input may be an address, parcel key, rollup id, or existing `site-record.json`.
   - Address-only resolution is strict by default: if multiple rollups match, stop and report every candidate from the CLI error. Do not choose by rank. Re-run with `--rollup-id <uuid>` after the user or evidence selects the correct rollup.
   - Produce or reuse `site-record.json`.
   - Report address, parcel keys, `site.primaryZoningCode`, area, frontage, depth, owner, source rollup id, selection mode, and any frontage confidence/status.

2. Collect physical and contextual facts.
   - Produce `site-geometry.json`, `site-context.json`, `site-conditions.json`, and `output/site-boundary.png`.
   - `site-context.json` must exist before rendering `output/site-boundary.png`; do not run the board renderer in parallel with its context dependency.
   - Report gross site geometry first: site boundary, gross site area, frontage/depth measurements, and any raw largest-site-rectangle facts if available.
   - Report topography, soil, overlays, nearby context count, and whether frontage labels are inferred or confirmed.

3. Establish frontage before final net envelope.
   - Use street adjacency, address/entry street, site-context, deterministic frontage review, and MapLibre imagery when needed.
   - Produce `site-orientation.json` as the explicit frontage frame consumed by the envelope stage.
   - If frontage is not confirmed, downstream legal envelope numbers are provisional.
   - Do not call a raw boundary rectangle "buildable" until zoning setbacks have been applied.

4. Normalize zoning.
   - Produce `site-zoning.json` from `site-record.json`.
   - Pass `site-conditions.json` when present.
   - For DD, resolve and pass `dd-overlay-facts.json` before zoning.
   - Report primary code, canonical base code, overlays, active regulatory form, setbacks, height/FAR, parking minimum, allowed building types, and citations/source sections.

5. Compute the legal/net envelope.
   - Produce `site-envelope.json` and `output/site-envelope.png`.
   - Report buildable area, zoning max footprint, max height/stories/FAR, setback summary, and largest usable rectangle.
   - Preserve the story distinction: `maxLegalStories` is the zoning fact (for example `2.5`); `maxFullStories`/`maxStories` is the whole-floor count used by shell/GFA search.
   - Explain that the net envelope is the gross site boundary minus frontage-dependent zoning setbacks and zoning dimensional controls.

6. Render review evidence and stop.
   - Produce `zoning-evidence-report.html` when useful.
   - The evidence CLI takes `--output-html`; it also writes the adjacent `zoning-evidence-report.json` sidecar. Do not pass `--output-json`.
   - Produce frontage review and MapLibre reference imagery when edge labels, frontage, or street orientation affect the decision.
   - Stop after reporting zoning and envelope unless the user explicitly asks for shell frontier, building type fit, parking feasibility, or concept selection.

## Frontage Rule

Frontage confirmation is not required for the gross site boundary, gross site area, or a raw largest rectangle inside the un-setback parcel. It is required before relying on net envelope geometry or a legal largest rectangle when:

- `site-record`, `site-envelope`, or evidence report flags `frontage_labels_unconfirmed`, `frontage_unconfirmed`, `frontageStatus: needs_review`, or inferred edge labels.
- The parcel is irregular, corner-like, unusually large, or has multiple plausible street edges.
- Front, rear, or side setbacks differ materially.
- The user wants design-grade siting, shell frontier, or "biggest rectangle" conclusions.

If frontage is unconfirmed, report the legal/net envelope as provisional and route to frontage review before shell frontier decisions.

## Vocabulary

- `site boundary`: the gross parcel/site polygon before setbacks.
- `gross site area`: area inside the site boundary.
- `gross site rectangle`: the largest rectangle inside the raw site boundary; useful for orientation, not a legal buildable answer.
- `frontage`: the legal front edge assignment used to decide front, side, side-street, and rear setbacks.
- `site orientation`: the persisted frontage frame in `site-orientation.json`; this is the artifact `site-envelope` consumes.
- `site envelope` / `net buildable envelope`: the legal polygon after applying zoning setbacks to the site boundary.
- `largest legal rectangle`: the largest rectangle inside the net buildable envelope.
- `building envelope`: a specific building or shell inside the net envelope after building-type, massing, height, FAR, parking/access, and design rules.
- `maxLegalStories`: fractional legal story cap from zoning source.
- `maxFullStories` / envelope `maxStories`: whole-floor count for shell frontier and rough GFA calculations.

## Command Pattern

Prefer individual commands so the workflow stops at the envelope boundary. Use full `run_phase1.py` only when the user asks for the complete phase1 pipeline.

```bash
ARTIFACTS=site-engine/projects/<neighborhood>/<site-slug>/artifacts

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_record_cli.py \
  --address "<address>" \
  --output "$ARTIFACTS/site-record.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_geometry_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --output "$ARTIFACTS/site-geometry.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_context_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --output "$ARTIFACTS/site-context.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_conditions_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --output "$ARTIFACTS/site-conditions.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_board_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-context-json "$ARTIFACTS/site-context.json" \
  --output-png "$ARTIFACTS/output/site-boundary.png" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_orientation_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-context-json "$ARTIFACTS/site-context.json" \
  --output "$ARTIFACTS/site-orientation.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_zoning_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-conditions-json "$ARTIFACTS/site-conditions.json" \
  --output "$ARTIFACTS/site-zoning.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_envelope_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-zoning-json "$ARTIFACTS/site-zoning.json" \
  --site-orientation-json "$ARTIFACTS/site-orientation.json" \
  --output "$ARTIFACTS/site-envelope.json" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_site_envelope_board_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-envelope-json "$ARTIFACTS/site-envelope.json" \
  --site-context-json "$ARTIFACTS/site-context.json" \
  --output-png "$ARTIFACTS/output/site-envelope.png" \
  --overwrite

PYTHONPATH=site-engine/python python3 site-engine/export/py/export_zoning_evidence_report_cli.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --site-zoning-json "$ARTIFACTS/site-zoning.json" \
  --site-envelope-json "$ARTIFACTS/site-envelope.json" \
  --site-conditions-json "$ARTIFACTS/site-conditions.json" \
  --site-orientation-json "$ARTIFACTS/site-orientation.json" \
  --site-boundary-png "$ARTIFACTS/output/site-boundary.png" \
  --site-envelope-png "$ARTIFACTS/output/site-envelope.png" \
  --output-html "$ARTIFACTS/zoning-evidence-report.html" \
  --overwrite
```

For DD sites, insert this before `export_site_zoning_cli.py` and pass the resulting sidecar with `--dd-overlay-facts-json`.

```bash
PYTHONPATH=site-engine/python python3 site-engine/zoning/scripts/resolve_cincinnati_dd_overlays.py \
  --site-record-json "$ARTIFACTS/site-record.json" \
  --output "$ARTIFACTS/dd-overlay-facts.json" \
  --overwrite
```

## Frontage And MapLibre Evidence

Generate deterministic frontage review artifacts when frontage matters:

```bash
PYTHONPATH=site-engine/python python3 site-engine/scripts/render-frontage-review.py "$ARTIFACTS"
```

Generate MapLibre imagery when the agent or user needs a visual street/context check. Use the dominant parcel key from `site-record.site.parcelKeys[0]`.

```bash
PYTHONPATH=site-engine/python python3 site-engine/export/py/block_overview_cli.py \
  --parcel-key "<parcel-key>" \
  --output-dir "$ARTIFACTS/renderings/maplibre" \
  --radii 50 \
  --style hybrid \
  --site
```

If the command differs in the current repo, inspect `site-engine/scripts/run-site-pipeline.sh` and use its `MAPLIBRE_BOARD_CLI` stage.

## Reporting Format

Report each step with:

- artifact path
- key facts
- warnings or unresolved assumptions
- whether the result is final or provisional

For the envelope, always answer:

- What zoning code and base code applied?
- What is the gross site area and raw site geometry?
- Is `site-orientation.json` confirmed before setbacks are applied?
- Which setbacks were used?
- What are `maxLegalStories`, `maxFullStories`, and max height?
- What is the net buildable envelope area?
- What is the largest usable rectangle, if computed?
- Is frontage confirmed enough to rely on that rectangle?

## Stop Conditions

Stop and ask or report the boundary when:

- address-only resolution returns multiple rollup candidates
- shell frontier search is requested but frontage is unconfirmed
- shell frontier search hits a budget limit
- building type fit or parking feasibility is requested before the user has accepted the envelope
- the user asks only for zoning, envelope, net buildable area, or frontage review

Do not turn parking-feasibility surviving options into a design recommendation in this workflow.
