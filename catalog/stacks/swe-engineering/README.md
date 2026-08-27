# SWE Engineering Stack

Portable RUDI stack for the SWE Operating Manual and agent debt scanning.

This catalog directory is the canonical authoring home of the SWE Operating
Manual. Edit the manual here and release through the registry; installed
copies and any other checkouts are distribution artifacts, not sources.

This package exists so any computer can install the engineering doctrine
without relying on a local source path. It vendors only the portable manual
documents and the debt scanner needed by agents.

## Tools

- `swe_manual_list`: list bundled SWE Operating Manual documents.
- `swe_manual_read`: read one bundled manual document by id or filename.
- `swe_manual_search`: search bundled manual documents for a phrase.
- `swe_debt_scan`: run the packaged JS/TS agent debt scanner against a local
  repository using allowlisted command arguments.

By default, the scanner resolves TypeScript from this stack package rather than
from the target repository. Set `SWE_DEBT_SCAN_ALLOW_TARGET_TYPESCRIPT=true`
only when you intentionally want to scan with the target repo's local TypeScript
package.

## Install

```bash
rudi install stack:swe-engineering --with-related-skills
rudi index --json
rudi integrate codex
```

Restart the agent after indexing so the tools and related skill are available.

The RUDI Agentic Engineering Standard defines these related skills as one RUDI
Delivery Loop while retaining their stable package IDs: Change Map,
Chief of Staff as Delivery Coordinator, SWE Compliance Checklist as Engineering
Gate, Horizontal Engineering Review as Coherence Review, Repo Steward, and
Worktree Closeout. Each skill keeps its own authority and ownership boundary.

## Contents

```text
src/
  index.js
  core.js
  manual/
    01-Master-Engineering-Doctrine.txt
    02-Engineering-Quick-Reference.txt
    03-Testing-Doctrine-Source.txt
    04-Debugging-Doctrine-Source.txt
    05-API-Engineering-Standard.md
    06-Security-Engineering-Standard.md
    07-Backend-Application-Engineering-Standard.md
    08-Infrastructure-and-Deployment-Engineering-Standard.md
    09-Build-Order-and-Engineering-System.md
    10-Engineering-Operating-Manual-Index.md
    11-Agent-Copilot-Operating-Standard.md
    12-Horizontal-Engineering-and-Codebase-Stewardship-Standard.md
    13-RUDI-Agentic-Engineering-Standard.md
  tools/
    agent-debt-scan.cjs
```

No secrets are required.
