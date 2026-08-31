# Independent Standards / Spec / Proof review

## Broad review verdict

Initial verdict: **revise**.

Material findings:

1. concurrent promotions could both accept the same source revision and lose
   one update;
2. promotion history did not bind every accepted area outcome or enforce
   cross-history revisions and approval-time ordering;
3. Diagnose-only requests implicitly authorized reversible instrumentation and
   test writes; and
4. red, registry-gate, and debt evidence URIs lacked matching retrievable
   artifacts.

The reviewer also forward-tested Decision Frontier, Diagnose, Prototype,
Stakeholder Questionnaire, Code Review, Human Runbook, and Publish Task Changes.
Six were usable on the first pass; Diagnose failed its report-only authority
boundary.

## Corrections

- Plan-mutating commands acquire one adjacent exclusive lock and re-read the
  plan while holding it. The concurrent hostile test proves exactly one writer
  accepts the current revision and the other fails stale without state loss.
- Promotion inputs and receipts bind every terminal area and decision, plus a
  complete source-frontier digest. Validation enforces immutable bound records,
  promotion-after-approval time, monotonic lineage, and globally unique
  accepted revisions across promotions and reconciliations.
- Diagnose authorizes only read-only observation by default. Test writes,
  file edits, instrumentation, runtime changes, installed probes, and diagnostic
  state require explicit additional authority; report-only forbids them.
- Exact tracked red, green, gate, and debt artifacts live in this evidence
  directory. The original interactive red stream is explicitly unavailable;
  an unchanged tracked contract test reproduces seven failures against the
  exact base revision and seven passes against the final worktree.

## Focused confirmation

The single permitted focused confirmation passed Findings 1–3 and initially
returned **revise** for proof because the first repair retained stale receipt
digests and cited later test hashes. The proof record was corrected without
claiming the unavailable stream: authoritative evidence now points to the
tracked artifacts with their actual SHA-256 digests.

Focused code/contract confirmation command: 35/35 tests passed.
Full repository confirmation command: 274/274 tests passed.

Final axis disposition after the proof correction:

- Standards: pass
- Spec: pass
- Proof: pass — the deterministic plan-evidence verifier resolved and hashed all
  17 accepted evidence records after review reconciliation.
