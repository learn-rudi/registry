#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createOpenCounterService } from "./core.mjs";
import { createPlaywrightOpenCounterDriver } from "./playwright-driver.mjs";
import { createEncryptedStateStore } from "./encrypted-state-store.mjs";

const tools = [
  { name: "opencounter_start_guidance", description: "Start one anonymous Cincinnati OpenCounter guidance run and return either a bounded question checkpoint or result.", required: ["address", "jurisdiction", "proposedUse", "workflow"], properties: { address: { type: "string" }, jurisdiction: { const: "cincinnati-oh" }, proposedUse: { type: "string" }, workflow: { enum: ["zoning", "business", "special_events", "residential"] } } },
  { name: "opencounter_continue_guidance", description: "Resume one OpenCounter project with exact answers to its active checkpoint.", required: ["answers", "checkpointSha256", "providerReference"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, properties: { questionId: { type: "string" }, value: { type: "string" } }, required: ["questionId", "value"] } }, checkpointSha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, providerReference: { type: "string" } } },
  { name: "opencounter_get_guidance_result", description: "Read the current bounded result for an OpenCounter project.", required: ["providerReference"], properties: { providerReference: { type: "string" } } },
  { name: "opencounter_reconcile_guidance", description: "Reconcile an uncertain OpenCounter dispatch without creating another project.", required: ["providerReference"], properties: { providerReference: { type: "string" } } }
];
const stateStore = createEncryptedStateStore({
  encryptionKey: process.env.OPENCOUNTER_SESSION_ENCRYPTION_KEY,
  ...(process.env.OPENCOUNTER_STATE_DIRECTORY
    ? { stateDirectory: process.env.OPENCOUNTER_STATE_DIRECTORY }
    : {})
});
const service = createOpenCounterService({
  driver: createPlaywrightOpenCounterDriver({ stateStore })
});
const server = new Server({ name: "rudi-opencounter", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { type: "object", additionalProperties: false, properties: tool.properties, required: tool.required }
})) }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments;
  const result = request.params.name === "opencounter_start_guidance"
    ? await service.startGuidance(args)
    : request.params.name === "opencounter_continue_guidance"
      ? await service.continueGuidance(args)
      : request.params.name === "opencounter_get_guidance_result"
        ? await service.getGuidanceResult(args)
        : request.params.name === "opencounter_reconcile_guidance"
          ? await service.reconcileGuidance(args)
          : (() => { throw new Error("Unknown OpenCounter tool."); })();
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
await server.connect(new StdioServerTransport());
