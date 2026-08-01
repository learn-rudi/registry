#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createAuditorClient } from "./core.mjs";

const server = new Server({ name: "rudi-hamilton-county-auditor", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: "auditor_lookup_parcel_facts",
  description: "Read authoritative Hamilton County Auditor facts for one parcel identity.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      auditorParcelId: { type: "string", minLength: 1, maxLength: 100 },
      parcelKey: { type: "string", minLength: 1, maxLength: 100 },
      jurisdiction: { type: "string", const: "hamilton-county-oh" }
    },
    required: ["jurisdiction"]
  }
}] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "auditor_lookup_parcel_facts") throw new Error("Unknown Auditor tool.");
  const client = createAuditorClient({
    apiKey: process.env.CINCINNATI_PUBLIC_DATA_API_KEY,
    baseUrl: process.env.CINCINNATI_PUBLIC_DATA_API_BASE_URL
  });
  const result = await client.lookupParcelFacts(request.params.arguments);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
await server.connect(new StdioServerTransport());
