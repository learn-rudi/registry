#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  SitePlannerStackError,
  assertRuntimeReady,
  executeSitePlannerOperation,
  loadConfiguration,
} from "./core.js";

const TOOL_OPERATIONS = new Map([
  ["site_planner_inspect_concept", "inspectConcept"],
  ["site_planner_generate_lot_plan", "generateLotPlan"],
  ["site_planner_optimize_lot_plan", "optimizeLotPlan"],
  ["site_planner_preview_concept_commands", "previewConceptCommands"],
  ["site_planner_fork_concept", "forkConcept"],
  ["site_planner_apply_concept_commands", "applyConceptCommands"],
]);
const WRITE_TOOLS = new Set([
  "site_planner_fork_concept",
  "site_planner_apply_concept_commands",
]);
const TOOL_DEFINITIONS = [
  {
    name: "site_planner_config_status",
    description:
      "Verify the fixed Site Planner checkout, exact configured Git commit, Node runtime, workspace, and artifact roots without returning private paths.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  readTool(
    "site_planner_inspect_concept",
    "Inspect one explicit durable Site Planner Concept head. Read-only.",
  ),
  readTool(
    "site_planner_generate_lot_plan",
    "Generate a deterministic proposed Lot Plan from one explicit measured source Concept. Read-only; does not create a revision or make zoning claims.",
  ),
  readTool(
    "site_planner_optimize_lot_plan",
    "Run the bounded deterministic Site Planner Lot Plan search for one explicit measured source Concept. Read-only; not exhaustive optimization, zoning, entitlement, or underwriting.",
  ),
  readTool(
    "site_planner_preview_concept_commands",
    "Preview validated Concept commands against an explicit observed revision without writing.",
  ),
  writeTool(
    "site_planner_fork_concept",
    "Create one immutable alternative Concept revision only with a request-bound Service Desk write authorization.",
  ),
  writeTool(
    "site_planner_apply_concept_commands",
    "Apply validated commands to one explicit Concept revision only with a request-bound Service Desk write authorization.",
  ),
];

const server = new Server(
  {
    name: "site-planner",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const toolName = request.params.name;
    const arguments_ = request.params.arguments ?? {};

    if (toolName === "site_planner_config_status") {
      assertExactArgumentKeys(arguments_, []);
      const configuration = loadConfiguration();
      const runtime = await assertRuntimeReady(configuration);
      return jsonResponse({
        commit: runtime.commit,
        nodeVersion: runtime.nodeVersion,
        ready: true,
        schemaVersion: 1,
        status: "succeeded",
      });
    }

    const operation = TOOL_OPERATIONS.get(toolName);
    if (!operation) {
      throw new SitePlannerStackError(
        "unknown_tool",
        "Site Planner tool is not registered.",
      );
    }

    const isWrite = WRITE_TOOLS.has(toolName);
    assertExactArgumentKeys(
      arguments_,
      isWrite ? ["request", "write_authorization"] : ["request"],
    );
    const requestOperation = arguments_.request?.operation;
    if (requestOperation !== operation) {
      throw new SitePlannerStackError(
        "operation_mismatch",
        "Site Planner tool does not match the request operation.",
      );
    }
    const configuration = loadConfiguration();
    const writeKey = isWrite
      ? readWriteKey(process.env.SITE_PLANNER_WRITE_HMAC_V1)
      : undefined;
    let execution;
    try {
      execution = await executeSitePlannerOperation({
        configuration,
        request: arguments_.request,
        ...(isWrite
          ? {
              writeAuthorization: arguments_.write_authorization,
              writeKey,
            }
          : {}),
      });
    } finally {
      writeKey?.fill(0);
    }

    return jsonResponse({
      artifact: execution.artifact,
      result: execution.result,
      runtime: execution.runtime,
      schemaVersion: 1,
      status: "succeeded",
    });
  } catch (error) {
    const known = error instanceof SitePlannerStackError;
    return errorResponse({
      code: known ? error.code : "internal_error",
      message: known
        ? error.message
        : "Site Planner adapter failed.",
      schemaVersion: 1,
      status: "failed",
    });
  }
});

await server.connect(new StdioServerTransport());

function readTool(name, description) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: {
          type: "object",
          description:
            "Versioned Site Planner agent-operation request. The adapter supplies the trusted fixed workspace root.",
        },
      },
    },
  };
}

function writeTool(name, description) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request", "write_authorization"],
      properties: {
        request: {
          type: "object",
          description:
            "Versioned Site Planner write request with stable clientRequestId and explicit expected revision.",
        },
        write_authorization: {
          type: "object",
          additionalProperties: false,
          required: [
            "schemaVersion",
            "keyVersion",
            "approvalDecisionId",
            "approvedOperationId",
            "expiresAt",
            "requestDigest",
            "signature",
          ],
          properties: {
            schemaVersion: { type: "integer", const: 1 },
            keyVersion: { type: "integer", const: 1 },
            approvalDecisionId: {
              type: "string",
              minLength: 1,
              maxLength: 200,
            },
            approvedOperationId: {
              type: "string",
              minLength: 1,
              maxLength: 200,
            },
            expiresAt: { type: "string", minLength: 20, maxLength: 35 },
            requestDigest: {
              type: "string",
              pattern: "^[a-f0-9]{64}$",
            },
            signature: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{43}$",
            },
          },
        },
      },
    },
  };
}

function assertExactArgumentKeys(value, expectedKeys) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new SitePlannerStackError(
      "invalid_arguments",
      "Site Planner tool arguments must be an object.",
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new SitePlannerStackError(
      "invalid_arguments",
      "Site Planner tool arguments contain missing or unsupported fields.",
    );
  }
}

function readWriteKey(value) {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(value)
  ) {
    throw new SitePlannerStackError(
      "write_authorization_unavailable",
      "Site Planner write authorization key is unavailable.",
    );
  }
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) {
    key.fill(0);
    throw new SitePlannerStackError(
      "write_authorization_unavailable",
      "Site Planner write authorization key is invalid.",
    );
  }
  return key;
}

function jsonResponse(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value),
      },
    ],
  };
}

function errorResponse(value) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(value),
      },
    ],
  };
}
