# VP-6 · Export and retirement

Status: draft v0.1 (2026-07-10), target contract with **manual conformance**.
The VP-6 filename and number remain for compatibility. Export and Retirement
are separate procedures with separate triggers, gates, and completion rules.
The stack does not yet generate the output sidecar, track Approval, route
destinations, or enforce retirement safety.

## Export

### Purpose

Export a byte-identical Delivery Output of the canonical approved parent. This
creates the durable, provenance-bound input that VP-5 Publish Prep consumes.

### Trigger

Final Render Approval exists for the exact verified canonical parent and its
canonical Final Render Plan/recipe identity, and a deliverable is wanted outside
the run.

### Preconditions

Baseline Approval and, when applicable, Sequence Optimization Approval remain
immutable upstream editorial lineage. The operative Final Render Approval is
bound to the parent path, SHA-256, canonical Final Render Plan identity, and
render-specific QA.

In-media captions, titles, music, color/look changes, overlays, enhancements,
and motion are creative mutations. Any hash-different creative result needs its
own render-specific QA and Final Render Approval. Separate native `.srt` and
`.vtt` companions are not in-media mutations.

### Contract

```text
Canonical Approved Parent
  + Byte-Identical Copy
  + Output Destination
  + Hash Verification
  + <media-basename>.output.json
  = Delivery Output
```

The wording is deliberate: **Export a byte-identical Delivery Output of the
canonical approved parent.** Export does not move, rename, or redefine the
canonical approved parent itself. A run-local render is not a Delivery Output.

VP-5 consumes the Delivery Output, never the run-local render. If VP-5 creates
a qualifying Mechanical Derivative, that derivative must become its own
Delivery Output before hosting or upload. It needs its own output sidecar,
derivative QA, provenance, and invariant checks. `publish-prep.json` is not a
substitute for `<media-basename>.output.json`.

### Storage model (target)

```text
~/.rudi/stacks/video-editor/                 product code, disposable
~/.rudi/state/stacks/video-editor/
├── runs/                                    private processing state, cleanable
└── template-composer/                       composer state, cleanable
~/.rudi/outputs/video-editor/                default delivery root, durable
```

Current actual locations differ. Runs live under the installed stack, and
template-composer state lives at `~/.rudi/video-editor/template-composer/`.
Existing runs remain in place until Phase 2 moves new run state.

### Procedure

1. **Select the canonical approved parent.** Resolve the exact file referenced
   by the operative Final Render Approval. Record its SHA-256, canonical Final
   Render Plan identity, render-specific QA references, and upstream editorial
   Approval lineage.
2. **Route the Output Destination.** Source Ownership supplies the default. A
   human may override it, but the sidecar must record the override and reason.

   | Source ownership | Default Output Destination |
   |---|---|
   | Ad hoc | `~/.rudi/outputs/video-editor/<output-name>/` |
   | Story-owned | `<topic>/videos/renders/final/` |

3. **Copy the media.** Copy the approved parent bytes to the destination. Copy
   thumbnails and native `.srt` or `.vtt` companions when wanted.
4. **Verify identity.** Hash the destination media and require it to equal the
   approved parent's SHA-256.
5. **Write the sidecar.** Write `<media-basename>.output.json` beside the media
   and validate it against
   [schemas/output.schema.json](../../schemas/output.schema.json). Record media
   identity, source run, editorial plan revision, canonical Final Render Plan
   identity, operative Approval binding, upstream editorial Approval lineage,
   verification evidence, byte-identical export mode, and destination decision.
6. **Record the handoff.** Update the story README or delivery record when the
   destination is story-owned. Additional destinations are additional Delivery
   Outputs and repeat steps 2 through 6.

Schema validation is contract-strict. A sidecar missing plan identity, Approval
binding, upstream lineage, QA evidence, media properties, export mode, or the
resolved destination path does not validate. JSON Schema cannot compare sibling
values or probe media, so the operator/exporter must also assert:

- `approval.renderSha256 === source.renderSha256`
- `approval.finalRenderPlanSha256 === source.finalRenderPlan.sha256`
- `media.sha256 === source.renderSha256`
- `destination.resolvedPath` actually contains `media.file`

### Gate

The operative Final Render Approval must identify the exact canonical parent
and Final Render Plan. Export adds no creative authorization and does not grant
Posting Approval.

### Done when

The routed media is byte-identical to the canonical approved parent, its
`<media-basename>.output.json` validates, the additional hash/path assertions
pass, and the story or delivery record identifies the handoff.

### On failure

Leave the run and canonical approved parent untouched. Delete only an invalid
destination copy, correct the cause, and export again. Never retire or delete
run artifacts before a hash-verified Delivery Output exists.

### Phase 1 compatibility

Phase 1 is manual and legacy-tolerant. Existing story finals without output
sidecars are reported as **legacy/provisional**. Do not silently relabel them as
conforming, and do not block them as though the current code already enforces
this contract. The operator may complete the missing hash verification and
sidecar manually.

The current `promote <run> <render> <destination-dir>` command is a copy-only
legacy primitive. It does not write the sidecar, verify hashes, track Approval
or lineage, establish Final Render Plan identity, or route destinations. It is
not contract-complete Export.

Phase 2 may add an enforced `export` command. The eventual lifecycle of
`promote` is intentionally undecided here.

## Publish-prep derivative handoff

VP-5 may create a bitrate- and/or codec-only `social-upload` Mechanical
Derivative from its input Delivery Output. Before hosting or upload, that
derivative must:

1. preserve dimensions, duration, frame rate, edit/content/timing, audio mix,
   color/look, captions, overlays, and motion;
2. record the parent Delivery Output and approved-parent identities, operative
   Approval reference, Final Render Plan identity, derivative SHA-256, exact
   transcode recipe, changed bitrate/codec fields, and derivative QA evidence;
3. receive its own routed `<media-basename>.output.json`; and
4. pass schema validation and actual invariant comparisons.

If any invariant changes, the result is a creative render. It must return to
render-specific QA and obtain fresh Final Render Approval before Export.

## Retirement

### Purpose

Record that remaining run state may be cleaned under the retention policy.
Retirement is a cleanup decision, not a publishing milestone.

### Trigger

All required Delivery Outputs are secured and no further exports are expected.
Posting Approval is not a prerequisite. A non-publishing or ad hoc delivery may
bypass VP-5 and Posting Approval and still retire.

### Procedure

1. Confirm every approved parent that must survive has a hash-verified Delivery
   Output and valid sidecar.
2. Confirm no further destinations or exports are expected.
3. Choose and record a retirement level:
   - **Level 1, shrink:** delete regenerable bulk such as `working.mp4`, render
     caches, QA frames, and composer public-media cache. Keep transcripts,
     corrections, plans, cut audits, and reviews. For story-owned runs, the
     story owns the canonical source; for ad hoc runs, keep the source unless a
     durable home preserves it.
   - **Level 2, remove:** delete the run directory only after required Delivery
     Outputs are secured and retained evidence is promoted or explicitly
     accepted as disposable.
4. Record the decision in run `about.md` and the CHANGELOG for now. The current
   state enum has no `retired` value.

Delivery Outputs under `~/.rudi/outputs/` or story folders are durable and are
never silently cleaned. The stack directory is replaceable product code and
must never be the only home of finished work.

### Gate

A human makes the retirement decision after reviewing Delivery Output coverage
and future export needs. Posting Approval and post-log completion are outside
this gate.

### Done when

The chosen retirement level is recorded, all required Delivery Outputs remain
durable and verifiable, and cleanup has not removed evidence or source material
that the recorded decision requires.

### Tooling

Retirement is manual in Phase 1. Phase 2 may add
`retire <run> --level 1|2` and a configurable runs root. These changes do not
alter the independent Export and Retirement triggers above.
