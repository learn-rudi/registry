#!/usr/bin/env node
/**
 * MS Office MCP Server
 * Read and extract content from Microsoft Office documents
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { readDocx, readXlsx } from './index'
 *   - As CLI: node index.ts docx <path> [output] | xlsx <path> [--sheet=name] [--format=json|csv] [output]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { basename, extname, dirname, join } from "path";
import { homedir } from "os";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

// Expand ~ to home directory
function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return join(process.env.HOME || "", filePath.slice(2));
  }
  return filePath;
}

export interface DocxResult {
  text: string;
  markdown: string;
  messages: string[];
  filename: string;
}

export interface XlsxResult {
  sheets: string[];
  data: Record<string, any[][]>;
  markdown: string;
  filename: string;
}

/**
 * Read a DOCX file and convert to markdown
 * @param filePath - Path to the .docx file (supports ~ for home directory)
 */
export async function readDocx(filePath: string): Promise<DocxResult> {
  const path = expandPath(filePath);
  const filename = basename(path);
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }

  const buffer = readFileSync(path);

  // Get both plain text and HTML (for markdown conversion)
  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);

  // Convert HTML to simple markdown
  let markdown = htmlResult.value
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n")
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<u>(.*?)<\/u>/gi, "_$1_")
    .replace(/<li>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<ul[^>]*>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<ol[^>]*>/gi, "\n")
    .replace(/<\/ol>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "") // Remove remaining HTML tags
    .replace(/\n{3,}/g, "\n\n") // Clean up extra newlines
    .trim();

  return {
    text: textResult.value,
    markdown,
    messages: [...textResult.messages, ...htmlResult.messages].map((m) => m.message),
    filename,
  };
}

export interface XlsxOptions {
  sheet?: string;
  format?: "markdown" | "json" | "csv";
}

/**
 * Read an Excel file and convert to markdown tables, JSON, or CSV
 * @param filePath - Path to the Excel file (supports ~ for home directory)
 * @param options - Optional sheet name and output format
 */
export function readXlsx(
  filePath: string,
  options: XlsxOptions = {}
): XlsxResult {
  const path = expandPath(filePath);
  const filename = basename(path);
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }

  const workbook = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheets = workbook.SheetNames;
  const format = options.format || "markdown";

  const targetSheets = options.sheet
    ? [options.sheet]
    : sheets;

  const data: Record<string, any[][]> = {};
  let markdown = "";

  for (const sheetName of targetSheets) {
    if (!sheets.includes(sheetName)) {
      throw new Error(`Sheet "${sheetName}" not found. Available: ${sheets.join(", ")}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    data[sheetName] = jsonData;

    if (format === "markdown" && jsonData.length > 0) {
      markdown += `## ${sheetName}\n\n`;

      // Header row
      const headers = jsonData[0] || [];
      markdown += "| " + headers.map((h: any) => String(h ?? "")).join(" | ") + " |\n";
      markdown += "| " + headers.map(() => "---").join(" | ") + " |\n";

      // Data rows
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i] || [];
        const cells = headers.map((_: any, idx: number) => String(row[idx] ?? ""));
        markdown += "| " + cells.join(" | ") + " |\n";
      }
      markdown += "\n";
    }
  }

  if (format === "csv") {
    markdown = Object.entries(data)
      .map(([name, rows]) => {
        const csv = rows.map((row) => row.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
        return `# ${name}\n${csv}`;
      })
      .join("\n\n");
  }

  if (format === "json") {
    markdown = JSON.stringify(data, null, 2);
  }

  return { sheets, data, markdown, filename };
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function resolveOutputPath(output: string | undefined, filename: string, type: string): string {
  const name = filename.replace(/\.[^/.]+$/, ""); // remove extension
  const outputFilename = `${type}-${slugify(name)}-${new Date().toISOString().split("T")[0]}.md`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, outputFilename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, outputFilename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, outputFilename);
  return output;
}

const server = new Server(
  { name: "ms-office", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "docx_read",
      description:
        "Read a Microsoft Word document (.docx) and extract its content as markdown. Preserves headings, bold, italic, lists, and paragraphs.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the .docx file (supports ~ for home directory)",
          },
          output: {
            type: "string",
            description: "Optional path to save the extracted markdown",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "xlsx_read",
      description:
        "Read a Microsoft Excel spreadsheet (.xlsx, .xls) and extract data as markdown tables, JSON, or CSV.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the Excel file (supports ~ for home directory)",
          },
          sheet: {
            type: "string",
            description: "Specific sheet name to read (default: all sheets)",
          },
          format: {
            type: "string",
            enum: ["markdown", "json", "csv"],
            description: "Output format (default: markdown)",
          },
          output: {
            type: "string",
            description: "Optional path to save the extracted content",
          },
        },
        required: ["path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "docx_read") {
    try {
      const filePath = args?.path as string;
      const output = args?.output as string | undefined;

      const result = await readDocx(filePath);
      let text = `**Document:** ${result.filename}\n\n---\n\n${result.markdown}`;

      if (result.messages.length > 0) {
        text += `\n\n---\n**Conversion notes:** ${result.messages.join("; ")}`;
      }

      if (output) {
        const outPath = resolveOutputPath(output, result.filename, "docx");
        if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
        writeFileSync(outPath, result.markdown, "utf-8");
        return {
          content: [{ type: "text", text: `Saved to ${outPath}\n\n${text}` }],
        };
      }

      return { content: [{ type: "text", text }] };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error reading DOCX: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "xlsx_read") {
    try {
      const filePath = args?.path as string;
      const sheet = args?.sheet as string | undefined;
      const format = (args?.format as "markdown" | "json" | "csv") || "markdown";
      const output = args?.output as string | undefined;

      const result = readXlsx(filePath, { sheet, format });
      let text = `**Spreadsheet:** ${result.filename}\n`;
      text += `**Sheets:** ${result.sheets.join(", ")}\n\n---\n\n`;
      text += result.markdown;

      if (output) {
        const outPath = resolveOutputPath(output, result.filename, "xlsx");
        if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
        writeFileSync(outPath, result.markdown, "utf-8");
        return {
          content: [{ type: "text", text: `Saved to ${outPath}\n\n${text}` }],
        };
      }

      return { content: [{ type: "text", text }] };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error reading Excel: ${error.message}` }],
        isError: true,
      };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);

// CLI mode: node index.ts docx <path> [output] | xlsx <path> [--sheet=name] [--format=json|csv] [output]
if (args.length > 0 && (args[0] === "docx" || args[0] === "xlsx")) {
  const command = args[0];
  const filePath = args[1];

  if (!filePath) {
    console.error(`Usage: node index.ts ${command} <path> [options]`);
    process.exit(1);
  }

  if (command === "docx") {
    readDocx(filePath).then((result) => {
      let text = `**Document:** ${result.filename}\n\n---\n\n${result.markdown}`;
      if (result.messages.length > 0) {
        text += `\n\n---\n**Conversion notes:** ${result.messages.join("; ")}`;
      }

      const output = args[2];
      if (output) {
        const outPath = resolveOutputPath(output, result.filename, "docx");
        if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
        writeFileSync(outPath, result.markdown, "utf-8");
        console.log(`Saved to ${outPath}`);
      } else {
        console.log(text);
      }
    }).catch(console.error);
  } else if (command === "xlsx") {
    // Parse options from remaining args
    let sheet: string | undefined;
    let format: "markdown" | "json" | "csv" = "markdown";
    let output: string | undefined;

    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith("--sheet=")) {
        sheet = args[i].split("=")[1];
      } else if (args[i].startsWith("--format=")) {
        format = args[i].split("=")[1] as "markdown" | "json" | "csv";
      } else if (!args[i].startsWith("--")) {
        output = args[i];
      }
    }

    try {
      const result = readXlsx(filePath, { sheet, format });
      let text = `**Spreadsheet:** ${result.filename}\n`;
      text += `**Sheets:** ${result.sheets.join(", ")}\n\n---\n\n`;
      text += result.markdown;

      if (output) {
        const outPath = resolveOutputPath(output, result.filename, "xlsx");
        if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
        writeFileSync(outPath, result.markdown, "utf-8");
        console.log(`Saved to ${outPath}`);
      } else {
        console.log(text);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
}
// MCP mode: no args, JSON-RPC over stdio
else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
