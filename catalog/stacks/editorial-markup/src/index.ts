#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { exportCleanText, validateEditorialModel } from "./model.js";
import { runEditorialQa } from "./qa.js";
import { buildEditorialMarkup } from "./render.js";
import {
  MAX_SOURCE_TEXT_CHARS,
  type BuildEditorialMarkupArgs,
  type ExportCleanArgs,
  type QaArgs,
} from "./types.js";

export { exportCleanText, validateEditorialModel } from "./model.js";
export { runEditorialQa } from "./qa.js";
export { buildEditorialMarkup } from "./render.js";
export {
  LARGE_SOURCE_TEXT_CHARS,
  MAX_CHANGES_PER_ARTIFACT,
  MAX_SOURCE_TEXT_CHARS,
} from "./types.js";
export type {
  BuildEditorialMarkupArgs,
  BuildEditorialMarkupResult,
  ChangePart,
  ChangeStatus,
  EditorialBlock,
  EditorialDocument,
  EditorialPart,
  ExportCleanArgs,
  ExportCleanResult,
  QaArgs,
  QaResult,
  ReviewMode,
  ValidationResult,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function successResponse(value: unknown) {
  return {
    content: [{ type: "text" as const, text: jsonText(value) }],
  };
}

function errorResponse(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

const editModelSchema = {
  oneOf: [
    { type: "object" },
    { type: "array" },
  ],
  description: "Editorial model object with blocks, or a legacy array of blocks.",
} as const;

const buildInputSchema = {
  type: "object" as const,
  properties: {
    edit_model: editModelSchema,
    source_text: {
      type: "string",
      maxLength: MAX_SOURCE_TEXT_CHARS,
      description: "Normalized source text. Use edit_model when proposing visible changes.",
    },
    source_path: {
      type: "string",
      description: "Path to a local UTF-8 text/Markdown/HTML source file.",
    },
    source_manifest: {
      type: "object",
      description: "Multi-section normalized source manifest with sections containing source_text or source_path.",
    },
    title: { type: "string" },
    mode: {
      type: "string",
      enum: ["interactive", "static"],
      description: "Render interactive review controls or static redline markup.",
    },
    output_dir: { type: "string", description: "Directory for generated HTML." },
    output_path: { type: "string", description: "Full target HTML path." },
    filename: { type: "string", description: "HTML filename when output_dir is used." },
  },
} as const;

function createServer(): Server {
  const server = new Server(
    { name: "editorial-markup", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "editorial_markup_validate_model",
        description:
          "Validate an inline editorial markup model: paragraph/heading blocks, change IDs, statuses, notes, and clean-export readiness.",
        inputSchema: {
          type: "object",
          properties: {
            edit_model: editModelSchema,
          },
          required: ["edit_model"],
        },
      },
      {
        name: "editorial_markup_build",
        description:
          "Render validated editorial markup as a self-contained HTML artifact with either interactive review controls or static redline markup.",
        inputSchema: buildInputSchema,
      },
      {
        name: "editorial_markup_qa",
        description:
          "Run Playwright QA against an interactive editorial HTML artifact: controls, review flows, scroll behavior, no body horizontal overflow, and desktop/tablet/mobile screenshots.",
        inputSchema: {
          type: "object",
          properties: {
            html_path: { type: "string" },
            output_dir: { type: "string" },
          },
          required: ["html_path"],
        },
      },
      {
        name: "editorial_markup_export_clean",
        description:
          "Export clean text from a resolved editorial model. Pending changes are rejected unless allow_pending is explicitly true.",
        inputSchema: {
          type: "object",
          properties: {
            edit_model: editModelSchema,
            allow_pending: { type: "boolean" },
            pending_behavior: {
              type: "string",
              enum: ["insertions", "deletions"],
              description: "How to resolve pending changes only when allow_pending is true.",
            },
          },
          required: ["edit_model"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = asRecord(request.params.arguments);

    try {
      switch (request.params.name) {
        case "editorial_markup_validate_model":
          return successResponse(validateEditorialModel(args.edit_model));

        case "editorial_markup_build":
          return successResponse(await buildEditorialMarkup(args as BuildEditorialMarkupArgs));

        case "editorial_markup_qa":
          return successResponse(await runEditorialQa(args as unknown as QaArgs));

        case "editorial_markup_export_clean":
          return successResponse(exportCleanText(args as unknown as ExportCleanArgs));

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return errorResponse(error);
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  startServer().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
}
