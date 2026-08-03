#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { createMunicodeClient, MunicodeError } from "./core.js";

const TOOLS = Object.freeze([
  {
    description: "Return one fixed-job, release-configured reviewed baseline Cincinnati zoning-code evidence bundle from complete CAGIS zoning context. This is source evidence, not legal advice or a completeness determination.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        operationInput: {
          additionalProperties: false,
          properties: {
            jurisdiction: { const: "cincinnati-oh", type: "string" },
            proposedUseCategory: {
              enum: [
                "restaurant_full_service",
                "restaurant_limited_service"
              ],
              type: "string"
            },
            schemaVersion: { const: 1, type: "integer" },
            selectorPolicyId: {
              const: "cincinnati-restaurant-zoning-evidence-v1",
              type: "string"
            }
          },
          required: [
            "jurisdiction",
            "proposedUseCategory",
            "schemaVersion",
            "selectorPolicyId"
          ],
          type: "object"
        },
        cagisContext: {
          additionalProperties: false,
          properties: {
            auditorParcelId: {
              anyOf: [
                { maxLength: 100, minLength: 1, type: "string" },
                { type: "null" }
              ]
            },
            parcelKey: {
              anyOf: [
                { maxLength: 100, minLength: 1, type: "string" },
                { type: "null" }
              ]
            },
            provider: { const: "cagis", type: "string" },
            resultSha256: { pattern: "^[0-9a-f]{64}$", type: "string" },
            retrievedAt: { format: "date-time", type: "string" },
            sourceUrl: { format: "uri", maxLength: 2000, type: "string" },
            zoningCode: { maxLength: 200, minLength: 1, type: "string" },
            zoningContextComplete: { const: true, type: "boolean" },
            zoningFetchedAt: { format: "date-time", type: "string" },
            zoningOverlayDistrictNames: {
              items: { maxLength: 300, minLength: 1, type: "string" },
              maxItems: 10,
              type: "array",
              uniqueItems: true
            },
            zoningSource: { maxLength: 200, minLength: 1, type: "string" }
          },
          required: [
            "auditorParcelId",
            "parcelKey",
            "provider",
            "resultSha256",
            "retrievedAt",
            "sourceUrl",
            "zoningCode",
            "zoningContextComplete",
            "zoningFetchedAt",
            "zoningOverlayDistrictNames",
            "zoningSource"
          ],
          type: "object"
        }
      },
      required: ["operationInput", "cagisContext"],
      type: "object"
    },
    name: "municode_get_reviewed_zoning_evidence_bundle"
  }
]);

const client = createMunicodeClient();
const server = new Server(
  { name: "rudi-municode", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const arguments_ = request.params.arguments;
    const result = request.params.name
      === "municode_get_reviewed_zoning_evidence_bundle"
      ? await client.getReviewedZoningEvidenceBundle(arguments_)
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
