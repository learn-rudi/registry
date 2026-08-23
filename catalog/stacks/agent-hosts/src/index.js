#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { AgentHostError, createAgentHostService } from "./core.js";
import { createLocalAgentHostAdapters } from "./local-registry.js";
import { AGENT_HOST_TOOL_DEFINITIONS, callAgentHostTool } from "./tool-contract.js";

const service = createAgentHostService({ adapters: createLocalAgentHostAdapters() });
const server = new Server(
  { name: "agent-hosts", version: "0.1.2" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: AGENT_HOST_TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await callAgentHostTool(
      service,
      request.params.name,
      request.params.arguments ?? {}
    );
    return jsonResponse(result);
  } catch (error) {
    const known = error instanceof AgentHostError;
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code: known ? error.code : "internal_error",
            message: known ? error.message : "Agent Host request failed.",
          },
        }),
      }],
    };
  }
});

await server.connect(new StdioServerTransport());

function jsonResponse(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}
