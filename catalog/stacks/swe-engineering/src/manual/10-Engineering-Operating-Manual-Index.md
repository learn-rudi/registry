# Engineering Operating Manual Index

### The Complete Document Map

---

## What This Is

This is the top-level index for the engineering operating manual. Every document, its purpose, and when to use it.

Use this page to navigate. Use the documents themselves to build, review, operate, and learn.

---

## The System at a Glance

**Build order (sequential):**
Schema → Operations → APIs → Frontend → Agents

**Quality system (ongoing):**
Doctrine (how good) + Testing (how to prove it) + Debugging (how to fix it)

**Appendix map across the manual:**
Database (A) · Frontend (B) · Testing (C) · Debugging (D) · API (E) · Security (F) · Backend (G) · Infrastructure (H)

---

## Core Documents

| Document | Purpose | Use When |
|---|---|---|
| **Engineering Doctrine** | Defines principles, review dimensions, PR checklist, scoring rubric, and incident framework for production-grade engineering | Every decision, every review, every incident |
| **Testing Doctrine** | Defines what to test, how to test, prioritization, coverage philosophy, and quality bar | Every development and review cycle |
| **Debugging Doctrine** | Systematic 6-phase method for diagnosing and correcting behavioral deviations | Any debugging activity at any layer |
| **Build Order** | Defines construction sequence, phase gates, iteration rules, and how all documents connect | Project planning, onboarding, architectural review |

---

## Operating Standards

| Document | Purpose | Use When |
|---|---|---|
| **Agent Co-Pilot Operating Standard** | Defines agent posture, review evidence, red-green operation, and commit authorization | Any nontrivial agent-assisted engineering change |
| **Horizontal Engineering And Codebase Stewardship Standard** | Detects and dispositions repeated mechanisms, shared-contract drift, environment coupling, and consolidation obligations | A pattern crosses changes or modules, a third semantic implementation appears, or repository-level consolidation is being planned |

---

## Layer-Specific Standards (Appendices)

| Appendix | Layer | Covers | Use When |
|---|---|---|---|
| **A — Database** | Schema / Data | Schema design, indexing, query discipline, migrations, transactions, replication, backup, observability, data integrity | Designing schema, reviewing database changes, planning migrations |
| **B — Frontend** | UI / Client | Rendering performance, state management, error boundaries, accessibility, dependencies, components, offline behavior, compatibility, testing | Building or reviewing any user-facing interface |
| **E — API** | Interface / Boundary | Resource design, schemas, error model, versioning, auth, rate limiting, idempotency, observability, testing, documentation, pagination, agent interfaces | Designing or reviewing any API endpoint |
| **F — Security** | Cross-cutting | Threat modeling, identity, authentication, authorization, trust boundaries, secrets, supply chain, CI/CD security, infrastructure security, security observability, incident response, security testing, agent security | Every layer, every review, every design |
| **G — Backend** | Application Logic | Service architecture, business logic, state machines, side effects, transactions, caching, job queues, events, application lifecycle, middleware, resource management, configuration, observability | Building or reviewing any backend application code |
| **H — Infrastructure** | Deployment / Runtime | Packaging, infrastructure as code, environments, deployment strategy, rollback, runtime lifecycle, scaling, networking, deployment observability, operational safety | Any deployment, infrastructure change, or operational review |

---

## Reference Material

| Document | Purpose | Use When |
|---|---|---|
| **API Primitives** | Conceptual model of API building blocks and mental frameworks | During API design, for vocabulary and framing |
| **Security Primitives** | Embedded in Appendix F | During security design, for mental checklist |
| **Backend Primitives** | Embedded in Appendix G (three-level hierarchy: atomic → control → composite) | During backend design, for conceptual clarity |

---

## Operational Tools

| Tool | Purpose | Use When |
|---|---|---|
| **Comprehensive PR / Code Review Checklist** (Doctrine Section IV) | Structured checklist for pull request review covering all 24 review categories | Every code review, as author and reviewer |
| **Scoring Rubric** (Doctrine Section VI) | 1–5 scoring across 14 categories for evaluating component quality | Architecture review, codebase audit, maturity assessment |
| **Incident Response Framework** (Doctrine Section IX) | Severity levels, incident lifecycle, postmortem requirements, feedback loop | During and after production incidents |
| **Phase Gates** (Build Order Section VI) | Checkpoints between build phases defining what "done" means | Before progressing from one build phase to the next |

---

## Reading Order for New Engineers

1. **Engineering Doctrine** (Sections I–III) — the principles and review framework
2. **Build Order** (Sections II and IV) — the big picture and how documents connect
3. **Appendix for your current layer** — A, B, E, G, or H depending on your work
4. **Appendix F (Security)** — applies to everyone regardless of layer
5. **Testing Doctrine** — Appendix C in the master doctrine; use it to verify your work
6. **Debugging Doctrine** — Appendix D in the master doctrine; use it when behavior deviates from expectation
7. **PR Review Template** — for every pull request
8. **Incident Response Framework** — before your first on-call rotation

---

## Reading Order for Agents

When assigning implementation tasks to agents, include the relevant subset:

| Task Type | Provide to Agent |
|---|---|
| New schema / migration | Build Order Phase 1, Appendix A, Appendix F (trust boundaries) |
| Backend feature | Build Order Phase 2, Appendix G, relevant sections of Appendix F |
| New API endpoint | Build Order Phase 3, Appendix E, Testing Doctrine (Appendix C), Appendix F (auth/boundaries) |
| Frontend feature | Build Order Phase 4, Appendix B, Appendix F (frontend security) |
| Agent workflow | Build Order Phase 5, Appendix G (workflows), Appendix F section F13 |
| Infrastructure change | Appendix H, Appendix F (infrastructure security, pipeline security) |
| Full system design | Build Order (complete), all relevant appendices, Testing Doctrine, Phase Gates |
| Codebase audit | Scoring Rubric, Review Dimensions from relevant appendices, Appendix F |
| Horizontal engineering review | Horizontal Engineering And Codebase Stewardship Standard, relevant layer appendix, Testing Doctrine |

---

## Three Modes of Use

| Mode | Context | How the Manual Helps |
|---|---|---|
| **Build it right** | New projects, prototypes, greenfield work | Build order provides sequence; phase gates define minimum foundation; appendices provide layer-specific standards |
| **Assess what's wrong** | Mature codebases, tech debt, acquisitions | Scoring rubric provides structured evaluation; review dimensions identify gaps; appendices define what "good" looks like per layer |
| **Enforce continuously** | Ongoing development, agent-assisted work, code review | PR checklist structures every review; phase gates enforce quality before progression; testing doctrine defines verification; incident framework captures learning |

---

## File Inventory

| # | Document | Type | Status |
|---|---|---|---|
| 1 | `01-Master-Engineering-Doctrine.txt` | Canonical master doctrine | Complete |
| 2 | `02-Engineering-Quick-Reference.txt` | Condensed operating quick reference | Complete |
| 3 | `03-Testing-Doctrine-Source.txt` | Testing doctrine source document | Complete |
| 4 | `04-Debugging-Doctrine-Source.txt` | Debugging doctrine source document | Complete |
| 5 | `05-API-Engineering-Standard.md` | API engineering standard | Complete |
| 6 | `06-Security-Engineering-Standard.md` | Security engineering standard | Complete |
| 7 | `07-Backend-Application-Engineering-Standard.md` | Backend application engineering standard | Complete |
| 8 | `08-Infrastructure-and-Deployment-Engineering-Standard.md` | Infrastructure and deployment engineering standard | Complete |
| 9 | `09-Build-Order-and-Engineering-System.md` | Build-order and system guide | Complete |
| 10 | `10-Engineering-Operating-Manual-Index.md` | Navigation index | Complete |
| 11 | `11-Agent-Copilot-Operating-Standard.md` | Agent co-pilot posture, review recording, red-green loop, and commit authorization | Complete |
| 12 | `12-Horizontal-Engineering-and-Codebase-Stewardship-Standard.md` | Cross-change pattern detection, consolidation obligations, and remediation | Complete |

---

*The standard for production software is not "it worked once." The standard is: it continues to behave coherently when timing shifts, dependencies fail, inputs degrade, and scale increases.*
