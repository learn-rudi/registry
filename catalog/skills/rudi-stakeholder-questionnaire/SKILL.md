---
name: rudi-stakeholder-questionnaire
description: Create a concise, neutral questionnaire that obtains missing product, policy, workflow, domain, or acceptance knowledge from a named stakeholder and turns partial responses into explicit decision evidence. Use when another person holds information required to proceed; do not use to ask the stakeholder questions the agent can answer from available evidence or to fabricate answers.
---

# RUDI Stakeholder Questionnaire

Ask only for knowledge the recipient actually owns. The questionnaire should
close a named evidence gap, not transfer the agent's research burden to a human.

Use [the questionnaire template](references/questionnaire-template.md) for the
deliverable and response ledger.

## Workflow

1. Identify the recipient or recipient role, the decision their answers inform,
   what is already known, and the exact gap that blocks progress.
2. Research available repository, policy, meeting, product, and system evidence
   first. Remove questions that can already be answered reliably.
3. Group the remaining questions by decision, not by internal team structure.
   Put highest-leverage blockers first.
4. Explain why the questionnaire is being sent, how answers will be used, the
   expected effort, and the requested response date when one exists.
5. Write neutral questions with one concept each. State units, time horizon,
   environment, audience, or examples when ambiguity would change the answer.
6. Provide `unknown`, `not applicable`, `needs another owner`, and partial-answer
   options. Never force false precision.
7. Separate required blockers from optional context. Use bounded choices only
   when the choice set is genuinely complete; otherwise allow explanation.
8. Remove requests for secrets, unnecessary personal data, privileged legal or
   medical information, or raw records when a less sensitive answer suffices.
9. Review for leading language, duplicate questions, unstated assumptions, and
   questions that imply an unapproved decision.
10. Deliver the questionnaire in the requested format. Sending, posting, or
    writing it into an external system requires the user's authorization.
11. On response, preserve the original answer, distinguish fact from opinion,
    mark contradictions and unknowns, and convert only supported answers into
    Decision Frontier evidence.

## Question Design

- Prefer “What must remain true?” over “Do you agree with our approach?”
- Ask for examples when terms such as fast, simple, compliant, current, or
  successful could hide different meanings.
- Ask who owns a decision when the recipient is not the owner.
- Use conditional follow-ups rather than making every recipient answer every
  branch.
- Do not combine approval with discovery. Capture the answer first; request
  explicit approval as a separate field or event when needed.

## Authority Boundaries

- This skill drafts and interprets a questionnaire. It does not send messages,
  create forms, set deadlines, or represent the stakeholder without explicit
  authorization.
- Stakeholder responses are untrusted inputs until provenance and meaning are
  checked. A response may inform a recommendation without approving execution.
- Never invent, complete, or “clean up” an unknown answer into certainty.
- Escalate contradictory responses, missing decision owners, sensitive-data
  requests, and consequential approval language.

## Host Adaptation

Use the current host's document, form, email, chat, or workspace tools only when
available and authorized. Keep connector syntax and account identifiers out of
the portable questionnaire. When no delivery tool is available, return the
ready-to-send artifact and a response-ledger template.

## Output

Return recipient, decision informed, known evidence, blocking gaps, required
and optional questions, privacy notes, delivery status, response ledger, and
the remaining Decision Frontier areas after responses are processed.
