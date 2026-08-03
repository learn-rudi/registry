# Video Process Map

Status: draft v0.1 (2026-07-10)

One-page overview of the formal video processes. Each numbered process (VP-N)
has its own SOP in this directory. Detailed technique stays in the existing
reference docs; the SOPs define trigger, procedure, gates, artifacts, and
definition of done.

## Pipeline

```text
Sources: RecordKit library | Downloads inbox | story folder
   |
   v
VP-0  Intake & triage        route ownership, register once, probe, classify,
   |                         decide keeper | disposable | reference
   |-- disposable/reference --> exit (disposable may take optional first-pass)
   v  keeper / production-intended
VP-1  Understand             source transcript, corrections, problem candidates
   v
VP-2  Baseline edit          declared intent -> exact-plan audit -> render -> verify
   v
GATE  Baseline Approval of exact verified baseline render and plan
   |
   +-- optional Sequence Optimization (outside VP-2)
   |      declared order/removal intent -> exact-plan audit -> render
   |      -> declared-order transcript verification -> Sequence Optimization Approval
   v
VP-3  Enhancements           captions, structure overlays, lower third, music
   v
GATE  Motion decision (yes/no)
   |-- no  --> compose VP-3 enhancement recipe without motion ---------+
   |-- yes --> VP-4  Motion pass from approved V1/V2 no-caption base    |
   |             -> compose VP-3 enhancements + motion -----------------+
   v
GATE  Render-specific QA + Final Render Approval of exact creative final and plan
   v
VP-6  Export checkpoint      byte-identical Delivery Output of approved parent,
   |                         routed destination, hash check, output sidecar
   |-- no publish planned --> delivery/handoff -------------------------+
   v                                                                    |
VP-5  Publish prep           consumes Delivery Output; platform packaging; |
   |                         qualifying derivative gets its own output contract |
   v                                                                    |
HOST  Hosting/upload                                                     |
   v
GATE  Posting Approval       exact platforms and timing only
   v
POST  Post/schedule and log                                              |
   |                                                                    |
   +--------------------------------------------------------------------+
   v
VP-6  Retirement             later, when Delivery Outputs are secured and
                             no further exports are expected
```

## Run states

Run states are **implemented in code**: `src/lib/states.js` defines the enum
and transition table, persists `state` in the run's `project.json`, and can
derive state from artifacts on disk (`resolveRunState`). They report artifact
progress, not proof that the process contract was followed or that a human gate
was passed.

| Phase | Implemented `project.json` state(s) | Meaning |
|-------|-------------------------------------|---------|
| VP-0  | `imported`                          | Source copied and probe recorded; structured intake conformance is not implied |
| VP-1  | `transcribed`, `clustered`, `analyzed` | Source transcript → planning clusters → silence/cut-audit candidates exist |
| VP-2  | `planned`, `rendered`, `reviewed`   | Plan exists → render exists → diagnostic review artifacts exist; `reviewed` is not approval |

**Gap:** states beyond `reviewed` are not implemented. Human Approval,
enhancement layers, publish readiness, posting, and retirement are tracked only
informally today (review notes, publish artifacts, CHANGELOG). Every
Final Render Approval must be an explicit human decision tied to one exact
verified render and its canonical Final Render Plan identity; the current state
enum cannot express that decision or the mechanical-derivative exception.

## SOP index

| SOP | File | Status |
|-----|------|--------|
| VP-0 Intake & triage | [VP-0-intake-triage.md](VP-0-intake-triage.md) | drafted |
| VP-1 Understand | [VP-1-understand.md](VP-1-understand.md) | drafted |
| VP-2 Baseline edit | [VP-2-baseline-edit.md](VP-2-baseline-edit.md) | drafted |
| VP-3 Enhancements | to be split out of [EDUCATIONAL_VIDEO_WORKFLOW.md](../EDUCATIONAL_VIDEO_WORKFLOW.md) ("Enhancement Queue") | existing content |
| VP-4 Motion pass | [MOTION_MAP_PROCESS.md](../MOTION_MAP_PROCESS.md) | existing doc |
| VP-5 Publish prep | [PUBLISH_PREP_PROCESS.md](../PUBLISH_PREP_PROCESS.md) | existing doc |
| VP-6 Export and retirement | [VP-6-promote-retire.md](VP-6-promote-retire.md) | drafted; distinct triggers and completion rules, with manual conformance until the stack enforces them |

## Storage model

Three tiers with different lifecycle guarantees (decision 2026-07-10, see
[VP-6-promote-retire.md](VP-6-promote-retire.md)):

| Tier | Location (target) | Guarantee |
|------|-------------------|-----------|
| Product code | `~/.rudi/stacks/video-editor/` | Disposable — replaceable on upgrade/reinstall |
| Run state | `~/.rudi/state/stacks/video-editor/runs/` (and `template-composer/`) | Retainable but cleanable per retention policy |
| Delivery outputs | `~/.rudi/outputs/video-editor/` (default) or the story topic folder | Durable — never silently cleaned |

The required pre-publish Export contract is **canonical approved parent +
byte-identical copy + Output Destination + hash verification + manifest sidecar
= Delivery Output**. VP-5 consumes that Delivery Output, never a run-local
render. If VP-5 creates a qualifying Mechanical Derivative, the derivative is a
second Delivery Output only after it completes its own sidecar, derivative QA,
provenance, and invariant checks. `publish-prep.json` is not that output
sidecar. The manifest is always
`<media-basename>.output.json` beside its media file
([schemas/output.schema.json](../../schemas/output.schema.json)), so multiple
outputs can share a flat directory such as a story's `renders/final/`.
Source Ownership supplies the *default* destination (ad hoc →
`~/.rudi/outputs/video-editor/`, story-owned → the topic's `renders/final/`);
overrides are allowed and must record a reason in the manifest sidecar.

Phase status: Phase 1 (now) — contract defined, manual conformance; the
structured pipeline cannot yet generate the manifest sidecar, track Approval or
its immutable editorial lineage, enforce the mechanical-derivative contract, or
route destinations. Existing finals without sidecars are legacy/provisional;
Phase 1 reports that gap without silently treating them as conforming or
claiming code enforcement. Phase 2 uses enforced `export`/`retire` commands and a
configurable runs root; existing runs stay in place and retire under the
policy.

## Principles

- Gates stay human: Baseline Approval and optional Sequence Optimization
  Approval, motion yes/no, exact-final watch/listen QA and Final Render
  Approval, and Posting Approval.
- Every source enters VP-0. Source ownership, disposition, and technical
  classification are independent decisions; only keepers continue to VP-1.
- Story-owned sources are filed in the canonical topic before initialization
  and registered once from that location.
- No title, captions, lower third, chips, music, motion, or other polish is
  added until the plain spoken-word baseline is explicitly approved.
- Silence/dead-air detection produces candidates only. Editorial intent selects
  the exact proposed plan, cut audit validates it, and that exact audited plan
  is compiled for the render.
- The expected transcript is the corrected source transcript in source order
  minus declared accepted editorial removals. Unexplained omissions have zero
  tolerance; percentage risk scores prioritize review but do not accept errors.
- Diagnostic `reviewed` artifacts are not human Approval. A source-order
  baseline timing change invalidates Baseline Approval and reopens VP-2; a
  Sequence Optimization change invalidates that sequence's evidence and
  Approval without rewriting the approved baseline's history.
- Baseline and Sequence Optimization Approvals remain immutable upstream
  editorial lineage. In-media captions, titles, music, color/look changes,
  overlays, enhancements, or motion produce a creative render that needs
  render-specific QA and fresh Final Render Approval tied to that exact render
  and canonical Final Render Plan identity. Separate native `.srt`/`.vtt`
  companions do not.
- VP-3 specifies the enhancement layers before the motion decision. When motion
  is selected, VP-4 uses the approved V1/V2 no-caption base to design and check
  motion in isolation, then the final composition combines that motion with the
  VP-3 enhancement recipe. The no-motion and motion branches converge on one
  render-specific QA and Final Render Approval gate; VP-3 is not an earlier
  Final Render Approval boundary.
- A byte-for-byte exported copy retains the approved render identity. Only a
  separately recorded bitrate/codec-only social-upload transcode may rely on its
  approved parent, and only when mechanical-derivative QA proves dimensions,
  duration, frame rate, edit/content/timing, mix, color/look, captions,
  overlays, and motion are invariant.
- Export a byte-identical Delivery Output of the canonical approved parent
  before VP-5. Do not describe this as exporting the canonical approved parent.
- VP-5 consumes the Delivery Output. Any qualifying Mechanical Derivative it
  creates must complete its own Delivery Output sidecar, QA, provenance, and
  invariant checks before hosting or upload; `publish-prep.json` is not a
  substitute.
- Posting Approval is separate from Final Render Approval and authorizes only the
  selected platforms and timing.
- Retirement is a later cleanup decision triggered when Delivery Outputs are
  secured and no further exports are expected. It is not gated by Posting
  Approval; ad hoc or non-publishing delivery may bypass VP-5 and Posting
  Approval and still retire.
- VP-2 remains source-ordered. Optional Sequence Optimization is a separate
  post-baseline editorial process before enhancements or motion: it declares
  ordering and removal intent, audits and compiles the exact plan, constructs
  its Expected Transcript in the declared order, binds verification evidence,
  and obtains its own Sequence Optimization Approval.
- The run directory is a technical workspace; the story folder owns durable
  content. Terminology follows [CONTEXT.md](../../CONTEXT.md).
