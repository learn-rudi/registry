---
name: rudi-diagnose
description: Investigate a reproducible defect, failed check, degraded workflow, or unexplained system behavior by locating the first incorrect state through falsifiable hypotheses and tight feedback loops. Use when the cause is unknown and evidence must precede a fix; do not use for implementing a known change, broad architecture review, or speculative cleanup.
---

# RUDI Diagnose

Debug by reducing uncertainty, not by accumulating edits. The deliverable is a
supported cause and smallest safe correction contract; implementation happens
only when the user authorized it.

Use [the investigation record](references/investigation-record.md) for any
nontrivial or resumable diagnosis.

## Workflow

1. State the expected behavior, observed behavior, precise delta, impact, and
   available evidence. Separate direct observation from reports or inference.
2. Reproduce the behavior deterministically. Reduce it to the smallest case
   that still fails; remove unrelated randomness, concurrency, and data.
3. Choose the fastest truthful feedback loop already available within the
   granted authority: one existing test, command, request, trace, log query, or
   fixture. Propose instrumentation separately when it would require a write.
4. Trace backward from the symptom and identify the first incorrect state or
   contract boundary. Do not stop at the final exception if corruption began
   earlier.
5. Write a short ranked hypothesis list before changing behavior. For each
   hypothesis state: “If this is true, I should observe …” and name the check
   that could disprove it.
6. Run one discriminating check at a time. Record the observation and update the
   ranking; do not preserve a favored explanation against contrary evidence.
7. When the cause is supported, specify the lowest-level behavior test that
   would fail for that cause. Add it only when explicit implementation or test
   write authority has also been granted.
8. If a fix is authorized, make the smallest correction, rerun the unchanged
   failing case, then run adjacent regression and failure-path coverage.
9. If separately authorized instrumentation was used, remove temporary probes,
   test-only state, downloaded fixtures, and diagnostic credentials. Preserve
   only evidence that belongs in the repo or approved artifact store.

## Investigation Discipline

- Bound retries and investigation time; a slow or nondeterministic loop is
  itself a finding.
- Validate every log, file, provider response, database row, event, and LLM
  output at its trust boundary.
- Treat test failures as evidence, not proof that the production code is wrong;
  the test, fixture, environment, or assumption may be the defect.
- Prefer observation over mutation. Do not rewrite a subsystem to make it
  easier to understand before locating the failure boundary.
- For concurrency, persistence, auth, secrets, payments, or destructive paths,
  record rollback and containment before attempting a fix.
- If the issue cannot be reproduced, state what evidence would distinguish
  environmental, intermittent, stale-state, and reporting explanations.

## Authority Boundaries

- A request to diagnose authorizes only read-only observation in the scoped
  system. Require explicit authority for test or instrumentation writes before
  adding a test, editing a file, changing runtime settings, installing a probe,
  or creating diagnostic state.
- Diagnosis does not automatically authorize a production fix, data repair,
  deployment, restart, repository write, or external write. An explicit
  “report only” or “no changes” boundary prohibits all such mutations.
- Do not expose secrets or private data in logs, fixtures, commands, or reports.
- Do not weaken or delete a failing test to declare success.
- Stop for human direction when the next discriminating experiment is
  destructive, externally visible, costly, or outside the placed scope.

## Host Adaptation

Use the current host's test runner, debugger, tracing, log, browser, database,
or repository tools. Keep host-specific commands in the evidence record, not in
the portable diagnosis contract. If an essential environment is unavailable,
return the ranked hypotheses and smallest next experiment rather than guessing.

## Output

Return:

- expected versus observed behavior and reproduction;
- feedback-loop command and reliability;
- first incorrect state or current localization boundary;
- ranked hypotheses with supporting and falsifying evidence;
- supported root cause and confidence;
- fix contract or fix performed, including red/green regression proof;
- temporary instrumentation removed; and
- remaining uncertainty, risk, and required authority.
