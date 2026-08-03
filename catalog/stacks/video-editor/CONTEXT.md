# Video Editor Context

The video-editor stack is the technical workspace for inspecting, editing,
rendering, and QAing local video media before approved assets are exported to a
story or delivery folder.

## Language

**Run**:
A durable technical workspace that holds source media, derived artifacts,
render outputs, QA evidence, and review notes for one edit.
_Avoid_: Inspection bundle, project folder

**Source Ownership**:
The durable home responsible for a source: either a canonical story topic or
an ad hoc external location. It is independent of disposition and technical
classification.
_Avoid_: Story classification, triage outcome

**Disposition**:
The human decision that a source is a keeper, disposable, or reference. It
determines whether the source continues into production, not where it belongs.
_Avoid_: Ownership, technical classification

**Technical Classification**:
Observed media properties such as format and horizontal, vertical, or square
orientation. Source and delivery variants are separate labels.
_Avoid_: Disposition, story type

**Inspect**:
A diagnostic source-understanding pass that gathers media metadata and
representative visual evidence without changing the edit.
_Avoid_: Watch, probe, review

**Probe**:
A metadata-only media check.
_Avoid_: Inspect, review

**QA**:
Evidence gathered to verify media properties, transcript integrity, audio, and
visual state.
_Avoid_: Review, inspection

**Review**:
Diagnostic artifacts that summarize risks, transcript differences, render
status, and recommended next steps after a render exists.
_Avoid_: QA, inspect

**Approval**:
A human decision recorded for a stated scope and exact subject. One Approval
scope does not authorize another, and diagnostic review is not Approval.
_Avoid_: Reviewed, QA passed

**Baseline Approval**:
An Approval accepting one exact verified source-order baseline render and its
audited plan revision.
_Avoid_: Final approval, reviewed baseline

**Sequence Optimization Approval**:
An optional Approval accepting one exact verified sequence-optimized render and
its audited declared-order plan. It does not replace Baseline Approval.
_Avoid_: Baseline approval, final approval

**Final Render Approval**:
An Approval with machine scope `final-render` that accepts one exact
hash-identified creative final and its Final Render Plan after render-specific
QA. It does not replace or alter upstream editorial Approval lineage.
_Avoid_: Exact-final Approval, render Approval, creative render Approval

**Posting Approval**:
An Approval authorizing exact platforms and timing. It is separate from Final
Render Approval and does not authorize creative changes or derivatives.
_Avoid_: Final Render Approval, publish readiness

**Final Render Plan**:
The canonical identified recipe that produced an exact final render, including
its in-media captions, titles, music, color/look, overlays, enhancements, and
motion.
_Avoid_: Editorial plan, review notes

**Watch**:
Human viewing and listening review of media.
_Avoid_: Inspect, probe

**Source Transcript**:
A revision of word-timed ASR text and timings derived from source media. Its
contents are immutable within that identified revision.
_Avoid_: Native captions

**Transcript Corrections**:
A non-editorial overlay that normalizes ASR mistakes and domain terms without
changing source timings or declaring content removals.
_Avoid_: Transcript edits, editorial deletions

**Corrected Source Transcript**:
The derived source-transcript view after applying Transcript Corrections. It is
the authority for edit intent, cut safety, and expected-output construction.
_Avoid_: Rewritten transcript, output transcript

**Output Transcript**:
Render-specific ASR evidence used to verify an exact render against its
Expected Transcript.
_Avoid_: Corrected source transcript, native captions

**Editorial Intent**:
A declared plan for spoken-word order and complete removals, with each removal
anchored to source text and time.
_Avoid_: Transcript corrections, silence candidates

**Expected Transcript**:
The corrected source words in the plan's declared order minus accepted
Editorial Removals. Any other omission, clipping, or duplication is unexplained.
_Avoid_: Source transcript, output transcript

**Editorial Removal**:
A complete spoken word or phrase deliberately omitted by Editorial Intent,
with its source span, text, reason, and decision recorded.
_Avoid_: Transcript correction, accidental omission

**Cut Audit**:
Validation of the exact proposed plan against word boundaries and declared
Editorial Intent before that same plan is compiled for rendering.
_Avoid_: Cut planning, Sequence Audit, output review

**Mechanical Cut**:
A cut that removes non-speech without bisecting or clipping a spoken word.
_Avoid_: Editorial Removal

**Sequence Optimization**:
An optional post-baseline editorial process that deliberately changes spoken
order to improve structure while preserving declared intent and verification.
_Avoid_: Baseline edit, motion pass

**Sequence Audit**:
Editorial validation that an optimized sequence follows its declared ordering
and removal intent.
_Avoid_: Cut Audit, transcript comparison

**Native Captions**:
Separate `.srt` or `.vtt` caption companion files used for publishing. They are
not in-media render mutations and are not authoritative for splice safety.
_Avoid_: Source transcript

**Baseline Pass**:
A source-order process that produces and verifies a plain spoken-word edit for
every keeper video before optional sequence or enhancement work.
_Avoid_: First pass

**First-Pass**:
A disposable rough-cut intake path with no transcript-safety claim. It is a
dead end by design.
_Avoid_: Baseline pass

**Triage**:
A source-intake decision that records Source Ownership and Disposition as
separate axes. Technical Classification records observed media properties.
_Avoid_: Classification, story-or-keeper choice

**Delivery Output**:
A media file exported outside the run to an Output Destination together with
its `<media-basename>.output.json` provenance sidecar. It is either a
byte-identical copy of the canonical approved parent or a qualifying Mechanical
Derivative with its own complete output contract.
_Avoid_: Render candidate, promoted draft

**Export**:
The checkpoint that creates and hash-verifies a byte-identical Delivery Output
of the canonical approved parent before Publish Prep.
_Avoid_: Promote, publish prep, export the canonical approved parent

**Publish Prep**:
The platform-packaging process that consumes a Delivery Output and may create a
qualifying Mechanical Derivative before hosting or upload.
_Avoid_: Export, Posting Approval

**Promote**:
The current legacy copy-only primitive. It does not by itself create a
contract-complete Delivery Output.
_Avoid_: Export, delivery completion

**Mechanical Derivative**:
A bitrate- or codec-only social-upload transcode that preserves the approved
parent's creative content. Under its derivative contract, it may rely on the
parent's Approval with separate QA and provenance; it is not freshly approved.
_Avoid_: Creative version, approved render

**Output Destination**:
Where a Delivery Output lives. Source Ownership supplies the default; a human
may override, and every override is recorded with a reason in the manifest
sidecar.
_Avoid_: Source ownership, run folder

**Retirement**:
The recorded human decision that a run's remaining state may be cleaned per
the retention policy after its Delivery Outputs are secured and no further
exports are expected. It is independent of Posting Approval.
_Avoid_: Deletion, cleanup
