# Codex Task Command Contract

Schema version: `1`

This contract is the closed V1 interface for `$codex-tasks`. Unsupported verbs,
keys, target combinations, and option values are errors. Do not infer aliases.

## Grammar

```text
$codex-tasks <verb> [key=value ...]
```

Values containing whitespace remain one token in the user request. Treat them
as data and never interpolate them into a shell.

Primary selectors:

```text
task=codex://threads/<uuid>  # or the bare UUID
project=/absolute/path      # exact saved-project ID or label is also accepted
section="Client Work"       # stable section ID or exact display name
cwd=/absolute/path
```

Exactly one primary selector is required unless the verb is `help` or
`create-section`. `host=` is an optional disambiguator, never a primary target.
`to-section=` is a destination, never a second primary target.

## Normalized envelope

The validator emits JSON with:

```json
{
  "schemaVersion": "1",
  "verb": "inspect",
  "target": {
    "kind": "task",
    "selector": "codex://threads/00000000-0000-4000-8000-000000000001",
    "id": "00000000-0000-4000-8000-000000000001",
    "uri": "codex://threads/00000000-0000-4000-8000-000000000001"
  },
  "options": {},
  "executionClass": "read",
  "reasoningClass": "none",
  "nativeCapabilities": ["read_thread"],
  "requiresReadBack": false,
  "requiresConfirmation": false
}
```

The validator proves syntax and static compatibility. Native discovery still
must prove identity, availability, and current state.

## Verb matrix

| Verb | Target | Required options | Optional options | Class | Native capabilities |
| --- | --- | --- | --- | --- | --- |
| `help` | none | none | none | read | none |
| `list` | `section`, `project`, or `cwd` | none | `host` | read | `list_threads`, `list_projects` |
| `inspect` | `task`, `project`, `section`, or `cwd` | none | `host` | read | task: `read_thread`; otherwise `list_threads`, `list_projects` |
| `status` | `task`, `project`, `section`, or `cwd` | none | `host` | read | task: `wait_threads`, `read_thread`; otherwise list and read capabilities |
| `review` | `task` | exactly one of `mode` or `workflow` | `criteria`, `host` | read | `read_thread` |
| `start` | `project` or `cwd` | `prompt` | `title`, `environment`, `model`, `thinking`, `host` | work dispatch | `list_projects`, `create_thread`, `read_thread` |
| `continue` | `task` | `prompt` | `model`, `thinking`, `host` | work dispatch | `read_thread`, `send_message_to_thread`, `read_thread` |
| `fork` | `task` | none | `prompt`, `environment`, `model`, `thinking`, `host` | work dispatch | without prompt: `read_thread`, `fork_thread`, `read_thread`; with prompt: `read_thread`, `fork_thread`, `send_message_to_thread`, `read_thread` |
| `rename` | `task` | `title` | `host` | metadata mutation | `read_thread`, `set_thread_title`, `read_thread` |
| `move` | `task` or `project` | `to-section` | `host` | metadata mutation | target-specific list and move capability |
| `pin` | `task` or `project` | none | `host` | metadata mutation | target-specific list and move capability |
| `unpin` | `task` or `project` | none | `to-section`, `host` | metadata mutation | target-specific list and move capability |
| `archive` | `task` | none | `host` | lifecycle mutation | `read_thread`, `set_thread_archived`, `list_archived_threads` |
| `restore` | `task` | none | `host` | lifecycle mutation | `read_thread`, `set_thread_archived`, `list_archived_threads` |
| `create-section` | none | `name` | none | metadata mutation | `list_threads`, `create_sidebar_section`, `list_threads` |
| `rename-section` | `section` | `name` | none | metadata mutation | `list_threads`, `rename_sidebar_section`, `list_threads` |
| `delete-section` | `section` | `confirm=delete-section` | none | organization-destructive | `list_threads`, `delete_sidebar_section`, `list_threads` |

`move`, `pin`, and `unpin` use
`move_thread_to_sidebar_section` for task targets and
`move_project_to_sidebar_section` for project targets.

## Option constraints

- `start environment=`: `local` or `worktree`.
- `fork environment=`: `same-directory` or `worktree`.
- `fork prompt=` is sent to the created child task after the fork. `model=` and
  `thinking=` configure that follow-up, so either option requires `prompt=`.
- `thinking=`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or
  `ultra`; the selected model must support it at execution time.
- `review mode=`: `status`, `completion`, `handoff`, or `risk`.
- `completion`, `handoff`, and `risk` require `criteria=`.
- `status` does not accept `criteria=`.
- `workflow=` is a skill name with an optional leading `$`; the validator
  removes the `$`.
- `title` is limited to 200 characters, section `name` to 120, `prompt` to
  20,000, and `criteria` to 8,000. Other fields have smaller defensive limits.
- `cwd` is always absolute. A project selector containing path separators must
  also be absolute; a non-path value may be a project ID or exact label.

## Resolution contract

Resolution returns one target record containing the requested selector,
resolved entity kind, authoritative native ID, display label, project
association, direct and project section placement, cwd or worktree, host,
evidence source, and discovery time.

Resolution invariants:

1. Native IDs, not titles or positions, authorize mutation.
2. Project association and direct sidebar placement remain independent.
3. A cwd match narrows discovery but does not prove saved-project membership.
4. Duplicate labels remain separate candidates until IDs prove identity.
5. Zero or multiple viable matches reject the command.
6. An incomplete roster remains visible as a coverage limitation.
7. `to-section=pinned` resolves to the built-in pinned section.
8. `to-section=default`, or an omitted destination on `unpin`, resolves to the
   applicable native `null`/default placement.

`start cwd=...` must fail closed when the native host cannot create a task in
that exact existing cwd. It must not fall back to a default projectless output
directory or infer a saved project from path shape.

## Authority and failure behavior

- Read verbs do not authorize mutation.
- A valid single-target mutation authorizes only its mapped operation.
- No V1 command authorizes bulk mutation.
- `continue` authorizes sending only its supplied `prompt` to the exact task.
- `fork` authorizes only the fork and, when supplied, its exact `prompt` as a
  follow-up to the created child task.
- `review` never authorizes workspace edits or lifecycle mutation.
- Section deletion requires the literal confirmation phrase and exact section
  resolution.
- Missing capabilities, incomplete identity, ambiguous destination, or stale
  state reject before mutation.
- A partial or unverified mutation is `indeterminate`; never retry it
  automatically.

## Examples

```text
$codex-tasks list section="Client Work"

$codex-tasks inspect task=codex://threads/00000000-0000-4000-8000-000000000001

$codex-tasks review task=codex://threads/00000000-0000-4000-8000-000000000001 mode=status

$codex-tasks review task=codex://threads/00000000-0000-4000-8000-000000000001 workflow=rudi-code-review

$codex-tasks start project=/workspace/project title="Define task controls" prompt="Implement the approved specification."

$codex-tasks move task=codex://threads/00000000-0000-4000-8000-000000000001 to-section="Client Work"

$codex-tasks archive task=codex://threads/00000000-0000-4000-8000-000000000001
```

## Mutation receipt

Every mutation result reports:

```text
command: schema version, verb, execution class
authority: exact explicit user command
target: requested selector, resolved ID, label, project, cwd, host
destination: resolved section ID and label when applicable
operations: native capabilities attempted in order
before: relevant native state
after: verified native state
outcome: accepted | rejected | failed | indeterminate | no-op
coverage: complete or the exact limitation
next: the next exact command or required user decision
```
