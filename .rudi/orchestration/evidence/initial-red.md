# Preimplementation behavioral red receipt

## Provenance correction

The original interactive red run did exit `1` with the expected six missing
skill bundles and absent schema-v2 Decision Frontier behavior, but its raw
stdout/stderr and exact test snapshot were not persisted. That original stream
is therefore **unavailable and not claimed as reproducible evidence**.

After independent review identified the gap, the same seven observable
contracts were captured in the tracked test snapshot
`preimplementation-contract.test.mjs`. The snapshot was run against an exact
detached checkout of base revision
`fd9816b9b45b73a9b43520d48146aa6c782cf5b2` and then against the final task
worktree without changing the assertions.

## Reproducible baseline red

- Test snapshot: `.rudi/orchestration/evidence/preimplementation-contract.test.mjs`
- Base revision: `fd9816b9b45b73a9b43520d48146aa6c782cf5b2`
- Command: `RUDI_REGISTRY_UNDER_TEST=<checkout-at-base-revision> node --test .rudi/orchestration/evidence/preimplementation-contract.test.mjs`
- Exit status: `1`
- Raw output: `.rudi/orchestration/evidence/preimplementation-red-output.txt`
- Result: `0` passed, `7` failed

The failures are six `ENOENT` errors for the approved absent skill bundles and
one `Unknown plan field: decisionFrontier` error. These are behavioral absences,
not dependency, setup, or environment failures.

## Unchanged-snapshot green

- Command: `RUDI_REGISTRY_UNDER_TEST=<final-task-worktree> node --test .rudi/orchestration/evidence/preimplementation-contract.test.mjs`
- Exit status: `0`
- Raw output: `.rudi/orchestration/evidence/preimplementation-green-output.txt`
- Result: `7` passed, `0` failed

The separate `review-fix-red.md` receipt preserves the later hostile red/green
loop for the concurrency, history, and Diagnose-authority review findings.
