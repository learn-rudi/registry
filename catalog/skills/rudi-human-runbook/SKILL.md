---
name: rudi-human-runbook
description: Produce a safe, copyable, checkpointed runbook for setup or recovery work that a person must perform because it depends on interactive consent, physical access, account ownership, hardware, or an unavailable automation boundary. Use for human-only OAuth, vendor-console, device, release, or recovery steps; do not use to disguise an automatable agent workflow or embed secret values.
---

# RUDI Human Runbook

Make human-only work safe and observable. A runbook is an explicit handoff, not
a substitute for automation that is already available and authorized.

Use [the runbook template](references/runbook-template.md). Keep the procedure
short enough to follow under pressure and complete enough to recover from each
material failure.

## When A Human Step Is Legitimate

Use a human runbook when the step requires at least one of:

- interactive consent or a personally owned account;
- physical device, biometric, security-key, or local-network access;
- legal, policy, financial, release, or production approval;
- a vendor console or UI with no safe supported automation interface; or
- recovery from a state where automation cannot establish truth safely.

If the only reason is that the agent has not inspected available tools, perform
capability discovery first.

## Workflow

1. State the outcome, exact system/environment, authorized operator, expected
   duration, risk, and rollback boundary.
2. List prerequisites and preflight checks. Resolve account, tenant, project,
   region, repository, branch, device, and environment explicitly; never rely
   on “the current one” for a consequential action.
3. Represent every secret as a RUDI-owned reference or neutral placeholder such
   as `<RUDI secret: provider/api-key>`. Never include the secret value, a token,
   connection string, private key, recovery code, or credential backup.
4. Break the procedure into numbered steps with one action each. For commands,
   use copyable blocks, safe quoting, explicit working directory, and bounded
   arguments. Avoid unresolved globs and broad destructive targets.
5. After every material mutation, add a checkpoint: expected visible result,
   verification command or inspection, and what to do if it differs.
6. Make retries and duplicate execution explicit. Label steps idempotent,
   one-time, or unsafe to repeat.
7. Put confirmation immediately before destructive, externally visible,
   billable, permission-changing, production, or irreversible actions.
8. Define failure recovery, rollback, and stop conditions. Never tell the
   operator to “continue anyway” after an identity, environment, or verification
   mismatch.
9. End with verification of the real outcome, not only successful button
   clicks or command exit codes. Include logs or artifacts to retain without
   leaking private data.
10. Record completion, skipped steps, deviations, and remaining authority. Do
    not claim the runbook was executed when it was only authored.

## Safety And Clarity Rules

- Prefer reversible actions and previews.
- Name exact UI labels but include the intent so minor vendor wording changes do
  not make the instruction unsafe.
- Do not ask users to paste secrets into chat, shell history, screenshots, or
  tracked files.
- Do not use placeholders that could be mistaken for literal values.
- State which commands are read-only and which mutate state.
- Redact identifiers from example output when they are not needed to verify the
  step.
- Include accessibility alternatives when a visual-only step could block the
  operator.

## Authority Boundaries

- Authoring a runbook does not authorize executing it.
- The runbook cannot grant account access, consent, deployment, publication,
  deletion, payment, permission, or production authority.
- If the user asks the agent to execute automatable steps, follow the relevant
  operator skill and retain the runbook's checkpoints. Stop at genuine human
  gates.
- Never persist completion state in an ad hoc file when an owning system or
  workflow already has the authoritative receipt.

## Host Adaptation

Use the current host's document, terminal, browser, or connector capabilities
to verify names and commands. Keep machine-specific paths, account IDs, and
connector invocation syntax in a local execution copy, not the portable
template. If the environment cannot be inspected, mark exact labels and paths
as verification gaps rather than inventing them.

## Output

Return the runbook artifact, operator and environment, prerequisites, secret
references, numbered actions, checkpoints, retry classification, rollback and
stop conditions, final verification, execution status, and remaining gates.
