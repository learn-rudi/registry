---
name: RUDI AI Policy Assessor
description: Assess, score, and upgrade organizational AI acceptable-use policies using RUDI's completeness rubric. Use when reviewing a client AI policy, creating a gap report, comparing a draft against RUDI standards, advising on Claude/ChatGPT/Copilot connectors and data permissions, or turning current AI practices into a policy/training rollout.
version: 1.0.0
category: business
tags: [rudi, ai-policy, governance, compliance, risk, training, connectors]
---

# RUDI AI Policy Assessor

Use this skill to turn an AI policy draft, client conversation, or current-practice notes into a practical RUDI gap report and upgrade path.

Default to a client-facing advisory tone unless the user explicitly asks for internal notes. The report should read like something RUDI can send to the organization being reviewed: respectful, direct, specific, and free of behind-the-scenes commentary.

## Core Workflow

1. Identify the organization, industry, work types, regulated data, current AI tools, and intended rollout stage. If facts are missing, mark assumptions instead of inventing details.
2. Use the RUDI AI policy completeness rubric below.
3. Classify the source artifact:
   - No policy yet: produce a baseline policy outline and discovery questions.
   - Generic draft: score it and recommend concrete client-specific upgrades.
   - Mature policy: focus on operational gaps, connector controls, training, and incident handling.
   - Connector rollout: prioritize permissions, data classes, retention, audit, and human review.
4. Score each RUDI policy element from 0-3:
   - 0 missing
   - 1 mentioned but vague
   - 2 usable but incomplete
   - 3 operationally clear
5. Produce a gap report with findings ordered by risk and implementation value.

## Required Output

For a policy review, provide:

1. **Client Header**: prepared for, document reviewed, and purpose.
2. **Executive Readout**: one or two paragraphs on what is strong, what needs clarification, and rollout readiness.
3. **Scoring Method**: explain the 0-3 element score and 36-point maximum.
4. **Scorecard**: table with the 12 RUDI elements, score, status, and short note.
5. **Priority Gaps**: highest-risk missing items with why they matter.
6. **Recommended Upgrades**: practical fixes grouped into policy language, tool/admin controls, training, and next decisions.
7. **Sample Language**: concise clauses the client can paste into the policy.
8. **Open Questions**: decisions RUDI needs from the client before finalization.

For a new policy, produce:

1. Policy outline mapped to the 12 RUDI elements.
2. Approved tool register starter table.
3. Data classification table.
4. Connector decision matrix.
5. Training/rollout checklist.

## RUDI Framing

- Treat AI governance as operating practice, not a legal document alone.
- Make the policy easy enough for normal staff to follow.
- Separate "may use AI" from "may expose data to AI."
- Do not assume connectors are bad. Assess whether they can reduce copy-paste risk through permissioning, minimization, de-identification, and audit.
- Require human accountability for outputs, especially external, financial, legal, safety, employment, or client-impacting work.
- Prefer specific examples from the client's domain over generic AI language.
- Keep legal claims conservative: say "confirm in the vendor agreement" when discussing data retention, no-training terms, privacy, or compliance.
- Avoid naming individual draft authors in client-facing reports unless the user asks; refer to "the current draft" or "the policy."
- Frame low scores as operational gaps, not as moral or competence judgments.

## What To Avoid

- Do not produce a policy that says "never use confidential data" without defining whether approved enterprise tools, tenant-contained tools, or connectors are exceptions.
- Do not treat consumer/free AI accounts the same as business/enterprise plans.
- Do not create disclosure rules so broad that staff will ignore them.
- Do not let a tool list substitute for data-class rules and review rules.
- Do not recommend technical controls without identifying who owns them.

## RUDI AI Policy Completeness Rubric

Score each element from 0-3:

| Score | Meaning | Use when |
|---|---|---|
| 0 | Missing | The policy does not address the element. |
| 1 | Vague | The element is named but not actionable. |
| 2 | Usable | Staff could follow it, but edge cases or ownership are incomplete. |
| 3 | Operational | The rule, owner, examples, exceptions, and failure behavior are clear. |

The 12 elements:

1. **Purpose, philosophy, and mission fit**: why the organization uses AI and how responsible use connects to mission, values, quality, and risk appetite.
2. **AI tool definition and scope**: standalone chatbots, embedded AI, coding assistants, meeting tools, agents, connectors, custom GPTs/projects, contractors, and personal-device work.
3. **Governance owner and approval workflow**: policy owner, approved tool register owner, exception path, review cadence, and change triggers.
4. **Approved tools, vendor terms, and account rules**: approved tool table, business account requirements, vendor terms, privacy, retention, no-training, residency, audit, and request process.
5. **Data classification and input rules**: public, internal, confidential, restricted/sensitive tiers and allowed-tool rules for each data class.
6. **Redaction, minimization, and safe prompting**: remove identifiers, secrets, unique client details, and unnecessary file scope before using AI.
7. **Connectors, integrations, and embedded AI controls**: approval, least privilege, source permissions, read-only defaults, write/delete approval gates, OAuth scopes, logging, and shared-drive hygiene.
8. **Use categories: encouraged, caution, prohibited**: practical examples of approved workflows, high-caution workflows, and forbidden uses.
9. **Human review, scrutiny tiers, and high-risk decisions**: AI output is draft; facts, figures, citations, code, and calculations are verified; high-risk work gets expert or manager sign-off.
10. **Transparency, disclosure, and accountability**: staff remain accountable, internal acknowledgment and external disclosure rules are realistic, and disclosure ownership is explicit.
11. **IP, copyright, ownership, and source integrity**: protect company and third-party rights, licensed content, source citations, code generation, and open-source license review.
12. **Monitoring, incident response, training, and review**: reporting channel, containment steps, escalation, logs, usage review, training, office hours or FAQs, and annual/material-change review.

Gap severity:

| Severity | Use when | Typical action |
|---|---|---|
| Critical | Missing rule could expose sensitive data, create legal/regulatory risk, or enable harmful decisions. | Fix before rollout or connector enablement. |
| High | Staff can use the policy, but a common workflow is unsafe or ambiguous. | Fix in the first revision. |
| Medium | Policy works for basics but lacks examples, ownership, or training support. | Add during rollout. |
| Low | Wording, formatting, or completeness issue with limited risk. | Clean up before final approval. |

Connector decision matrix:

| Decision area | Green light | Yellow light | Red light |
|---|---|---|---|
| Source permissions | Permissions are clean, least-privilege, and role-based. | Shared folders/channels need cleanup. | Broad everyone-access folders contain sensitive data. |
| Data class | Mostly public/internal data. | Confidential data can be minimized or de-identified. | Restricted data cannot be filtered or minimized. |
| Tool/vendor terms | Business/enterprise agreement reviewed. | Terms are likely acceptable but not documented. | Consumer/free account or unknown vendor terms. |
| Actions | Read-only or approval-gated. | Some writes needed with clear workflow owner. | Delete/send/post/pay/update actions enabled broadly. |
| Logging | Admin/audit visibility exists. | Partial logs exist. | No meaningful way to review access or incidents. |
| Training | Staff know when to use connector vs paste. | Training planned but not delivered. | No training or use guidance. |
