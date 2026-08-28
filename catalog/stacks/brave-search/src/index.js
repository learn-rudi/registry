#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { BraveSearchError, createBraveSearchClient } from "./core.js";

const TOOL_NAME = "brave_web_search";
const tool = {
  name: TOOL_NAME,
  description: "Search the Brave web index through a read-only, secret-mediated provider request.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      count: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        default: 10,
        description: "Maximum web results to return from one provider request.",
      },
      freshness: {
        type: "string",
        description: "Optional pd, pw, pm, py, or YYYY-MM-DDtoYYYY-MM-DD freshness filter.",
      },
      query: {
        type: "string",
        minLength: 1,
        maxLength: 400,
        description: "Brave web search query, with at most 50 words.",
      },
      timeout_seconds: {
        type: "number",
        minimum: 0.1,
        maximum: 25,
        default: 10,
        description: "Bounded provider request timeout with router overhead reserved.",
      },
    },
    required: ["query"],
  },
};

const server = new Server(
  { name: "rudi-brave-search", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_NAME) throw new Error("Unknown Brave Search tool.");
  try {
    const client = createBraveSearchClient({ apiKey: process.env.BRAVE_SEARCH_API_KEY });
    const result = await client.searchWeb(request.params.arguments);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    if (!(error instanceof BraveSearchError)) throw error;
    const safeError = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      status: error.status,
    };
    const structuredContent = { error: safeError };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      isError: true,
      structuredContent,
    };
  }
});

await server.connect(new StdioServerTransport());
