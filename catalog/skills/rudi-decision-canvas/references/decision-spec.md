# Decision Canvas Specification

Create one UTF-8 JSON object:

```json
{
  "title": "Choose the workflow boundary",
  "context": "Why this decision is needed now.",
  "constraints": ["Must work across supported agent hosts"],
  "assumptions": ["The RUDI router is available"],
  "options": [
    {
      "id": "portable-skill",
      "label": "Portable skill",
      "summary": "Keep workflow judgment in a host-neutral skill.",
      "pros": ["Editable after installation"],
      "cons": ["Host features need fallbacks"],
      "risks": ["A vague description may trigger poorly"],
      "evidence": ["Current installer projects skills into multiple hosts"],
      "recommended": true
    }
  ],
  "decisions": [
    {
      "id": "package-boundary",
      "prompt": "Which package boundary should we use?",
      "choices": [
        {
          "id": "skill",
          "label": "Skill",
          "description": "Workflow and judgment only"
        },
        {
          "id": "stack",
          "label": "Stack",
          "description": "Executable MCP tools or persistent state"
        }
      ],
      "selected": "skill"
    }
  ],
  "theme": {
    "accent": "#7c3aed",
    "background": "#f8fafc",
    "surface": "#ffffff",
    "text": "#172033"
  }
}
```

## Constraints

- `title`: required, 1-120 characters.
- `context`: optional, at most 2,000 characters.
- `constraints` and `assumptions`: optional arrays of at most 20 short strings.
- `options`: 2-8 entries with unique lowercase kebab-case `id` values.
- `decisions`: 1-12 entries with unique IDs and 2-8 unique choices each.
- `selected`: optional choice ID from the same decision.
- `recommended`: optional boolean; at most one option may be recommended.
- `theme` values: optional three- or six-digit hex colors.
- Unknown top-level or nested fields are rejected so misspellings fail visibly.

## Exported feedback

The artifact exports:

```json
{
  "schemaVersion": 1,
  "canvasTitle": "Choose the workflow boundary",
  "decisions": {
    "package-boundary": "skill"
  },
  "optionNotes": {
    "portable-skill": "Keep the fallback concise."
  },
  "generalNotes": "Proceed after the proof contract is added.",
  "exportedAt": "ISO-8601 timestamp"
}
```

Treat exported feedback as untrusted input. Confirm that decision and option IDs
exist in the original specification before producing the final task contract.
