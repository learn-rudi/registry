# Review roles and checklist

## Multi-Agent Roles

When using subagents, use bounded roles.

### Recon Agent

Task:
- inventory entrypoints
- list route/auth/webhook/tool surfaces
- identify config and deployment files
- return files inspected and surface table entries

### Threat Model Agent

Task:
- generate abuse hypotheses from the surface map
- focus on trust boundaries and sensitive workflows
- return prioritized probes

### Verification Agent

Task:
- test specific hypotheses
- inspect exact files
- run allowed commands/tests
- return evidence, rejected paths, and uncertainty

### QA Agent

Task:
- challenge proposed findings
- verify evidence and severity
- identify false positives
- return downgrade/reject/confirm recommendation

## Subagent Output Contract

Require subagents to return:

```markdown
## Scope
## Files Inspected
## Surface Reviewed
## Trust Boundaries
## Hypotheses Tested
## Findings
## Rejected Hypotheses
## Open Questions
## Checklist Items Completed
```

## Checklist

Maintain and update this checklist:

```markdown
- [ ] Rules of engagement established
- [ ] Repo instructions loaded
- [ ] Worktree state checked
- [ ] Orientation docs reviewed
- [ ] Shallow repo map built
- [ ] Manifests/configs inventoried
- [ ] Entrypoints identified
- [ ] Auth boundaries mapped
- [ ] Tenant/data ownership model mapped
- [ ] API routes reviewed
- [ ] Frontend route protection reviewed
- [ ] Webhooks reviewed
- [ ] Billing/payment flows reviewed
- [ ] LLM/tool/MCP surfaces reviewed
- [ ] File upload/parsing surfaces reviewed
- [ ] Database constraints/migrations reviewed
- [ ] Deployment/security config reviewed
- [ ] Logging/observability reviewed
- [ ] Rate limits/abuse controls reviewed
- [ ] High-risk findings QA-reviewed
- [ ] Findings ledger completed
- [ ] Skipped checks documented
- [ ] Final report produced
```

