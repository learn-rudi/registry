#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  listManualDocuments,
  readManualDocument,
  runDebtScan,
  searchManual,
} from "./core.js";

const server = new Server(
  {
    name: "swe-engineering",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

function jsonResponse(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResponse(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "swe_manual_list",
      description: "List bundled SWE Operating Manual documents.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "swe_manual_read",
      description: "Read one bundled SWE Operating Manual document by id or filename.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["document"],
        properties: {
          document: {
            type: "string",
            description: "Document id or filename from swe_manual_list.",
          },
          max_chars: {
            type: "integer",
            minimum: 1,
            maximum: 200000,
            description: "Maximum characters to return.",
          },
        },
      },
    },
    {
      name: "swe_manual_search",
      description: "Search bundled SWE Operating Manual documents for a phrase.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Case-insensitive phrase to search for.",
          },
          document: {
            type: "string",
            description: "Optional document id or filename from swe_manual_list.",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum matching lines to return.",
          },
        },
      },
    },
    {
      name: "swe_debt_scan",
      description: "Run the packaged JS/TS agent debt scanner against a local repository.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["repo"],
        properties: {
          repo: { type: "string", description: "Local repository root to scan." },
          graph_root: { type: "string", description: "Graph root within repo." },
          scope: { type: "string", description: "Report scope within repo." },
          profile: { type: "string", description: "Named profile from debt scan config." },
          config: { type: "string", description: "Path to debt scan config." },
          layer: { type: "string", description: "Restrict findings to one layer." },
          changed_since: { type: "string", description: "Git ref for changed-file scan." },
          severity: { type: "string", description: "Minimum severity: info, warning, or error." },
          checks: { type: "array", items: { type: "string" } },
          entrypoints: { type: "array", items: { type: "string" } },
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
          files: { type: "array", items: { type: "string" } },
          heuristics: { type: "boolean" },
          json: { type: "boolean", description: "Return scanner JSON output. Defaults to true." },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 300000 },
          max_output_chars: { type: "integer", minimum: 1000, maximum: 2000000 },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};

  try {
    switch (request.params.name) {
      case "swe_manual_list":
        return jsonResponse(await listManualDocuments());
      case "swe_manual_read":
        return jsonResponse(await readManualDocument(args));
      case "swe_manual_search":
        return jsonResponse(await searchManual(args));
      case "swe_debt_scan":
        return jsonResponse(await runDebtScan(args));
      default:
        return errorResponse(new Error(`Unknown tool: ${request.params.name}`));
    }
  } catch (error) {
    return errorResponse(error);
  }
});

await server.connect(new StdioServerTransport());
