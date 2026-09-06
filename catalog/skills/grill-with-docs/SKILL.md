---
name: Grill With Docs
description: Stress-test a plan against the existing domain model, sharpen terminology, and update CONTEXT.md or ADRs as decisions crystallize
version: 1.0.1
category: code
tags:
  - architecture
  - domain-modeling
  - glossary
  - adr
  - documentation
  - grill-me
  - capability:review
---

Interview the user relentlessly about every aspect of a plan until there is a shared understanding. Walk down each branch of the design tree and resolve dependencies between decisions one by one. For each question, provide a recommended answer.

Ask questions one at a time and wait for feedback before continuing. If a question can be answered by exploring the codebase, explore the codebase instead.

## Domain Awareness

During codebase exploration, also look for existing documentation.

Most repos have a single context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```text
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily, only when there is something real to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During The Session

### Challenge The Glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately.

Example: `Your glossary defines "cancellation" as X, but you seem to mean Y. Which is it?`

### Sharpen Fuzzy Language

When the user uses vague or overloaded terms, propose a precise canonical term.

Example: `You're saying "account". Do you mean the Customer or the User? Those are different things.`

### Discuss Concrete Scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force precision around concept boundaries.

### Cross-Reference With Code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it.

Example: `The code cancels entire Orders, but you just said partial cancellation is possible. Which is right?`

### Update CONTEXT.md Inline

When a term is resolved, update `CONTEXT.md` immediately. Do not batch these changes.

`CONTEXT.md` must be a glossary, not a spec, scratch pad, or implementation decision log. Keep it devoid of implementation details.

Use this structure:

```markdown
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

Rules:

- Be opinionated. When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- Keep definitions tight. One or two sentences max. Define what the term is, not what it does.
- Only include terms specific to this project's context. General programming concepts do not belong.
- Group terms under subheadings when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

For multi-context repos, a root `CONTEXT-MAP.md` lists the contexts, where they live, and how they relate to each other:

```markdown
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md): receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md): manages warehouse picking and shipping

## Relationships

- **Ordering -> Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment -> Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering <-> Billing**: Shared types for `CustomerId` and `Money`
```

If `CONTEXT-MAP.md` exists, read it to find contexts. If only a root `CONTEXT.md` exists, treat the repo as a single context. If neither exists, create a root `CONTEXT.md` lazily when the first term is resolved.

## ADRs

Offer an ADR sparingly. Only offer one when all three conditions are true:

1. Hard to reverse: the cost of changing the decision later is meaningful.
2. Surprising without context: a future reader will wonder why it was done this way.
3. Real trade-off: there were genuine alternatives and one was chosen for specific reasons.

If any condition is missing, skip the ADR.

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, and so on. Create `docs/adr/` lazily, only when the first ADR is needed.

Use this minimal template:

```markdown
# {Short title of the decision}

{1-3 sentences: what is the context, what did we decide, and why.}
```

Optional sections are allowed only when they add real value:

- Status frontmatter: `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`.
- Considered Options: only when rejected alternatives are worth remembering.
- Consequences: only when non-obvious downstream effects need to be called out.

To number an ADR, scan `docs/adr/` for the highest existing number and increment by one.

Qualifying ADR topics include architectural shape, integration patterns between contexts, technology choices that carry lock-in, boundary and scope decisions, deliberate deviations from the obvious path, constraints not visible in code, and rejected alternatives when the rejection is non-obvious.
