# Context Placement Rules

Use the narrowest durable surface that matches the instruction's scope.

| Surface | Put here | Keep out |
|---|---|---|
| One task or conversation | Temporary goals, constraints, and acceptance criteria | Rules expected to survive into unrelated work |
| Global agent instructions | Personal defaults and universal safety boundaries | Repository layout, specialized procedures, volatile tool inventories |
| Repository instructions | Build/test commands, architecture boundaries, shared conventions, Definition of Done | Rare workflows and instructions for only one subtree |
| Nested repository instructions | Rules that apply only below a directory | Duplicated repository-wide doctrine |
| Skill | Conditional or reusable workflow, templates, scripts, and decision rules | Live secrets, durable operational state, unrelated workflows |
| Configuration or hook | Mechanical enforcement, permissions, feature flags, and lifecycle checks | Explanatory workflow prose better handled by a skill |
| Stack | Executable MCP tools, authenticated integrations, controlled actions, or persistent operational state | Prompt-only instructions and host execution ownership |
| Reference document | Detailed standards or schemas loaded only when relevant | A critical invariant that must always be visible |

## Review questions

For every instruction, ask:

1. Who must follow it?
2. During which tasks is it relevant?
3. Is it explanatory guidance or mechanically enforceable behavior?
4. Does it depend on live data, authentication, tools, or persistent state?
5. What breaks if it is not loaded?
6. Which closer-scoped instruction wins when two rules differ?
7. Is the rule current, testable, and linked to its canonical source?

## Evidence levels

- **Deterministic:** exact duplicate block, file metrics, path, or literal
  host-specific reference.
- **Strong inference:** a long deployment or publishing section that is useful
  only during that workflow.
- **Needs semantic review:** apparent contradiction, stale command, unclear
  ownership, or a rule whose scope is implicit.

Never present a heuristic as a confirmed contradiction or deletion decision.
