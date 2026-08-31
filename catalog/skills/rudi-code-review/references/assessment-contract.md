# RUDI Review Contract

For each finding record:

```markdown
### [P1] <Short defect title>
- Axis: Standards / Spec / Proof
- Evidence: `<path:line>` or artifact
- Failure scenario:
- Why it matters:
- Smallest correction or closing proof:
```

Finish with:

```markdown
## Axis Verdicts
- Standards: pass / revise / blocked — <reason>
- Spec: pass / revise / blocked — <reason>
- Proof: pass / revise / blocked — <reason>
- Overall: pass / revise / blocked

## Residual Risk And Gaps
- <risk, accepted debt, or unreviewable boundary>
```

`Blocked` means the axis cannot be responsibly evaluated because required
context or evidence is unavailable. `Revise` means actionable findings prevent
acceptance. `Pass` may still include explicit residual risk.
