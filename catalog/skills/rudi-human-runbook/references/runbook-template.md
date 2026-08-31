# Human Runbook Template

```markdown
# <Outcome>

## Scope And Authority
- Operator:
- Exact environment/account/project:
- Authorized actions:
- Actions still requiring confirmation:

## Preconditions
- [ ] Identity and tenant verified
- [ ] Backup or rollback boundary verified
- [ ] Required RUDI secret references available without exposing values

## Procedure

### 1. <One action>
- Mutation: read-only / reversible write / irreversible
- Retry: idempotent / one-time / unsafe to repeat
- Action:
- Expected result:
- Checkpoint:
- If different: stop / retry once / rollback / escalate

## Recovery And Rollback
- Failure mode:
- Safe stopping state:
- Rollback steps:

## Final Verification
- Observable outcome:
- Verification method:
- Evidence retained:

## Completion Record
- Executed by and time:
- Deviations or skipped steps:
- Remaining gates:
```
