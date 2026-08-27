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
  listRepositoryCloseouts,
  preflightRepoSteward,
  recordRepositoryAction,
  recordRepositoryCloseout,
  recordRepositoryVerification,
  releaseRepositoryLease,
  scanFleet,
} from "./core.js";

const CLOSEOUT_STATES = [
  "observed",
  "classified",
  "preservation_required",
  "retained",
  "archive_eligible",
  "cleanup_pending_approval",
  "cleanup_approved",
  "blocked",
];

const VALIDATION_EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["command", "outcome", "summary", "at"],
  properties: {
    command: { type: "string", minLength: 1, maxLength: 500 },
    outcome: { type: "string", enum: ["passed", "failed", "skipped"] },
    exit_code: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 255 },
        { type: "null" },
      ],
    },
    summary: { type: "string", minLength: 1, maxLength: 2000 },
    at: { type: "string", minLength: 1, maxLength: 64 },
  },
};

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
    name: "repo_steward_list_closeouts",
    description: "List versioned local worktree-closeout receipts for one configured repository. This reads Repo Steward state only and performs no Git mutation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["repo_id"],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        state: { type: "string", enum: CLOSEOUT_STATES },
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
    name: "repo_steward_record_closeout",
    description: "Create or transition one lease-bound worktree-closeout receipt. It records repository state, lineage, evidence, disposition, preservation, and approval references but never cleans, archives, deletes, or otherwise mutates a repository.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "repo_id",
        "owner",
        "lease_id",
        "receipt_id",
        "state",
        "expected_version",
      ],
      properties: {
        repo_id: { type: "string", minLength: 1, maxLength: 128 },
        owner: { type: "string", minLength: 1, maxLength: 128 },
        lease_id: { type: "string", minLength: 36, maxLength: 36 },
        receipt_id: { type: "string", minLength: 1, maxLength: 128 },
        state: { type: "string", enum: CLOSEOUT_STATES },
        expected_version: { type: "integer", minimum: 0 },
        base_ref: { type: "string", minLength: 1, maxLength: 256 },
        task_lineage: {
          type: "object",
          additionalProperties: false,
          required: ["task_id"],
          properties: {
            task_id: { type: "string", minLength: 1, maxLength: 256 },
            source_thread_id: { type: "string", minLength: 1, maxLength: 256 },
            plan_id: { type: "string", minLength: 1, maxLength: 256 },
            node_id: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
        agent_lineage: {
          type: "object",
          additionalProperties: false,
          required: ["agent_id"],
          properties: {
            agent_id: { type: "string", minLength: 1, maxLength: 256 },
            host: { type: "string", minLength: 1, maxLength: 256 },
            attempt_id: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
        acceptance_reference: { type: "string", minLength: 1, maxLength: 1000 },
        validation_evidence: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: VALIDATION_EVIDENCE_SCHEMA,
        },
        preservation_requirements: {
          type: "array",
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 1000 },
        },
        summary: { type: "string", minLength: 1, maxLength: 2000 },
        classification: {
          type: "string",
          enum: ["active", "superseded", "retained", "archive_candidate", "unknown"],
        },
        disposition_summary: { type: "string", minLength: 1, maxLength: 2000 },
        approval_reference: { type: "string", minLength: 1, maxLength: 1000 },
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
    { name: "repo-steward", version: "0.3.0" },
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
        case "repo_steward_list_closeouts":
          return jsonResponse(await listRepositoryCloseouts(args, coreOptions));
        case "repo_steward_record_action":
          return jsonResponse(await recordRepositoryAction(args, coreOptions));
        case "repo_steward_record_closeout":
          return jsonResponse(await recordRepositoryCloseout(args, coreOptions));
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
