#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { createMunicodeClient, MunicodeError } from "./core.js";

const JURISDICTION_SCHEMA = {
  const: "cincinnati-oh",
  description: "Reviewed Municode jurisdiction profile. Cincinnati, Ohio is the first supported profile.",
  type: "string"
};

const TOOLS = Object.freeze([
  {
    description: "Return the current published Municode code-edition identity and provenance for one reviewed jurisdiction.",
    inputSchema: {
      additionalProperties: false,
      properties: { jurisdiction: JURISDICTION_SCHEMA },
      required: ["jurisdiction"],
      type: "object"
    },
    name: "municode_get_publication"
  },
  {
    description: "List one bounded page of direct child code sections under a Municode node for one reviewed jurisdiction.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        cursor: {
          description: "Optional decimal offset cursor returned by the previous page.",
          maxLength: 9,
          pattern: "^[0-9]+$",
          type: "string"
        },
        jurisdiction: JURISDICTION_SCHEMA,
        limit: {
          default: 50,
          maximum: 100,
          minimum: 1,
          type: "integer"
        },
        parentNodeId: {
          description: "Municode node identifier inside the reviewed jurisdiction's fixed code product.",
          maxLength: 300,
          minLength: 1,
          type: "string"
        }
      },
      required: ["jurisdiction", "parentNodeId"],
      type: "object"
    },
    name: "municode_list_code_sections"
  },
  {
    description: "Return bounded normalized text and publication provenance for one Municode code section in a reviewed jurisdiction.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        jurisdiction: JURISDICTION_SCHEMA,
        nodeId: {
          description: "Municode node identifier inside the reviewed jurisdiction's fixed code product.",
          maxLength: 300,
          minLength: 1,
          type: "string"
        }
      },
      required: ["jurisdiction", "nodeId"],
      type: "object"
    },
    name: "municode_get_code_section"
  }
]);

const client = createMunicodeClient();
const server = new Server(
  { name: "rudi-municode", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const arguments_ = request.params.arguments;
    const result = request.params.name === "municode_get_publication"
      ? await client.getPublication(arguments_)
      : request.params.name === "municode_list_code_sections"
        ? await client.listCodeSections(arguments_)
        : request.params.name === "municode_get_code_section"
          ? await client.getCodeSection(arguments_)
          : null;
    if (result === null) {
      throw new MunicodeError("unknown_tool", "The requested Municode tool is not registered.");
    }
    return { content: [{ text: JSON.stringify(result), type: "text" }] };
  } catch (error) {
    const payload = errorPayload(error);
    return {
      content: [{ text: JSON.stringify(payload), type: "text" }],
      isError: true
    };
  }
});

await server.connect(new StdioServerTransport());

function errorPayload(error) {
  if (error instanceof MunicodeError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable
      },
      schemaVersion: 1,
      source: "municode",
      status: "error"
    };
  }
  return {
    error: {
      code: "internal_error",
      message: "The Municode stack encountered an unexpected error.",
      retryable: false
    },
    schemaVersion: 1,
    source: "municode",
    status: "error"
  };
}
