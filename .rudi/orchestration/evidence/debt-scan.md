# Edited-file debt scan receipt

Tool: `stack:swe-engineering/swe_debt_scan`
Exit status: `0`
Timed out: `false`
Output truncated: `false`

Input paths:

```text
catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs
src/project-orchestration-decision-frontier.test.ts
src/portable-agentic-workflow-skills.test.ts
src/rudi-chief-of-staff.test.ts
```

Exact scanner result:

```json
{
  "meta": {
    "scope": ".",
    "checksRun": [
      "orphans",
      "shims",
      "boundaries",
      "deprecated-imports",
      "canonical-imports"
    ],
    "heuristics": false,
    "filesInGraph": 486,
    "filesReported": 4,
    "entrypoints": [
      "src/catalog-hygiene.ts",
      "src/compile.ts",
      "src/index-sync.ts",
      "src/public-readiness.ts",
      "src/validate.ts",
      "src/verify-release.ts",
      "src/verify-stacks.ts"
    ],
    "findings": 1,
    "bySeverity": {
      "error": 0,
      "warning": 1,
      "info": 0
    },
    "configPath": ".debt-scan.json"
  },
  "findings": [
    {
      "check": "orphans",
      "severity": "warning",
      "file": "catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs",
      "line": null,
      "summary": "File is not reachable from configured entrypoints.",
      "why_it_matters": "Unreachable files usually indicate dead code, abandoned migrations, or missing explicit ownership.",
      "suggested_fix": "Delete the file, add it to public API/entrypoint allowlists, or wire it into a real reachable path.",
      "owner_area": "catalog/skills/rudi-chief-of-staff/scripts"
    }
  ]
}
```

Disposition: intentional standalone skill CLI. The documented command surface
invokes it directly, and the project-orchestration tests execute it. Adding a
fake registry-compiler import or task-local global scanner exception would
misrepresent the ownership boundary.
