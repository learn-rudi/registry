import {
  listManualDocuments,
  readManualDocument,
  searchManual,
} from "./manual.js";

export const HOSTED_ADAPTER_ID = "@rudi/swe-engineering-stack";
export const HOSTED_ADAPTER_VERSION = "0.2.0";

export const HOSTED_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "swe_manual_list",
    description: "List bundled SWE Operating Manual documents.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  }),
  Object.freeze({
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
  }),
  Object.freeze({
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
  }),
]);

export async function callHostedTool(name, args = {}) {
  switch (name) {
    case "swe_manual_list": {
      const { documents } = await listManualDocuments();
      return { documents };
    }
    case "swe_manual_read":
      return readManualDocument(args);
    case "swe_manual_search":
      return searchManual(args);
    default:
      throw new Error(`Hosted tool is not allowlisted: ${name}`);
  }
}
