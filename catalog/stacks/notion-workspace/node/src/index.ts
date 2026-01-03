#!/usr/bin/env node
/**
 * Notion Workspace MCP Server (TypeScript)
 *
 * Exposes Notion pages, databases, and blocks as tools for Claude Code.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { homedir } from "os";

// Load .env from script directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

// Default output: ~/.prompt-stack/output/
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");
if (!existsSync(DEFAULT_OUTPUT_DIR)) {
  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateFilename(prefix: string, identifier: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `notion-${prefix}-${slugify(identifier)}-${date}.md`;
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function resolveOutputPath(output: string | undefined, prefix: string, identifier: string): string {
  if (!output) {
    return join(DEFAULT_OUTPUT_DIR, generateFilename(prefix, identifier));
  }
  const expanded = expandPath(output);
  if (existsSync(expanded) && statSync(expanded).isDirectory()) {
    return join(expanded, generateFilename(prefix, identifier));
  }
  if (expanded.endsWith("/") || !expanded.includes(".")) {
    return join(expanded, generateFilename(prefix, identifier));
  }
  return expanded;
}

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Tracked databases file
const DATABASES_FILE = join(__dirname, "..", "databases.json");

interface TrackedDatabase {
  id: string;
  name: string;
}

function loadDatabases(): TrackedDatabase[] {
  if (existsSync(DATABASES_FILE)) {
    return JSON.parse(readFileSync(DATABASES_FILE, "utf-8"));
  }
  return [];
}

function saveDatabases(dbs: TrackedDatabase[]): void {
  writeFileSync(DATABASES_FILE, JSON.stringify(dbs, null, 2));
}

// Create MCP server
const server = new Server(
  { name: "notion-workspace", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "notion_search",
      description: "Search Notion for pages and databases",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["query"],
      },
    },
    {
      name: "notion_get_page",
      description: "Get a Notion page by ID",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_get_page_content",
      description: "Get the content blocks of a Notion page",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_create_page",
      description: "Create a new Notion page",
      inputSchema: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "Parent page or database ID" },
          parent_type: { type: "string", enum: ["page", "database"], description: "Type of parent" },
          title: { type: "string", description: "Page title" },
          content: { type: "string", description: "Page content (markdown-like)" },
        },
        required: ["parent_id", "parent_type", "title"],
      },
    },
    {
      name: "notion_append_content",
      description: "Append content to an existing Notion page",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["page_id", "content"],
      },
    },
    {
      name: "notion_delete_page",
      description: "Delete (archive) a Notion page",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_list_databases",
      description: "List all accessible Notion databases",
      inputSchema: {
        type: "object",
        properties: {
          output: { type: "string", description: "Optional file path to save output" },
        },
      },
    },
    {
      name: "notion_query_database",
      description: "Query a Notion database",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The database ID" },
          filter: { type: "object", description: "Optional filter object" },
          limit: { type: "number", description: "Max results (default 50)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["database_id"],
      },
    },
    {
      name: "notion_create_database",
      description: "Create a new Notion database",
      inputSchema: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "Parent page ID" },
          title: { type: "string", description: "Database title" },
          properties: {
            type: "object",
            description: "Database properties schema",
            additionalProperties: true,
          },
        },
        required: ["parent_id", "title"],
      },
    },
    {
      name: "notion_add_database_row",
      description: "Add a row to a Notion database",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The database ID" },
          properties: {
            type: "object",
            description: "Row properties",
            additionalProperties: true,
          },
        },
        required: ["database_id", "properties"],
      },
    },
    {
      name: "notion_db_list",
      description: "List tracked databases",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "notion_db_add",
      description: "Add a database to tracked list",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          name: { type: "string", description: "Friendly name" },
        },
        required: ["database_id", "name"],
      },
    },
    {
      name: "notion_db_remove",
      description: "Remove a database from tracked list",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
        },
        required: ["database_id"],
      },
    },
  ],
}));

// Helper to extract title from page
function getPageTitle(page: any): string {
  const props = page.properties || {};
  for (const [, value] of Object.entries(props)) {
    const v = value as any;
    if (v.type === "title" && v.title?.length > 0) {
      return v.title[0].plain_text;
    }
  }
  return "(untitled)";
}

// Helper to convert text to blocks
function textToBlocks(text: string): any[] {
  return text.split("\n").map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: line } }],
    },
  }));
}

// Helper to extract text from blocks
function blocksToText(blocks: any[]): string {
  return blocks
    .map((block) => {
      const type = block.type;
      const content = block[type];
      if (content?.rich_text) {
        return content.rich_text.map((t: any) => t.plain_text).join("");
      }
      return "";
    })
    .join("\n");
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "notion_search": {
        const results = await notion.search({
          query: args?.query as string,
          page_size: (args?.limit as number) || 10,
        });
        const items = results.results.map((item: any) => ({
          id: item.id,
          type: item.object,
          title: item.object === "page" ? getPageTitle(item) : item.title?.[0]?.plain_text || "(untitled)",
          url: item.url,
        }));
        const text = JSON.stringify(items, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "search", args.query as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "notion_get_page": {
        const page = await notion.pages.retrieve({ page_id: args?.page_id as string });
        const text = JSON.stringify(page, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "page", args.page_id as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "notion_get_page_content": {
        const blocks = await notion.blocks.children.list({ block_id: args?.page_id as string });
        const text = blocksToText(blocks.results);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "content", args.page_id as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "notion_create_page": {
        const parentType = args?.parent_type as string;
        const parent =
          parentType === "database"
            ? { database_id: args?.parent_id as string }
            : { page_id: args?.parent_id as string };

        const properties =
          parentType === "database"
            ? { title: { title: [{ text: { content: args?.title as string } }] } }
            : { title: { title: [{ text: { content: args?.title as string } }] } };

        const children = args?.content ? textToBlocks(args.content as string) : [];

        const page = await notion.pages.create({ parent, properties, children } as any);
        return {
          content: [{ type: "text", text: `Page created: ${(page as any).url}` }],
        };
      }

      case "notion_append_content": {
        const blocks = textToBlocks(args?.content as string);
        await notion.blocks.children.append({
          block_id: args?.page_id as string,
          children: blocks as any,
        });
        return { content: [{ type: "text", text: "Content appended successfully" }] };
      }

      case "notion_delete_page": {
        await notion.pages.update({
          page_id: args?.page_id as string,
          archived: true,
        });
        return { content: [{ type: "text", text: "Page archived successfully" }] };
      }

      case "notion_list_databases": {
        const results = await notion.search({ query: "", page_size: 100 });
        const databases = results.results
          .filter((item: any) => item.object === "database")
          .map((db: any) => ({
            id: db.id,
            title: db.title?.[0]?.plain_text || "(untitled)",
            url: db.url,
          }));
        const text = JSON.stringify(databases, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "databases", "list");
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "notion_query_database": {
        const response = await notion.databases.query({
          database_id: args?.database_id as string,
          filter: args?.filter as any,
          page_size: (args?.limit as number) || 50,
        });
        const rows = response.results.map((row: any) => ({
          id: row.id,
          properties: row.properties,
        }));
        const text = JSON.stringify(rows, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "query", args.database_id as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "notion_create_database": {
        const db = await notion.databases.create({
          parent: { page_id: args?.parent_id as string },
          title: [{ type: "text", text: { content: args?.title as string } }],
          properties: (args?.properties as any) || { Name: { title: {} } },
        });
        return {
          content: [{ type: "text", text: `Database created: ${(db as any).url}` }],
        };
      }

      case "notion_add_database_row": {
        const page = await notion.pages.create({
          parent: { database_id: args?.database_id as string },
          properties: args?.properties as any,
        });
        return {
          content: [{ type: "text", text: `Row added: ${(page as any).url}` }],
        };
      }

      case "notion_db_list": {
        const dbs = loadDatabases();
        return { content: [{ type: "text", text: JSON.stringify(dbs, null, 2) }] };
      }

      case "notion_db_add": {
        const dbs = loadDatabases();
        dbs.push({ id: args?.database_id as string, name: args?.name as string });
        saveDatabases(dbs);
        return { content: [{ type: "text", text: "Database added to tracked list" }] };
      }

      case "notion_db_remove": {
        let dbs = loadDatabases();
        dbs = dbs.filter((db) => db.id !== args?.database_id);
        saveDatabases(dbs);
        return { content: [{ type: "text", text: "Database removed from tracked list" }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// =============================================================================
// EXPORTED API - For direct script usage
// =============================================================================

export interface SearchOptions {
  query: string;
  limit?: number;
  output?: string;
}

export interface GetPageOptions {
  page_id: string;
  output?: string;
}

export interface GetPageContentOptions {
  page_id: string;
  output?: string;
}

export interface CreatePageOptions {
  parent_id: string;
  parent_type: "page" | "database";
  title: string;
  content?: string;
}

export interface AppendContentOptions {
  page_id: string;
  content: string;
}

export interface ListDatabasesOptions {
  output?: string;
}

export interface QueryDatabaseOptions {
  database_id: string;
  filter?: any;
  limit?: number;
  output?: string;
}

export interface CreateDatabaseOptions {
  parent_id: string;
  title: string;
  properties?: any;
}

export interface AddDatabaseRowOptions {
  database_id: string;
  properties: any;
}

export async function search(options: SearchOptions): Promise<any[]> {
  const results = await notion.search({
    query: options.query,
    page_size: options.limit || 10,
  });
  const items = results.results.map((item: any) => ({
    id: item.id,
    type: item.object,
    title: item.object === "page" ? getPageTitle(item) : item.title?.[0]?.plain_text || "(untitled)",
    url: item.url,
  }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "search", options.query);
    writeFileSync(filePath, JSON.stringify(items, null, 2), "utf-8");
  }
  return items;
}

export async function getPage(options: GetPageOptions): Promise<any> {
  const page = await notion.pages.retrieve({ page_id: options.page_id });
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "page", options.page_id);
    writeFileSync(filePath, JSON.stringify(page, null, 2), "utf-8");
  }
  return page;
}

export async function getPageContent(options: GetPageContentOptions): Promise<string> {
  const blocks = await notion.blocks.children.list({ block_id: options.page_id });
  const text = blocksToText(blocks.results);
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "content", options.page_id);
    writeFileSync(filePath, text, "utf-8");
  }
  return text;
}

export async function createPage(options: CreatePageOptions): Promise<{ url: string }> {
  const parent =
    options.parent_type === "database"
      ? { database_id: options.parent_id }
      : { page_id: options.parent_id };
  const properties = { title: { title: [{ text: { content: options.title } }] } };
  const children = options.content ? textToBlocks(options.content) : [];
  const page = await notion.pages.create({ parent, properties, children } as any);
  return { url: (page as any).url };
}

export async function appendContent(options: AppendContentOptions): Promise<void> {
  const blocks = textToBlocks(options.content);
  await notion.blocks.children.append({
    block_id: options.page_id,
    children: blocks as any,
  });
}

export async function deletePage(page_id: string): Promise<void> {
  await notion.pages.update({ page_id, archived: true });
}

export async function listDatabases(options: ListDatabasesOptions = {}): Promise<any[]> {
  const results = await notion.search({ query: "", page_size: 100 });
  const databases = results.results
    .filter((item: any) => item.object === "database")
    .map((db: any) => ({
      id: db.id,
      title: db.title?.[0]?.plain_text || "(untitled)",
      url: db.url,
    }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "databases", "list");
    writeFileSync(filePath, JSON.stringify(databases, null, 2), "utf-8");
  }
  return databases;
}

export async function queryDatabase(options: QueryDatabaseOptions): Promise<any[]> {
  const response = await notion.databases.query({
    database_id: options.database_id,
    filter: options.filter,
    page_size: options.limit || 50,
  });
  const rows = response.results.map((row: any) => ({
    id: row.id,
    properties: row.properties,
  }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "query", options.database_id);
    writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf-8");
  }
  return rows;
}

export async function createDatabase(options: CreateDatabaseOptions): Promise<{ url: string }> {
  const db = await notion.databases.create({
    parent: { page_id: options.parent_id },
    title: [{ type: "text", text: { content: options.title } }],
    properties: options.properties || { Name: { title: {} } },
  });
  return { url: (db as any).url };
}

export async function addDatabaseRow(options: AddDatabaseRowOptions): Promise<{ url: string }> {
  const page = await notion.pages.create({
    parent: { database_id: options.database_id },
    properties: options.properties,
  });
  return { url: (page as any).url };
}

// Only run MCP server when executed directly (not imported)
if (!process.argv[1]?.includes("node_modules")) {
  main().catch(console.error);
}
