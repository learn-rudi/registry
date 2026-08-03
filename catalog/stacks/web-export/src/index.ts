#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { runExportPipeline } from "./pipeline.js";
import type {
  CombinedExportResult,
  ExportResult,
  RawExportArguments,
  RequestedMode,
} from "./types.js";
import { ExportError, PAGE_SIZE_PRESETS } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(join(__dirname, "..", ".env")) });

type LegacyExportOptions = {
  output?: string;
  artboardSize?: keyof typeof PAGE_SIZE_PRESETS | [number, number];
  dpi?: number;
  scale?: number;
  paginated?: boolean;
  mode?: RequestedMode;
  pageSelector?: string;
  readySelector?: string;
  waitForJs?: string;
  preview?: boolean;
  splitOutput?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  browserWsEndpoint?: string;
};

function normalizeRawArguments(
  inputOrArgs: string | RawExportArguments,
  options: LegacyExportOptions = {},
): RawExportArguments {
  if (typeof inputOrArgs !== "string") {
    return inputOrArgs;
  }

  return {
    html_path: inputOrArgs,
    output: options.output,
    artboard_size: options.artboardSize,
    dpi: options.dpi,
    scale: options.scale,
    paginated: options.paginated,
    mode: options.mode,
    page_selector: options.pageSelector,
    ready_selector: options.readySelector,
    wait_for_js: options.waitForJs,
    preview: options.preview,
    split_output: options.splitOutput,
    viewport_width: options.viewportWidth,
    viewport_height: options.viewportHeight,
    browser_ws_endpoint: options.browserWsEndpoint,
  };
}

function summarizeResult(result: ExportResult): string {
  return [
    `${result.format.toUpperCase()} exported successfully.`,
    `Mode: ${result.modeDetected}`,
    `Pages: ${result.actualPageCount}`,
    `Artifacts: ${result.artifactPaths.join(", ")}`,
    result.previewPaths.length > 0 ? `Previews: ${result.previewPaths.join(", ")}` : undefined,
    result.warnings.length > 0 ? `Warnings: ${result.warnings.length}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatError(error: unknown) {
  if (error instanceof ExportError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    success: false,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

function resolveCombinedOutput(raw: RawExportArguments): { pdfOutput?: string; pngOutput?: string } {
  const output = typeof raw.output === "string" ? raw.output : undefined;
  const inputPath = typeof (raw.input ?? raw.html_path) === "string" ? String(raw.input ?? raw.html_path) : "";
  const stem = inputPath ? inputPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "export" : "export";

  if (!output) {
    return {};
  }

  if (extname(output)) {
    const directory = resolve(join(output, ".."));
    return {
      pdfOutput: join(directory, `${stem}.pdf`),
      pngOutput: directory,
    };
  }

  return {
    pdfOutput: join(output, `${stem}.pdf`),
    pngOutput: output,
  };
}

export async function htmlToPdf(
  inputOrArgs: string | RawExportArguments,
  options: LegacyExportOptions = {},
): Promise<ExportResult> {
  return runExportPipeline(normalizeRawArguments(inputOrArgs, options), "pdf");
}

export async function htmlToPng(
  inputOrArgs: string | RawExportArguments,
  options: LegacyExportOptions = {},
): Promise<ExportResult> {
  return runExportPipeline(normalizeRawArguments(inputOrArgs, options), "png");
}

export async function htmlToPngPdf(
  inputOrArgs: string | RawExportArguments,
  options: LegacyExportOptions = {},
): Promise<CombinedExportResult> {
  const raw = normalizeRawArguments(inputOrArgs, options);
  const { pdfOutput, pngOutput } = resolveCombinedOutput(raw);

  const pdf = await runExportPipeline({ ...raw, output: pdfOutput ?? raw.output }, "pdf");
  const png = await runExportPipeline({ ...raw, output: pngOutput ?? raw.output }, "png");

  return {
    success: pdf.success && png.success,
    pdf,
    png,
  };
}

const exportResultSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    format: { type: "string", enum: ["pdf", "png"] },
    modeDetected: { type: "string", enum: ["flow", "css-print", "artboard"] },
    actualPageCount: { type: "number" },
    artboardCount: { type: "number" },
    artifactPaths: { type: "array", items: { type: "string" } },
    previewPaths: { type: "array", items: { type: "string" } },
    warnings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          severity: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    renderTimeMs: { type: "number" },
    fileSizeBytes: { type: "number" },
  },
  required: [
    "success",
    "format",
    "modeDetected",
    "actualPageCount",
    "artboardCount",
    "artifactPaths",
    "previewPaths",
    "warnings",
    "renderTimeMs",
    "fileSizeBytes",
  ],
} as const;

const combinedResultSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    pdf: exportResultSchema,
    png: exportResultSchema,
  },
  required: ["success", "pdf", "png"],
} as const;

const sharedInputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  anyOf: [{ required: ["input"] }, { required: ["html_path"] }],
  properties: {
    input: { type: "string", description: "Path to the source HTML file." },
    html_path: { type: "string", description: "Legacy alias for input." },
    output: { type: "string", description: "Output path or directory target." },
    mode: {
      type: "string",
      enum: ["auto", "flow", "artboard"],
      description: "Rendering strategy hint. Auto detects the layout model.",
    },
    dpi: {
      type: "number",
      minimum: 72,
      maximum: 600,
      description: "PNG base DPI. Range: 72-600.",
    },
    scale: {
      type: "number",
      minimum: 0.25,
      maximum: 4,
      description: "Viewport scale factor. Range: 0.25-4.",
    },
    page_selector: {
      type: "string",
      description: "CSS selector for explicit page elements. Default: .artboard, [data-page].",
    },
    ready_selector: {
      type: "string",
      description: "Optional selector to wait for before rendering.",
    },
    wait_for_js: {
      type: "string",
      description: "Optional JS expression to wait for before rendering.",
    },
    paginated: {
      type: "boolean",
      description: "For PNG exports, require explicit page elements and produce one PNG per page.",
    },
    artboard_size: {
      oneOf: [
        { type: "string", enum: Object.keys(PAGE_SIZE_PRESETS) },
        {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "number", exclusiveMinimum: 0 },
        },
      ],
      description: "Preset page size string or [width, height] in pixels.",
    },
    viewport_width: {
      type: "number",
      minimum: 320,
      maximum: 7680,
      description: "Viewport width. Range: 320-7680.",
    },
    viewport_height: {
      type: "number",
      minimum: 240,
      maximum: 4320,
      description: "Viewport height. Range: 240-4320.",
    },
    browser_ws_endpoint: {
      type: "string",
      description: "Optional remote Chromium CDP/WebSocket endpoint.",
    },
    preview: {
      type: "boolean",
      description: "Generate PNG previews for PDF exports when a PDF rasterizer is available.",
    },
    split_output: {
      type: "boolean",
      description: "In artboard PDF mode, emit one PDF per page instead of a merged PDF.",
    },
  },
} as const;

function createServer(): Server {
  const server = new Server(
    { name: "web-export", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "html_to_pdf",
        description:
          "Render HTML to PDF, verify the produced artifact, and return structured diagnostics.",
        inputSchema: sharedInputSchema,
        outputSchema: exportResultSchema,
      },
      {
        name: "html_to_png",
        description:
          "Render HTML to PNG, supporting explicit page selectors for one-image-per-page exports.",
        inputSchema: sharedInputSchema,
        outputSchema: exportResultSchema,
      },
      {
        name: "html_to_png_pdf",
        description:
          "Run both HTML->PDF and HTML->PNG pipelines and return both verified results.",
        inputSchema: sharedInputSchema,
        outputSchema: combinedResultSchema,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "html_to_pdf": {
          const result = await htmlToPdf(args as RawExportArguments);
          return {
            content: [{ type: "text", text: summarizeResult(result) }],
            structuredContent: result,
          };
        }
        case "html_to_png": {
          const result = await htmlToPng(args as RawExportArguments);
          return {
            content: [{ type: "text", text: summarizeResult(result) }],
            structuredContent: result,
          };
        }
        case "html_to_png_pdf": {
          const result = await htmlToPngPdf(args as RawExportArguments);
          return {
            content: [
              {
                type: "text",
                text: `Combined export completed.\nPDF pages: ${result.pdf.actualPageCount}\nPNG pages: ${result.png.actualPageCount}`,
              },
            ],
            structuredContent: result,
          };
        }
        default: {
          const error = formatError(
            new ExportError("UNKNOWN_TOOL", `Unknown tool: ${name}`, { name }),
          );
          return {
            content: [{ type: "text", text: error.error.message }],
            structuredContent: error,
            isError: true,
          };
        }
      }
    } catch (error) {
      const structuredError = formatError(error);
      return {
        content: [{ type: "text", text: structuredError.error.message }],
        structuredContent: structuredError,
        isError: true,
      };
    }
  });

  return server;
}

async function runCli(args: string[]): Promise<void> {
  const [command, input, output] = args;

  if (!command || !input) {
    throw new ExportError("INVALID_CLI_USAGE", "Usage: <pdf|png|export> <input> [output]");
  }

  if (command === "pdf") {
    console.log(JSON.stringify(await htmlToPdf(input, { output }), null, 2));
    return;
  }

  if (command === "png") {
    console.log(JSON.stringify(await htmlToPng(input, { output }), null, 2));
    return;
  }

  if (command === "export") {
    console.log(JSON.stringify(await htmlToPngPdf(input, { output }), null, 2));
    return;
  }

  throw new ExportError("INVALID_CLI_USAGE", "Usage: <pdf|png|export> <input> [output]");
}

async function main() {
  const cliArgs = process.argv.slice(2);

  if (cliArgs.length > 0 && cliArgs[0] !== "--mcp") {
    await runCli(cliArgs);
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const structuredError = formatError(error);
    console.error(structuredError.error.message);
    process.exit(1);
  });
}
