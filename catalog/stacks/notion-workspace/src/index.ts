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

// Default output: ~/.rudi/outputs/
const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "outputs");
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
    {
      name: "notion_batch_add_rows",
      description: "Add multiple rows to a Notion database in one operation. Much faster than adding rows one by one.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The database ID" },
          rows: {
            type: "array",
            description: "Array of row objects, each with properties matching the database schema",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["database_id", "rows"],
      },
    },
    {
      name: "notion_update_row",
      description: "Update an existing row (page) in a Notion database",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page/row ID to update" },
          properties: {
            type: "object",
            description: "Properties to update",
            additionalProperties: true,
          },
        },
        required: ["page_id", "properties"],
      },
    },
    {
      name: "notion_get_database_schema",
      description: "Get the schema/properties of a Notion database to understand its structure",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The database ID" },
        },
        required: ["database_id"],
      },
    },
    {
      name: "notion_search_all_databases",
      description: "Search across all accessible databases for rows matching a query. Searches title properties.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query to match against titles" },
          limit: { type: "number", description: "Max results per database (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "notion_duplicate_page",
      description: "Duplicate a Notion page with its content to a new location",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID to duplicate" },
          new_parent_id: { type: "string", description: "Parent page ID for the duplicate" },
          new_title: { type: "string", description: "Optional new title (defaults to 'Copy of [original]')" },
        },
        required: ["page_id", "new_parent_id"],
      },
    },
    {
      name: "notion_add_block",
      description: "Add a specific block type to a page. Supports: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, toggle, quote, callout, code, divider, table_of_contents, bookmark, embed, image, video",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID to add block to" },
          block_type: {
            type: "string",
            description: "Block type",
            enum: ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout", "code", "divider", "table_of_contents", "bookmark", "embed", "image", "video"]
          },
          content: { type: "string", description: "Text content for the block" },
          url: { type: "string", description: "URL for bookmark/embed/image/video blocks" },
          language: { type: "string", description: "Programming language for code blocks (default: plain text)" },
          emoji: { type: "string", description: "Emoji icon for callout blocks (default: 💡)" },
          checked: { type: "boolean", description: "Checked state for to_do blocks (default: false)" },
          color: { type: "string", description: "Background color for callout: gray, brown, orange, yellow, green, blue, purple, pink, red" },
        },
        required: ["page_id", "block_type"],
      },
    },
    {
      name: "notion_move_page",
      description: "Move a page to a new parent (reorganize your Notion structure)",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID to move" },
          new_parent_id: { type: "string", description: "New parent page ID" },
        },
        required: ["page_id", "new_parent_id"],
      },
    },
    {
      name: "notion_update_page_properties",
      description: "Update a page's properties (title, icon, cover)",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
          title: { type: "string", description: "New title" },
          icon_emoji: { type: "string", description: "Emoji icon (e.g. '📚')" },
          icon_url: { type: "string", description: "External icon URL" },
          cover_url: { type: "string", description: "Cover image URL" },
        },
        required: ["page_id"],
      },
    },
    {
      name: "notion_get_page_tree",
      description: "Get the hierarchy/tree of child pages under a page",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The parent page ID" },
          depth: { type: "number", description: "How deep to traverse (default: 2)" },
        },
        required: ["page_id"],
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

// Helper to convert text to blocks (supports basic markdown)
function textToBlocks(text: string): any[] {
  return text.split("\n").map((line) => {
    // Headings
    if (line.startsWith("### ")) {
      return {
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: line.slice(4) } }] },
      };
    }
    if (line.startsWith("## ")) {
      return {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: line.slice(3) } }] },
      };
    }
    if (line.startsWith("# ")) {
      return {
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] },
      };
    }
    // Bullet list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] },
      };
    }
    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: line.replace(/^\d+\.\s/, "") } }] },
      };
    }
    // Checkbox / To-do
    if (line.startsWith("[ ] ")) {
      return {
        object: "block",
        type: "to_do",
        to_do: { rich_text: [{ type: "text", text: { content: line.slice(4) } }], checked: false },
      };
    }
    if (line.startsWith("[x] ") || line.startsWith("[X] ")) {
      return {
        object: "block",
        type: "to_do",
        to_do: { rich_text: [{ type: "text", text: { content: line.slice(4) } }], checked: true },
      };
    }
    // Quote
    if (line.startsWith("> ")) {
      return {
        object: "block",
        type: "quote",
        quote: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] },
      };
    }
    // Divider
    if (line === "---" || line === "***" || line === "___") {
      return { object: "block", type: "divider", divider: {} };
    }
    // Code block (single line with backticks)
    if (line.startsWith("`") && line.endsWith("`") && line.length > 2) {
      return {
        object: "block",
        type: "code",
        code: { rich_text: [{ type: "text", text: { content: line.slice(1, -1) } }], language: "plain text" },
      };
    }
    // Callout (custom: starts with emoji or !)
    if (line.startsWith("! ")) {
      return {
        object: "block",
        type: "callout",
        callout: { rich_text: [{ type: "text", text: { content: line.slice(2) } }], icon: { emoji: "💡" } },
      };
    }
    // Default: paragraph
    return {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: line } }] },
    };
  });
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

      case "notion_batch_add_rows": {
        const databaseId = args?.database_id as string;
        const rows = args?.rows as any[];
        const results: { url: string; title?: string }[] = [];
        const errors: string[] = [];

        // Process rows in parallel batches of 10 (Notion rate limit friendly)
        const batchSize = 10;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const promises = batch.map(async (row, idx) => {
            try {
              const page = await notion.pages.create({
                parent: { database_id: databaseId },
                properties: row,
              });
              return { success: true, url: (page as any).url, index: i + idx };
            } catch (err: any) {
              return { success: false, error: err.message, index: i + idx };
            }
          });

          const batchResults = await Promise.all(promises);
          for (const result of batchResults) {
            if (result.success) {
              results.push({ url: result.url });
            } else {
              errors.push(`Row ${result.index}: ${result.error}`);
            }
          }
        }

        const summary = {
          total: rows.length,
          succeeded: results.length,
          failed: errors.length,
          errors: errors.length > 0 ? errors : undefined,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      }

      case "notion_update_row": {
        const page = await notion.pages.update({
          page_id: args?.page_id as string,
          properties: args?.properties as any,
        });
        return {
          content: [{ type: "text", text: `Row updated: ${(page as any).url}` }],
        };
      }

      case "notion_get_database_schema": {
        const db = await notion.databases.retrieve({
          database_id: args?.database_id as string,
        });
        const schema = {
          id: db.id,
          title: (db as any).title?.[0]?.plain_text || "(untitled)",
          properties: Object.entries((db as any).properties).map(([name, prop]: [string, any]) => ({
            name,
            type: prop.type,
            ...(prop.type === "select" && { options: prop.select?.options }),
            ...(prop.type === "multi_select" && { options: prop.multi_select?.options }),
            ...(prop.type === "status" && { options: prop.status?.options, groups: prop.status?.groups }),
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
        };
      }

      case "notion_search_all_databases": {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 10;

        // First get all databases
        const dbSearch = await notion.search({ query: "", page_size: 100 });
        const databases = dbSearch.results.filter((item: any) => item.object === "database");

        const allResults: any[] = [];

        // Search each database
        for (const db of databases) {
          try {
            const dbTitle = (db as any).title?.[0]?.plain_text || "(untitled)";
            const response = await notion.databases.query({
              database_id: db.id,
              page_size: limit,
            });

            // Filter results that match the query in any text property
            const matchingRows = response.results.filter((row: any) => {
              const props = row.properties || {};
              for (const [, value] of Object.entries(props)) {
                const v = value as any;
                if (v.type === "title" && v.title?.length > 0) {
                  const text = v.title.map((t: any) => t.plain_text).join("");
                  if (text.toLowerCase().includes(query.toLowerCase())) return true;
                }
                if (v.type === "rich_text" && v.rich_text?.length > 0) {
                  const text = v.rich_text.map((t: any) => t.plain_text).join("");
                  if (text.toLowerCase().includes(query.toLowerCase())) return true;
                }
              }
              return false;
            });

            if (matchingRows.length > 0) {
              allResults.push({
                database: { id: db.id, title: dbTitle },
                matches: matchingRows.map((row: any) => ({
                  id: row.id,
                  url: row.url,
                  title: getPageTitle(row),
                })),
              });
            }
          } catch {
            // Skip databases we can't query
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(allResults, null, 2) }],
        };
      }

      case "notion_duplicate_page": {
        const sourcePageId = args?.page_id as string;
        const newParentId = args?.new_parent_id as string;

        // Get the original page
        const originalPage = await notion.pages.retrieve({ page_id: sourcePageId });
        const originalTitle = getPageTitle(originalPage);
        const newTitle = (args?.new_title as string) || `Copy of ${originalTitle}`;

        // Get the original content blocks
        const blocks = await notion.blocks.children.list({ block_id: sourcePageId });

        // Create new page
        const newPage = await notion.pages.create({
          parent: { page_id: newParentId },
          properties: {
            title: { title: [{ text: { content: newTitle } }] },
          },
          children: blocks.results.map((block: any) => {
            // Strip IDs and other metadata that can't be copied
            const { id, created_time, last_edited_time, created_by, last_edited_by, parent, has_children, archived, ...rest } = block;
            return rest;
          }) as any,
        });

        return {
          content: [{ type: "text", text: `Page duplicated: ${(newPage as any).url}` }],
        };
      }

      case "notion_add_block": {
        const pageId = args?.page_id as string;
        const blockType = args?.block_type as string;
        const content = args?.content as string || "";
        const url = args?.url as string;
        const language = args?.language as string || "plain text";
        const emoji = args?.emoji as string || "💡";
        const checked = args?.checked as boolean || false;
        const color = args?.color as string || "gray_background";

        let block: any;

        switch (blockType) {
          case "paragraph":
          case "heading_1":
          case "heading_2":
          case "heading_3":
          case "bulleted_list_item":
          case "numbered_list_item":
          case "quote":
            block = { type: blockType, [blockType]: { rich_text: [{ type: "text", text: { content } }] } };
            break;
          case "to_do":
            block = { type: "to_do", to_do: { rich_text: [{ type: "text", text: { content } }], checked } };
            break;
          case "toggle":
            block = { type: "toggle", toggle: { rich_text: [{ type: "text", text: { content } }] } };
            break;
          case "callout":
            block = { type: "callout", callout: { rich_text: [{ type: "text", text: { content } }], icon: { emoji }, color } };
            break;
          case "code":
            block = { type: "code", code: { rich_text: [{ type: "text", text: { content } }], language } };
            break;
          case "divider":
            block = { type: "divider", divider: {} };
            break;
          case "table_of_contents":
            block = { type: "table_of_contents", table_of_contents: {} };
            break;
          case "bookmark":
            block = { type: "bookmark", bookmark: { url } };
            break;
          case "embed":
            block = { type: "embed", embed: { url } };
            break;
          case "image":
            block = { type: "image", image: { type: "external", external: { url } } };
            break;
          case "video":
            block = { type: "video", video: { type: "external", external: { url } } };
            break;
          default:
            return { content: [{ type: "text", text: `Unknown block type: ${blockType}` }], isError: true };
        }

        await notion.blocks.children.append({
          block_id: pageId,
          children: [block],
        });

        return { content: [{ type: "text", text: `Block added: ${blockType}` }] };
      }

      case "notion_move_page": {
        const pageId = args?.page_id as string;
        const newParentId = args?.new_parent_id as string;

        await notion.pages.update({
          page_id: pageId,
          parent: { page_id: newParentId },
        } as any);

        return { content: [{ type: "text", text: `Page moved to new parent` }] };
      }

      case "notion_update_page_properties": {
        const pageId = args?.page_id as string;
        const updates: any = {};

        if (args?.title) {
          updates.properties = {
            title: { title: [{ text: { content: args.title as string } }] },
          };
        }

        if (args?.icon_emoji) {
          updates.icon = { type: "emoji", emoji: args.icon_emoji as string };
        } else if (args?.icon_url) {
          updates.icon = { type: "external", external: { url: args.icon_url as string } };
        }

        if (args?.cover_url) {
          updates.cover = { type: "external", external: { url: args.cover_url as string } };
        }

        const page = await notion.pages.update({
          page_id: pageId,
          ...updates,
        });

        return { content: [{ type: "text", text: `Page updated: ${(page as any).url}` }] };
      }

      case "notion_get_page_tree": {
        const pageId = args?.page_id as string;
        const maxDepth = (args?.depth as number) || 2;

        async function getChildren(blockId: string, depth: number): Promise<any[]> {
          if (depth > maxDepth) return [];

          const blocks = await notion.blocks.children.list({ block_id: blockId });
          const children: any[] = [];

          for (const block of blocks.results) {
            if ((block as any).type === "child_page") {
              const pageInfo = {
                id: block.id,
                title: (block as any).child_page?.title || "(untitled)",
                type: "page",
                children: await getChildren(block.id, depth + 1),
              };
              children.push(pageInfo);
            } else if ((block as any).type === "child_database") {
              children.push({
                id: block.id,
                title: (block as any).child_database?.title || "(untitled)",
                type: "database",
              });
            }
          }

          return children;
        }

        const tree = await getChildren(pageId, 1);
        return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
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
