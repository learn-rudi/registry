#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  acquireRepositoryLease,
  discoverRepositories,
  enrollRepositoryRoot,
  getRepositoryStatus,
  listRepositoryActions,
  preflightRepoSteward,
  recordRepositoryAction,
  recordRepositoryVerification,
  releaseRepositoryLease,
  scanFleet,
} from "./core.js";

const TOOL_DEFINITIONS = [
  {
    name: "repo_steward_preflight",
    description: "Validate Repo Steward configuration, Git availability, exact repository roots, and local state readiness without changing a repository.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "repo_steward_enroll_root",
    description: "Persist one absolute workspace root under local RUDI state and immediately discover its nested Git worktrees. This changes stewardship configuration only, never a repository.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["root_path", "owner"],
      properties: {
        root_id: { type: "string", minLength: 1, maxLength: 128 },
        root_path: { type: "string", minLength: 1, maxLength: 4096 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        fetch_allowed: { type: "boolean", default: false },
        max_depth: { type: "integer", minimum: 0, maximum: 32, default: 12 },
      },
    },
  },
  {
    name: "repo_steward_discover_repositories",
    description: "Rediscover nested Git worktrees beneath configured roots without reading repository file contents or changing Git state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        root_ids: {
          type: "array",
          maxItems: 1000,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
    },
  },
  {
    name: "repo_steward_scan_fleet",
    description: "Inspect configured repositories and summarize dirty, ahead, behind, diverged, and failed states. Fetch occurs only when explicitly requested and policy-allowed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        repo_ids: {
          type: "array",
          maxItems: 1000,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        fetch: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "repo_steward_get_status",
    description: "Read normalized Git state for one configured repository. This tool never stages, commits, pushes, merges, resets, cleans, or changes GitHub.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repo_id"],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        fetch: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "repo_steward_acquire_lease",
    description: "Acquire one bounded local stewardship lease for a configured repository before an agent records or performs repository work.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repo_id", "owner"],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        ttl_seconds: { type: "integer", minimum: 30, maximum: 3600, default: 300 },
      },
    },
  },
  {
    name: "repo_steward_release_lease",
    description: "Release an active repository lease when owner and lease identity match exactly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repo_id", "owner", "lease_id"],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        lease_id: { type: "string", minLength: 36, maxLength: 36 },
      },
    },
  },
  {
    name: "repo_steward_list_actions",
    description: "List durable local stewardship actions for one configured repository, optionally filtered by kind or status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repo_id"],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        status: {
          type: "string",
          enum: ["proposed", "approved", "running", "completed", "blocked", "cancelled"],
        },
        kind: {
          type: "string",
          enum: ["checkpoint", "issue", "repair", "review", "reconcile", "draft_pr"],
        },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
    },
  },
  {
    name: "repo_steward_record_action",
    description: "Create or transition one lease-bound local action using an expected version. This records intent only and never performs Git or GitHub mutations.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "repo_id",
        "owner",
        "lease_id",
        "action_id",
        "status",
        "expected_version"
      ],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        lease_id: { type: "string", minLength: 36, maxLength: 36 },
        action_id: { type: "string", minLength: 1, maxLength: 128 },
        kind: {
          type: "string",
          enum: ["checkpoint", "issue", "repair", "review", "reconcile", "draft_pr"],
        },
        status: {
          type: "string",
          enum: ["proposed", "approved", "running", "completed", "blocked", "cancelled"],
        },
        summary: { type: "string", minLength: 1, maxLength: 2000 },
        source_head: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_version: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "repo_steward_record_verification",
    description: "Append bounded verification evidence to a running lease-bound action. The caller executes the command; this tool records only the result.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "repo_id",
        "owner",
        "lease_id",
        "action_id",
        "expected_version",
        "command",
        "outcome",
        "summary"
      ],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        lease_id: { type: "string", minLength: 36, maxLength: 36 },
        action_id: { type: "string", minLength: 1, maxLength: 128 },
        expected_version: { type: "integer", minimum: 1 },
        command: { type: "string", minLength: 1, maxLength: 500 },
        outcome: { type: "string", enum: ["passed", "failed", "skipped"] },
        exit_code: {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 255 },
            { type: "null" }
          ]
        },
        summary: { type: "string", minLength: 1, maxLength: 2000 },
      },
    },
  },
];

function jsonResponse(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResponse(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    }],
  };
}

export function createServer(coreOptions = {}) {
  const server = new Server(
    { name: "repo-steward", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      switch (request.params.name) {
        case "repo_steward_preflight":
          return jsonResponse(await preflightRepoSteward(args, coreOptions));
        case "repo_steward_enroll_root":
          return jsonResponse(await enrollRepositoryRoot(args, coreOptions));
        case "repo_steward_discover_repositories":
          return jsonResponse(await discoverRepositories(args, coreOptions));
        case "repo_steward_scan_fleet":
          return jsonResponse(await scanFleet(args, coreOptions));
        case "repo_steward_get_status":
          return jsonResponse(await getRepositoryStatus(args, coreOptions));
        case "repo_steward_acquire_lease":
          return jsonResponse(await acquireRepositoryLease(args, coreOptions));
        case "repo_steward_release_lease":
          return jsonResponse(await releaseRepositoryLease(args, coreOptions));
        case "repo_steward_list_actions":
          return jsonResponse(await listRepositoryActions(args, coreOptions));
        case "repo_steward_record_action":
          return jsonResponse(await recordRepositoryAction(args, coreOptions));
        case "repo_steward_record_verification":
          return jsonResponse(await recordRepositoryVerification(args, coreOptions));
        default:
          return errorResponse(new Error(`Unknown tool: ${request.params.name}`));
      }
    } catch (error) {
      return errorResponse(error);
    }
  });
  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
