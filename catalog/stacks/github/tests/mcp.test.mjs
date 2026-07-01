import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes GitHub stack tools", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITHUB_TOKEN: "",
    },
  });
  const client = new Client(
    { name: "github-stack-test", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, [
      "github_add_collaborator",
      "github_add_comment",
      "github_add_issue_labels",
      "github_cancel_workflow_run",
      "github_create_branch",
      "github_create_issue",
      "github_create_label",
      "github_create_milestone",
      "github_create_pr",
      "github_create_pr_review",
      "github_create_release",
      "github_create_repo",
      "github_delete_artifact",
      "github_delete_branch",
      "github_delete_comment",
      "github_delete_file",
      "github_delete_label",
      "github_delete_milestone",
      "github_delete_release",
      "github_delete_repo",
      "github_dispatch_workflow",
      "github_get_branch",
      "github_get_file",
      "github_get_issue",
      "github_get_pr",
      "github_get_release",
      "github_get_repo",
      "github_get_workflow_run",
      "github_list_artifacts",
      "github_list_branches",
      "github_list_collaborators",
      "github_list_comments",
      "github_list_issues",
      "github_list_labels",
      "github_list_milestones",
      "github_list_pr_commits",
      "github_list_pr_files",
      "github_list_pr_reviews",
      "github_list_prs",
      "github_list_releases",
      "github_list_repos",
      "github_list_workflow_runs",
      "github_list_workflows",
      "github_merge_pr",
      "github_put_file",
      "github_remove_collaborator",
      "github_remove_issue_label",
      "github_remove_pr_reviewers",
      "github_request_pr_reviewers",
      "github_rerun_workflow_run",
      "github_rest_request",
      "github_search_code",
      "github_set_issue_labels",
      "github_update_comment",
      "github_update_issue",
      "github_update_label",
      "github_update_milestone",
      "github_update_pr",
      "github_update_release",
      "github_update_repo",
    ]);

    const missingToken = await client.callTool({
      name: "github_list_repos",
      arguments: {},
    });
    assert.equal(missingToken.isError, true);
    assert.match(missingToken.content[0].text, /GITHUB_TOKEN/);
  } finally {
    await client.close();
  }
});
