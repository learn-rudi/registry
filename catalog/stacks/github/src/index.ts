#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_BODY_LENGTH,
  MAX_PER_PAGE,
  addCollaborator,
  addComment,
  addIssueLabels,
  cancelWorkflowRun,
  createBranch,
  createIssue,
  createLabel,
  createMilestone,
  createOrUpdateFile,
  createPullRequest,
  createPullRequestReview,
  createRelease,
  createRepo,
  deleteArtifact,
  deleteBranch,
  deleteComment,
  deleteFile,
  deleteLabel,
  deleteMilestone,
  deleteRelease,
  deleteRepo,
  dispatchWorkflow,
  getBranch,
  getFile,
  getIssue,
  getPullRequest,
  getRelease,
  getRepo,
  getWorkflowRun,
  githubRestRequest,
  listArtifacts,
  listBranches,
  listCollaborators,
  listComments,
  listIssues,
  listLabels,
  listMilestones,
  listPullRequestCommits,
  listPullRequestFiles,
  listPullRequestReviews,
  listPullRequests,
  listReleases,
  listRepos,
  listWorkflowRuns,
  listWorkflows,
  mergePullRequest,
  removeCollaborator,
  removeIssueLabel,
  removePullRequestReviewers,
  requestPullRequestReviewers,
  rerunWorkflowRun,
  searchCode,
  setIssueLabels,
  updateComment,
  updateIssue,
  updateLabel,
  updateMilestone,
  updatePullRequest,
  updateRelease,
  updateRepo,
  type ToolArgs,
} from "./core.js";

type JsonSchema = Record<string, unknown>;
type Handler = (args?: ToolArgs) => Promise<Record<string, unknown>>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

function schema(
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema {
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

function s(description?: string): JsonSchema {
  return description ? { type: "string", description } : { type: "string" };
}

function n(description?: string): JsonSchema {
  return description ? { type: "number", description } : { type: "number" };
}

function b(description?: string): JsonSchema {
  return description ? { type: "boolean", description } : { type: "boolean" };
}

function arr(itemType = "string", description?: string): JsonSchema {
  const value: JsonSchema = { type: "array", items: { type: itemType } };
  if (description) value.description = description;
  return value;
}

function obj(description?: string): JsonSchema {
  return description ? { type: "object", description } : { type: "object" };
}

function en(values: string[], description?: string): JsonSchema {
  const value: JsonSchema = { type: "string", enum: values };
  if (description) value.description = description;
  return value;
}

const ownerRepo = {
  owner: s("Repository owner or organization login."),
  repo: s("Repository name."),
};

const pagination = {
  per_page: n(`Results per page, 1-${MAX_PER_PAGE}.`),
  page: n("GitHub page number, starting at 1."),
};

const issueNumber = {
  issue_number: n("Issue or pull request number."),
};

const pullNumber = {
  pull_number: n("Pull request number."),
};

function tool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[] = []
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: schema(properties, required),
  };
}

const tools: ToolDefinition[] = [
  tool("github_rest_request", "Call any GitHub REST API path relative to the configured API base. Mutating methods dry-run unless confirm_write is true; DELETE also requires confirm_delete.", {
    method: en(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
    path: s("GitHub REST API path starting with /, e.g. /repos/OWNER/REPO/actions/runs."),
    query: obj("Query parameters."),
    body: obj("JSON request body for mutating requests."),
    confirm_write: b("Required for POST, PUT, PATCH, and DELETE."),
    confirm_delete: b("Required with confirm_write for DELETE."),
  }, ["path"]),

  tool("github_list_repos", "List repositories visible to GITHUB_TOKEN, or public repos for a user/org when owner_type and owner are supplied.", {
    owner: s("Optional user or organization login."),
    owner_type: en(["authenticated", "user", "org"]),
    visibility: en(["all", "public", "private"]),
    affiliation: arr("string", "Authenticated repo affiliations."),
    type: s("GitHub repository type filter."),
    sort: en(["created", "updated", "pushed", "full_name"]),
    direction: en(["asc", "desc"]),
    ...pagination,
  }),
  tool("github_get_repo", "Get details for a GitHub repository.", ownerRepo, ["owner", "repo"]),
  tool("github_create_repo", "Create a user or organization repository. Dry-run by default.", {
    org: s("Optional organization login. Omit to create under the authenticated user."),
    name: s("New repository name."),
    description: s(),
    homepage: s(),
    private: b(),
    visibility: en(["public", "private", "internal"]),
    auto_init: b(),
    gitignore_template: s(),
    license_template: s(),
    confirm_create: b("Must be true to create the repository."),
  }, ["name"]),
  tool("github_update_repo", "Update repository settings. Dry-run by default.", {
    ...ownerRepo,
    name: s(),
    description: s(),
    homepage: s(),
    private: b(),
    visibility: en(["public", "private", "internal"]),
    default_branch: s(),
    archived: b(),
    confirm_update: b("Must be true to update the repository."),
  }, ["owner", "repo"]),
  tool("github_delete_repo", "Permanently delete a repository. Dry-run by default.", {
    ...ownerRepo,
    confirm_delete: b("Must be true to delete the repository."),
  }, ["owner", "repo"]),

  tool("github_list_branches", "List repository branches.", { ...ownerRepo, protected: b(), ...pagination }, ["owner", "repo"]),
  tool("github_get_branch", "Get a repository branch.", { ...ownerRepo, branch: s() }, ["owner", "repo", "branch"]),
  tool("github_create_branch", "Create a branch from source_sha or source_branch. Dry-run by default.", {
    ...ownerRepo,
    branch: s("New branch name."),
    source_sha: s("Source commit SHA."),
    source_branch: s("Source branch name, used to look up the source commit SHA."),
    confirm_create: b("Must be true to create the branch."),
  }, ["owner", "repo", "branch"]),
  tool("github_delete_branch", "Delete a branch ref. Dry-run by default.", {
    ...ownerRepo,
    branch: s(),
    confirm_delete: b("Must be true to delete the branch."),
  }, ["owner", "repo", "branch"]),

  tool("github_search_code", "Search GitHub code with optional owner, repo, language, path, extension, and filename qualifiers.", {
    query: s("Code search query."),
    owner: s(),
    repo: s("Optional repository qualifier. Requires owner."),
    language: s(),
    path: s(),
    extension: s(),
    filename: s(),
    ...pagination,
  }, ["query"]),
  tool("github_get_file", "Read a repository file or directory through the Contents API.", { ...ownerRepo, path: s("Repository-relative path."), ref: s("Optional branch, tag, or SHA.") }, ["owner", "repo", "path"]),
  tool("github_put_file", "Create or update a repository file. Dry-run by default.", {
    ...ownerRepo,
    path: s("Repository-relative file path."),
    message: s("Commit message."),
    content: s("UTF-8 file content. Use content_base64 for pre-encoded content."),
    content_base64: s("Base64 file content."),
    sha: s("Existing file SHA when updating."),
    branch: s(),
    committer: obj(),
    author: obj(),
    confirm_write: b("Must be true to write the file."),
  }, ["owner", "repo", "path", "message"]),
  tool("github_delete_file", "Delete a repository file. Dry-run by default.", {
    ...ownerRepo,
    path: s(),
    message: s("Commit message."),
    sha: s("Current file SHA."),
    branch: s(),
    confirm_delete: b("Must be true to delete the file."),
  }, ["owner", "repo", "path", "message", "sha"]),

  tool("github_list_collaborators", "List repository collaborators.", { ...ownerRepo, affiliation: en(["outside", "direct", "all"]), permission: s(), ...pagination }, ["owner", "repo"]),
  tool("github_add_collaborator", "Add or invite a repository collaborator. Dry-run by default.", { ...ownerRepo, username: s(), permission: s(), confirm_write: b("Must be true to add the collaborator.") }, ["owner", "repo", "username"]),
  tool("github_remove_collaborator", "Remove a repository collaborator. Dry-run by default.", { ...ownerRepo, username: s(), confirm_delete: b("Must be true to remove the collaborator.") }, ["owner", "repo", "username"]),

  tool("github_list_issues", "List repository issues. Pull requests are filtered out by default.", {
    ...ownerRepo,
    state: en(["open", "closed", "all"]),
    labels: arr(),
    assignee: s(),
    milestone: s(),
    since: s("ISO timestamp."),
    sort: en(["created", "updated", "comments"]),
    direction: en(["asc", "desc"]),
    include_pull_requests: b(),
    ...pagination,
  }, ["owner", "repo"]),
  tool("github_get_issue", "Get an issue by number.", { ...ownerRepo, ...issueNumber }, ["owner", "repo", "issue_number"]),
  tool("github_create_issue", "Create an issue. Dry-run by default.", {
    ...ownerRepo,
    title: s(),
    body: s(`Optional issue body, max ${MAX_BODY_LENGTH} characters.`),
    labels: arr(),
    assignees: arr(),
    milestone: n(),
    confirm_create: b("Must be true to create the issue."),
  }, ["owner", "repo", "title"]),
  tool("github_update_issue", "Update issue title, body, state, labels, assignees, or milestone. Dry-run by default.", {
    ...ownerRepo,
    ...issueNumber,
    title: s(),
    body: s(),
    state: en(["open", "closed"]),
    state_reason: en(["completed", "not_planned", "reopened"]),
    labels: arr(),
    assignees: arr(),
    milestone: n(),
    confirm_update: b("Must be true to update the issue."),
  }, ["owner", "repo", "issue_number"]),
  tool("github_add_comment", "Add a comment to an issue or pull request. Dry-run by default.", {
    ...ownerRepo,
    ...issueNumber,
    body: s(`Comment body, max ${MAX_BODY_LENGTH} characters.`),
    confirm_create: b("Must be true to post the comment."),
  }, ["owner", "repo", "issue_number", "body"]),
  tool("github_list_comments", "List issue or pull request comments.", { ...ownerRepo, ...issueNumber, since: s(), ...pagination }, ["owner", "repo", "issue_number"]),
  tool("github_update_comment", "Update an issue comment. Dry-run by default.", { ...ownerRepo, comment_id: n(), body: s(), confirm_update: b("Must be true to update the comment.") }, ["owner", "repo", "comment_id", "body"]),
  tool("github_delete_comment", "Delete an issue comment. Dry-run by default.", { ...ownerRepo, comment_id: n(), confirm_delete: b("Must be true to delete the comment.") }, ["owner", "repo", "comment_id"]),

  tool("github_list_labels", "List repository labels.", { ...ownerRepo, ...pagination }, ["owner", "repo"]),
  tool("github_create_label", "Create a repository label. Dry-run by default.", { ...ownerRepo, name: s(), color: s("Hex color without #."), description: s(), confirm_create: b("Must be true to create the label.") }, ["owner", "repo", "name", "color"]),
  tool("github_update_label", "Update a repository label. Dry-run by default.", { ...ownerRepo, name: s(), new_name: s(), color: s(), description: s(), confirm_update: b("Must be true to update the label.") }, ["owner", "repo", "name"]),
  tool("github_delete_label", "Delete a repository label. Dry-run by default.", { ...ownerRepo, name: s(), confirm_delete: b("Must be true to delete the label.") }, ["owner", "repo", "name"]),
  tool("github_add_issue_labels", "Add labels to an issue. Dry-run by default.", { ...ownerRepo, ...issueNumber, labels: arr(), confirm_write: b("Must be true to add labels.") }, ["owner", "repo", "issue_number", "labels"]),
  tool("github_set_issue_labels", "Replace labels on an issue. Dry-run by default.", { ...ownerRepo, ...issueNumber, labels: arr(), confirm_write: b("Must be true to replace labels.") }, ["owner", "repo", "issue_number", "labels"]),
  tool("github_remove_issue_label", "Remove one label from an issue. Dry-run by default.", { ...ownerRepo, ...issueNumber, name: s(), confirm_delete: b("Must be true to remove the label.") }, ["owner", "repo", "issue_number", "name"]),

  tool("github_list_milestones", "List repository milestones.", { ...ownerRepo, state: en(["open", "closed", "all"]), sort: en(["due_on", "completeness"]), direction: en(["asc", "desc"]), ...pagination }, ["owner", "repo"]),
  tool("github_create_milestone", "Create a milestone. Dry-run by default.", { ...ownerRepo, title: s(), state: en(["open", "closed"]), description: s(), due_on: s(), confirm_create: b("Must be true to create the milestone.") }, ["owner", "repo", "title"]),
  tool("github_update_milestone", "Update a milestone. Dry-run by default.", { ...ownerRepo, milestone_number: n(), title: s(), state: en(["open", "closed"]), description: s(), due_on: s(), confirm_update: b("Must be true to update the milestone.") }, ["owner", "repo", "milestone_number"]),
  tool("github_delete_milestone", "Delete a milestone. Dry-run by default.", { ...ownerRepo, milestone_number: n(), confirm_delete: b("Must be true to delete the milestone.") }, ["owner", "repo", "milestone_number"]),

  tool("github_list_prs", "List pull requests for a repository.", { ...ownerRepo, state: en(["open", "closed", "all"]), head: s(), base: s(), sort: en(["created", "updated", "popularity", "long-running"]), direction: en(["asc", "desc"]), ...pagination }, ["owner", "repo"]),
  tool("github_get_pr", "Get a pull request by number.", { ...ownerRepo, ...pullNumber }, ["owner", "repo", "pull_number"]),
  tool("github_create_pr", "Create a pull request. Dry-run by default.", { ...ownerRepo, title: s(), head: s(), base: s(), body: s(), draft: b(), maintainer_can_modify: b(), confirm_create: b("Must be true to create the pull request.") }, ["owner", "repo", "title", "head", "base"]),
  tool("github_update_pr", "Update a pull request. Dry-run by default.", { ...ownerRepo, ...pullNumber, title: s(), body: s(), state: en(["open", "closed"]), base: s(), maintainer_can_modify: b(), confirm_update: b("Must be true to update the pull request.") }, ["owner", "repo", "pull_number"]),
  tool("github_merge_pr", "Merge a pull request. Dry-run by default.", { ...ownerRepo, ...pullNumber, commit_title: s(), commit_message: s(), sha: s(), merge_method: en(["merge", "squash", "rebase"]), confirm_merge: b("Must be true to merge the pull request.") }, ["owner", "repo", "pull_number"]),
  tool("github_list_pr_files", "List files changed in a pull request.", { ...ownerRepo, ...pullNumber, ...pagination }, ["owner", "repo", "pull_number"]),
  tool("github_list_pr_commits", "List commits in a pull request.", { ...ownerRepo, ...pullNumber, ...pagination }, ["owner", "repo", "pull_number"]),
  tool("github_list_pr_reviews", "List reviews on a pull request.", { ...ownerRepo, ...pullNumber, ...pagination }, ["owner", "repo", "pull_number"]),
  tool("github_create_pr_review", "Create a pull request review. Dry-run by default.", { ...ownerRepo, ...pullNumber, commit_id: s(), body: s(), event: en(["APPROVE", "REQUEST_CHANGES", "COMMENT"]), comments: arr("object"), confirm_create: b("Must be true to create the review.") }, ["owner", "repo", "pull_number"]),
  tool("github_request_pr_reviewers", "Request pull request reviewers. Dry-run by default.", { ...ownerRepo, ...pullNumber, reviewers: arr(), team_reviewers: arr(), confirm_write: b("Must be true to request reviewers.") }, ["owner", "repo", "pull_number"]),
  tool("github_remove_pr_reviewers", "Remove requested pull request reviewers. Dry-run by default.", { ...ownerRepo, ...pullNumber, reviewers: arr(), team_reviewers: arr(), confirm_delete: b("Must be true to remove reviewers.") }, ["owner", "repo", "pull_number"]),

  tool("github_list_releases", "List repository releases.", { ...ownerRepo, ...pagination }, ["owner", "repo"]),
  tool("github_get_release", "Get a release by release_id or tag.", { ...ownerRepo, release_id: n(), tag: s() }, ["owner", "repo"]),
  tool("github_create_release", "Create a release. Dry-run by default.", { ...ownerRepo, tag_name: s(), target_commitish: s(), name: s(), body: s(), draft: b(), prerelease: b(), generate_release_notes: b(), confirm_create: b("Must be true to create the release.") }, ["owner", "repo", "tag_name"]),
  tool("github_update_release", "Update a release. Dry-run by default.", { ...ownerRepo, release_id: n(), tag_name: s(), target_commitish: s(), name: s(), body: s(), draft: b(), prerelease: b(), make_latest: s(), confirm_update: b("Must be true to update the release.") }, ["owner", "repo", "release_id"]),
  tool("github_delete_release", "Delete a release. Dry-run by default.", { ...ownerRepo, release_id: n(), confirm_delete: b("Must be true to delete the release.") }, ["owner", "repo", "release_id"]),

  tool("github_list_workflows", "List GitHub Actions workflows.", { ...ownerRepo, ...pagination }, ["owner", "repo"]),
  tool("github_dispatch_workflow", "Dispatch a GitHub Actions workflow. Dry-run by default.", { ...ownerRepo, workflow_id: s("Workflow id, file name, or node id."), ref: s(), inputs: obj(), confirm_dispatch: b("Must be true to dispatch the workflow.") }, ["owner", "repo", "workflow_id", "ref"]),
  tool("github_list_workflow_runs", "List GitHub Actions workflow runs.", { ...ownerRepo, workflow_id: s("Optional workflow id or file name."), actor: s(), branch: s(), event: s(), status: s(), ...pagination }, ["owner", "repo"]),
  tool("github_get_workflow_run", "Get a GitHub Actions workflow run.", { ...ownerRepo, run_id: n() }, ["owner", "repo", "run_id"]),
  tool("github_rerun_workflow_run", "Rerun a GitHub Actions workflow run. Dry-run by default.", { ...ownerRepo, run_id: n(), confirm_dispatch: b("Must be true to rerun the workflow.") }, ["owner", "repo", "run_id"]),
  tool("github_cancel_workflow_run", "Cancel a GitHub Actions workflow run. Dry-run by default.", { ...ownerRepo, run_id: n(), confirm_cancel: b("Must be true to cancel the workflow.") }, ["owner", "repo", "run_id"]),
  tool("github_list_artifacts", "List repository or workflow-run artifacts.", { ...ownerRepo, run_id: n("Optional workflow run id."), name: s(), ...pagination }, ["owner", "repo"]),
  tool("github_delete_artifact", "Delete a GitHub Actions artifact. Dry-run by default.", { ...ownerRepo, artifact_id: n(), confirm_delete: b("Must be true to delete the artifact.") }, ["owner", "repo", "artifact_id"]),
];

const handlers: Record<string, Handler> = {
  github_rest_request: githubRestRequest,
  github_list_repos: listRepos,
  github_get_repo: getRepo,
  github_create_repo: createRepo,
  github_update_repo: updateRepo,
  github_delete_repo: deleteRepo,
  github_list_branches: listBranches,
  github_get_branch: getBranch,
  github_create_branch: createBranch,
  github_delete_branch: deleteBranch,
  github_search_code: searchCode,
  github_get_file: getFile,
  github_put_file: createOrUpdateFile,
  github_delete_file: deleteFile,
  github_list_collaborators: listCollaborators,
  github_add_collaborator: addCollaborator,
  github_remove_collaborator: removeCollaborator,
  github_list_issues: listIssues,
  github_get_issue: getIssue,
  github_create_issue: createIssue,
  github_update_issue: updateIssue,
  github_add_comment: addComment,
  github_list_comments: listComments,
  github_update_comment: updateComment,
  github_delete_comment: deleteComment,
  github_list_labels: listLabels,
  github_create_label: createLabel,
  github_update_label: updateLabel,
  github_delete_label: deleteLabel,
  github_add_issue_labels: addIssueLabels,
  github_set_issue_labels: setIssueLabels,
  github_remove_issue_label: removeIssueLabel,
  github_list_milestones: listMilestones,
  github_create_milestone: createMilestone,
  github_update_milestone: updateMilestone,
  github_delete_milestone: deleteMilestone,
  github_list_prs: listPullRequests,
  github_get_pr: getPullRequest,
  github_create_pr: createPullRequest,
  github_update_pr: updatePullRequest,
  github_merge_pr: mergePullRequest,
  github_list_pr_files: listPullRequestFiles,
  github_list_pr_commits: listPullRequestCommits,
  github_list_pr_reviews: listPullRequestReviews,
  github_create_pr_review: createPullRequestReview,
  github_request_pr_reviewers: requestPullRequestReviewers,
  github_remove_pr_reviewers: removePullRequestReviewers,
  github_list_releases: listReleases,
  github_get_release: getRelease,
  github_create_release: createRelease,
  github_update_release: updateRelease,
  github_delete_release: deleteRelease,
  github_list_workflows: listWorkflows,
  github_dispatch_workflow: dispatchWorkflow,
  github_list_workflow_runs: listWorkflowRuns,
  github_get_workflow_run: getWorkflowRun,
  github_rerun_workflow_run: rerunWorkflowRun,
  github_cancel_workflow_run: cancelWorkflowRun,
  github_list_artifacts: listArtifacts,
  github_delete_artifact: deleteArtifact,
};

function asText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function asError(error: unknown) {
  return {
    ...asText({ error: error instanceof Error ? error.message : String(error) }),
    isError: true,
  };
}

const server = new Server(
  { name: "github", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];

  if (!handler) {
    return asError(new Error(`Unknown tool: ${name}`));
  }

  try {
    return asText(await handler(args as ToolArgs));
  } catch (error) {
    return asError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
