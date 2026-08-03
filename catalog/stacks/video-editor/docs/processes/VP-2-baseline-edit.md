# VP-2 · Baseline edit

Status: draft v0.1 (2026-07-10)

**Purpose:** Produce and verify a plain spoken-word cut that preserves source
order, removes non-speech mechanically, and removes spoken filler, false
starts, or repetition only when each complete removal is declared. No polish
happens here.

Sequence Optimization is not part of VP-2. Any deliberate reordering starts a
separate optional post-baseline editorial process after baseline approval and
must earn its own exact-plan verification and approval before enhancements or
motion.

**Trigger:** A run reaches `state: "analyzed"` (VP-1 complete).

**Preconditions:** VP-1 complete: an identified Source Transcript revision,
its Transcript Corrections, the derived Corrected Source Transcript, and
problem candidates exist.

**Inputs:** `working.mp4`, `transcript-source.json`,
`transcript-corrections.json`, `silence.json` / candidate list.

## Procedure

1. **Declare editorial intent** — select the proposed source-order plan. For
   every proposed spoken removal, record its complete source time span, source
   text, reason, and accepted/rejected decision. Transcript Corrections must not
   carry these decisions. The standard `edit-intent.json` is an accepted target
   contract and is not yet enforced by the stack.
2. **Audit that exact proposed plan** — validate cuts against Corrected Source
   Transcript word timings and declared intent:
   - mechanical cuts may remove non-speech but may not bisect or clip words;
   - editorial cuts may remove complete declared words or phrases;
   - any spoken-word overlap not covered by an accepted Editorial Removal fails.
   Record the exact audited plan revision in `cut-audit.json`.
3. **Compile the audited plan** — produce `composition.json` from the exact
   current plan that passed audit. A different planning surface, including
   transcript clusters or raw silence candidates, must not be substituted
   after audit.
4. **Render with identity** — produce `renders/rough-vN.mp4` and bind the render
   to the exact audited plan revision. For paired delivery variants, keep timing
   aligned unless format-specific edits are explicitly intended and audited.
5. **Transcribe that output** — create render-specific word-timed Output
   Transcript evidence, bound to the render identity rather than treated as a
   reusable singleton.
6. **Compare against the Expected Transcript** — construct the Expected
   Transcript as the Corrected Source Transcript in source order minus declared
   accepted Editorial Removals, then verify:
   - zero unexplained omissions;
   - the opening phrase and every expected word are intact;
   - no duplicated, clipped, or awkwardly compressed wording exists at splice
     points.
   Percentage risk scores may prioritize listening but are not acceptance
   gates. Listen to apparent ASR noise and explicitly disposition it; do not
   waive an unexplained difference as transcription noise. If verification
   fails, revise intent or timing, re-audit, re-render, re-transcribe, and
   re-compare until clean.
7. **Visual QA and diagnostic review** — probe the render, sample frames,
   confirm dimensions, orientation, speaker framing, and safe areas, then write
   review artifacts for that exact render and plan. Stale or singleton evidence
   is not proof, and `state: "reviewed"` is not approval.

## Gate

An explicit human watch/listen decision tied to the exact verified baseline
render and plan revision. Only after approval does the run advance to VP-3.
Any timing change invalidates approval and reopens VP-2. Titles, captions,
lower thirds, chips, music, motion, and other polish begin only after the plain
spoken-word baseline is approved.

## Artifacts

- target `edit-intent.json`, plus `cut-audit.json` and `composition.json` tied
  to the same exact plan revision
- `renders/rough-vN.mp4`
- render-specific Output Transcript and comparison evidence tied to render and
  plan identity
- `qa/` evidence and diagnostic review artifacts tied to that identity
- explicit human approval decision tied to the verified baseline identity
- `project.json` state advances through `planned` → `rendered` → `reviewed`.
  These are artifact-progress states; the human gate has no implemented state
  and `reviewed` must not be interpreted as approval

## Done when

The exact audited plan produced a render whose Output Transcript matches its
Expected Transcript with zero unexplained omissions, visual and listening QA
passed, diagnostic review exists, and explicit human approval is bound to that
verified render and plan revision.

## On failure

A failed comparison is the verification loop working. Adjust padding, revise or
reject intent, re-audit, re-render, and re-compare. If the same splice fails
repeatedly, keep the pause or words rather than accepting unexplained loss.

## Tooling

Stack tools: `video_plan_cut`, `video_audit_cuts`, `video_render_rough`,
`video_transcribe_run` / `video_transcribe_audio`, `video_qa`, `video_review`.
Detailed technique and the enhancement queue that follows:
[EDUCATIONAL_VIDEO_WORKFLOW.md](../EDUCATIONAL_VIDEO_WORKFLOW.md).

## Enforcement gap

The current implementation does not yet enforce the accepted `edit-intent.json`
contract, exact audit-to-plan compilation, revision-bound render/transcript
evidence, or an approval identity. Existing planner behavior can substitute a
different planning surface, and singleton transcript/audit/review files can be
stale; their presence and the `reviewed` state are not proof of this SOP.

Decision record: [ADR-0003](../adr/0003-baseline-edits-use-declared-intent.md).
