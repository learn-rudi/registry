---
name: "GitHub Operator"
description: "Operate GitHub through RUDI's stack tools when a user asks for work supported by stack:github. Manage GitHub repositories, branches, contents, collaborators, issues, pull requests, releases, Actions, artifacts, and direct REST API calls"
version: 1.0.1
category: "development"
tags:
  - rudi
  - operator
  - github
requires:
  stacks:
    - stack:github
---

# GitHub Operator

Use this skill as the host-native operating layer for `stack:github`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Manage GitHub repositories, branches, contents, collaborators, issues, pull requests, releases, Actions, artifacts, and direct REST API calls

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Workflow

1. Identify the user's requested outcome, inputs, constraints, and whether the
   action changes external state.
2. Inspect the active MCP tool schema before calling a tool. The runtime schema
   is authoritative for parameter names, required fields, and enums.
3. Start with `github_auth_status` for authenticated work. Treat its verified
   login as identity proof only; endpoint-specific authorization still requires
   the requested operation or provider permission evidence.
4. Start other work with discovery, inspection, validation, preview, or dry-run
   tools when the stack provides them.
5. Use the fewest tool calls that can complete the request. Reuse returned IDs
   and paths instead of guessing them.
6. Before a destructive, irreversible, public, paid, or externally visible
   action, obtain the user's confirmation unless they already authorized that
   exact action.
7. Validate tool results before using them as inputs to another call. Stop on
   malformed results, explicit errors, missing required data, or partial
   completion that makes the next action unsafe.
8. Verify mutations with a read-back, status, inspection, or artifact check
   when the stack supports one.
9. Report what was attempted, what succeeded, what failed, and any output IDs,
   URLs, or paths the user needs.

## Stack Tools

- `github_auth_status`
- `github_rest_request`
- `github_list_repos`
- `github_get_repo`
- `github_create_repo`
- `github_update_repo`
- `github_delete_repo`
- `github_list_branches`
- `github_get_branch`
- `github_create_branch`
- `github_delete_branch`
- `github_search_code`
- `github_get_file`
- `github_put_file`
- `github_delete_file`
- `github_list_collaborators`
- `github_add_collaborator`
- `github_remove_collaborator`
- `github_list_prs`
- `github_get_pr`
- `github_create_pr`
- `github_update_pr`
- `github_merge_pr`
- `github_list_pr_files`
- `github_list_pr_commits`
- `github_list_pr_reviews`
- `github_create_pr_review`
- `github_request_pr_reviewers`
- `github_remove_pr_reviewers`
- `github_list_issues`
- `github_get_issue`
- `github_create_issue`
- `github_update_issue`
- `github_add_comment`
- `github_list_comments`
- `github_update_comment`
- `github_delete_comment`
- `github_list_labels`
- `github_create_label`
- `github_update_label`
- `github_delete_label`
- `github_add_issue_labels`
- `github_set_issue_labels`
- `github_remove_issue_label`
- `github_list_milestones`
- `github_create_milestone`
- `github_update_milestone`
- `github_delete_milestone`
- `github_list_releases`
- `github_get_release`
- `github_create_release`
- `github_update_release`
- `github_delete_release`
- `github_list_workflows`
- `github_dispatch_workflow`
- `github_list_workflow_runs`
- `github_get_workflow_run`
- `github_rerun_workflow_run`
- `github_cancel_workflow_run`
- `github_list_artifacts`
- `github_delete_artifact`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:github`; do not simulate a successful tool call.
- Missing credentials or authorization: call `github_auth_status`, name the
  required setup or provider-reported permission without printing secret values,
  and do not describe a verified login as proof of write access.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
