#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createOpenCounterService,
  createOpenCounterToolResponse
} from "./core.mjs";
import { createOpenCounterArtifactStore } from "./artifact-store.mjs";
import { createPlaywrightOpenCounterDriver } from "./playwright-driver.mjs";
import { createEncryptedStateStore } from "./encrypted-state-store.mjs";
import { loadZoningCatalog } from "./zoning-catalog.mjs";

const tools = [
  { name: "opencounter_get_zoning_use_catalog", description: "Read the closed, versioned Cincinnati OpenCounter Zoning proposed-use catalog packaged with this stack.", required: [], properties: {} },
  { name: "opencounter_start_zoning_guidance", description: "Start one Cincinnati OpenCounter Zoning run from an exact admitted catalog entry after a read-only provider fingerprint preflight; requester checkpoints include their required checkpointSha256.", required: ["address", "catalogEntryId", "catalogId", "jurisdiction", "schemaVersion"], properties: { address: { type: "string", minLength: 1, maxLength: 500 }, catalogEntryId: { type: "string", pattern: "^[a-z0-9_]+(?:\\.[a-z0-9_]+)+$", maxLength: 200 }, catalogId: { const: "cincinnati-opencounter-zoning-use-catalog-v1" }, jurisdiction: { const: "cincinnati-oh" }, schemaVersion: { const: 1 } } },
  { name: "opencounter_reconcile_zoning_start", description: "Owner-authorized low-level primitive that re-establishes one exact catalog-bound Zoning start on the same surviving project without creating a replacement. Service Desk must separately register and fence any lifecycle use.", required: ["address", "catalogEntryId", "catalogId", "jurisdiction", "providerInputSha256", "providerReference", "schemaVersion"], properties: { address: { type: "string", minLength: 1, maxLength: 500 }, catalogEntryId: { type: "string", pattern: "^[a-z0-9_]+(?:\\.[a-z0-9_]+)+$", maxLength: 200 }, catalogId: { const: "cincinnati-opencounter-zoning-use-catalog-v1" }, jurisdiction: { const: "cincinnati-oh" }, providerInputSha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, providerReference: { type: "string", pattern: "^opencounter:project:[0-9]{1,20}$" }, schemaVersion: { const: 1 } } },
  { name: "opencounter_start_guidance", description: "Start one anonymous Cincinnati OpenCounter guidance run and return either a bounded question checkpoint or result.", required: ["address", "jurisdiction", "proposedUse", "workflow"], properties: { address: { type: "string" }, jurisdiction: { const: "cincinnati-oh" }, proposedUse: { type: "string" }, workflow: { enum: ["zoning", "business", "special_events", "residential"] } } },
  { name: "opencounter_continue_guidance", description: "Resume one OpenCounter project with exact answers to its encrypted active checkpoint; matching provider values are not replayed, and completion returns the persisted provider PDF artifact.", required: ["answers", "checkpointSha256", "providerReference"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, properties: { questionId: { type: "string" }, value: { type: "string" } }, required: ["questionId", "value"] } }, checkpointSha256: { type: "string", pattern: "^[0-9a-f]{64}$" }, providerReference: { type: "string" } } },
  { name: "opencounter_export_guidance", description: "Export the provider-generated PDF for one completed OpenCounter project to the bounded local RUDI artifact store.", required: ["providerReference"], properties: { providerReference: { type: "string", pattern: "^opencounter:project:[0-9]{1,20}$" } } },
  { name: "opencounter_get_guidance_result", description: "Read the current bounded result for an OpenCounter project.", required: ["providerReference"], properties: { providerReference: { type: "string" } } },
  { name: "opencounter_reconcile_guidance", description: "Reconcile an uncertain OpenCounter dispatch without creating another project.", required: ["providerReference"], properties: { providerReference: { type: "string" } } }
];
const stateStore = createEncryptedStateStore({
  encryptionKey: process.env.OPENCOUNTER_SESSION_ENCRYPTION_KEY,
  ...(process.env.OPENCOUNTER_STATE_DIRECTORY
    ? { stateDirectory: process.env.OPENCOUNTER_STATE_DIRECTORY }
    : {})
});
const configuredRudiHome = process.env.RUDI_HOME;
if (configuredRudiHome && !path.isAbsolute(configuredRudiHome)) {
  throw new Error("RUDI_HOME must be absolute when configured.");
}
const rudiHome = configuredRudiHome || path.join(os.homedir(), ".rudi");
const artifactStore = createOpenCounterArtifactStore({
  artifactDirectory: path.join(rudiHome, "artifacts", "opencounter")
});
const zoningCatalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const service = createOpenCounterService({
  driver: createPlaywrightOpenCounterDriver({ artifactStore, stateStore }),
  zoningCatalog
});
const server = new Server({ name: "rudi-opencounter", version: "0.5.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { type: "object", additionalProperties: false, properties: tool.properties, required: tool.required }
})) }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments;
  const result = request.params.name === "opencounter_get_zoning_use_catalog"
    ? await service.getZoningUseCatalog(args)
    : request.params.name === "opencounter_start_zoning_guidance"
      ? await service.startZoningGuidance(args)
      : request.params.name === "opencounter_reconcile_zoning_start"
        ? await service.reconcileZoningStart(args)
      : request.params.name === "opencounter_start_guidance"
        ? await service.startGuidance(args)
        : request.params.name === "opencounter_continue_guidance"
      ? await service.continueGuidance(args)
      : request.params.name === "opencounter_export_guidance"
        ? await service.exportGuidance(args)
        : request.params.name === "opencounter_get_guidance_result"
          ? await service.getGuidanceResult(args)
          : request.params.name === "opencounter_reconcile_guidance"
            ? await service.reconcileGuidance(args)
            : (() => { throw new Error("Unknown OpenCounter tool."); })();
  return createOpenCounterToolResponse(result);
});
await server.connect(new StdioServerTransport());
