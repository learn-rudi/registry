# Final Render Approval Is Non-Transitive

Status: accepted

Final Render Approval is an Approval record with machine scope `final-render`,
bound to one exact render SHA-256 and the canonical Final Render Plan identity
that produced it after render-specific QA. Baseline and optional Sequence
Optimization Approvals remain immutable upstream editorial lineage, but they do
not transfer to a hash-different render produced by in-media captions, titles,
music, color/look, overlays, enhancements, or motion. Each such creative final
needs fresh explicit human Final Render Approval. A byte-for-byte copy keeps the
approved identity, and native `.srt`/`.vtt` companions do not mutate media.

Exact-render semantics are necessary because creative mutations can change what
a viewer sees or hears without changing the approved spoken-word edit. A caption
can obscure evidence, a title can change meaning, music or mix can reduce
intelligibility, color treatment can hide detail, and overlays or motion can be
mistimed or misleading. Treating an upstream editorial decision as approval of
those downstream effects would turn provenance into an assumption and leave no
reliable answer to which pixels, samples, and recipe a human accepted.

The only hash-different exception is a video `social-upload` transcode that
changes strictly bitrate and/or codec. It may rely on the approved parent only
when separate derivative QA and provenance prove dimensions, duration, frame
rate, edit/content/timing, mix, color/look, captions, overlays, and motion are
invariant. Under its derivative contract, the derivative is eligible for
delivery through its parent's operative Approval; it is not freshly approved.
Any other change returns to the Final Render Approval rule.

This decision accepts additional review friction for creative rerenders in
exchange for exact, auditable provenance. The narrow transcode exception avoids
repeating a human creative review when platform packaging cannot alter creative
content, but it deliberately replaces that convenience with explicit comparison
evidence. Posting Approval remains a separate authorization for platform and
timing, and Phase 1 records all of these contracts manually rather than adding a
new approval category.
