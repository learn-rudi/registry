# Brand Assets

`stack:brand-assets` is the deterministic post-generation stage for logo and
mark assets. It is intended to run after `stack:image-generator` produces a
raster candidate:

```text
raster candidate → inspect/hash → threshold mask → Potrace SVG → human review
                 → compose variants → validate SVG + provenance sidecar
```

The stack is deliberately not a brand-approval system. A caller must supply a
`canonical_label`; competing geometries remain separate until a human chooses
one. The output records the source path, source SHA-256, dimensions, tracing
parameters, tool versions, and elapsed time.

## Tools

### `inspect_brand_source`

Read-only inspection of an absolute local PNG, JPEG, or WebP path. It returns
format, dimensions, byte count, and SHA-256. Raster inputs must be regular,
non-symlink files no larger than 50 MB.

### `trace_brand_asset`

Writes a one-color, sanitized SVG plus a `.svg.json` provenance sidecar. It
creates a white-background grayscale threshold mask with ImageMagick, traces it
with Potrace, then normalizes the returned paths into a safe SVG. Existing
outputs are rejected unless `overwrite: true` is explicit.

`threshold_percent` is intentionally caller-controlled. Lower thresholds can
isolate a dark mark from a colored accent; in that case, add the accent as an
explicit component during composition rather than pretending the raster trace
understood brand semantics.

### `compose_brand_variant`

Composes a validated SVG mark as:

- `standalone` - the mark only;
- `stacked` - live descriptor text below the mark;
- `horizontal` - mark, divider, and live descriptor text beside one another.

The default descriptor font family is `IBM Plex Mono, monospace`. The SVG keeps
the text editable and records the font dependency in the sidecar. The caller
may add explicit accent circles in the mark's source `viewBox` coordinates via
`accent_dots`.

### `validate_brand_asset`

Read-only validation that rejects malformed SVG, scripts, external references,
data URLs, and non-hex fill/stroke colors. It can also require a canonical label,
live font family, and an allowed color set.

## Install and verification

```bash
rudi install brand-assets
python3 verify.py
```

The stack requires system `magick` (ImageMagick) and `potrace`. The verifier
checks the Python tests and the live MCP tool surface; it does not make network
calls or invoke an image provider.

## Handoff from image generation

Pass the exact output path returned by `stack:image-generator` to
`inspect_brand_source`. Preserve the returned hash in the trace sidecar. Do not
copy a raster into the public registry or a business brand folder as part of
this stack; those are separate, user-authorized handoffs.
