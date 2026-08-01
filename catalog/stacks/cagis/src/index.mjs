#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createCagisClient } from "./core.mjs";

const server = new Server({ name: "rudi-cagis", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: "cagis_lookup_property_activity",
  description: "Read parcel, zoning, and related CAGIS facts for one Cincinnati address.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      address: { type: "string", minLength: 1, maxLength: 500 },
      jurisdiction: { type: "string", const: "cincinnati-oh" }
    },
    required: ["address", "jurisdiction"]
  }
}] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "cagis_lookup_property_activity") {
    throw new Error("Unknown CAGIS tool.");
  }
  const client = createCagisClient({
    apiKey: process.env.CINCINNATI_PUBLIC_DATA_API_KEY,
    baseUrl: process.env.CINCINNATI_PUBLIC_DATA_API_BASE_URL
  });
  const result = await client.lookupPropertyActivity(request.params.arguments);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
await server.connect(new StdioServerTransport());
