#!/usr/bin/env node
/**
 * PostgreSQL MCP Server
 * Query and manage PostgreSQL databases
 *
 * Works with: Neon, Railway, Supabase, any PostgreSQL connection
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { query, execute, listTables, ... } from './index'
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Pool } from "pg";

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable not set");
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
}

export interface TableInfo {
  schema: string;
  name: string;
  type: string;
  owner: string;
}

export interface ColumnInfo {
  column: string;
  type: string;
  nullable: boolean;
  default: string | null;
  primary_key: boolean;
}

export interface SchemaInfo {
  name: string;
  owner: string;
}

/**
 * Run a SELECT query (read-only)
 */
export async function query(
  sql: string,
  params?: unknown[]
): Promise<QueryResult> {
  const db = getPool();
  const result = await db.query(sql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? 0,
    fields: result.fields.map((f) => f.name),
  };
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 */
export async function execute(
  sql: string,
  params?: unknown[]
): Promise<{ rowCount: number; message: string }> {
  const db = getPool();
  const result = await db.query(sql, params);
  return {
    rowCount: result.rowCount ?? 0,
    message: `Executed successfully. ${result.rowCount ?? 0} rows affected.`,
  };
}

/**
 * List all tables in the database
 */
export async function listTables(schema?: string): Promise<TableInfo[]> {
  const db = getPool();
  const targetSchema = schema || "public";
  const result = await db.query(
    `
    SELECT
      table_schema as schema,
      table_name as name,
      table_type as type,
      (SELECT pg_catalog.pg_get_userbyid(c.relowner)
       FROM pg_catalog.pg_class c
       WHERE c.relname = table_name
       AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = table_schema)
       LIMIT 1) as owner
    FROM information_schema.tables
    WHERE table_schema = $1
    ORDER BY table_name
    `,
    [targetSchema]
  );
  return result.rows as TableInfo[];
}

/**
 * Describe a table's columns
 */
export async function describeTable(
  table: string,
  schema?: string
): Promise<ColumnInfo[]> {
  const db = getPool();
  const targetSchema = schema || "public";
  const result = await db.query(
    `
    SELECT
      c.column_name as column,
      c.data_type as type,
      c.is_nullable = 'YES' as nullable,
      c.column_default as default,
      COALESCE(tc.constraint_type = 'PRIMARY KEY', false) as primary_key
    FROM information_schema.columns c
    LEFT JOIN information_schema.key_column_usage kcu
      ON c.table_name = kcu.table_name
      AND c.column_name = kcu.column_name
      AND c.table_schema = kcu.table_schema
    LEFT JOIN information_schema.table_constraints tc
      ON kcu.constraint_name = tc.constraint_name
      AND tc.constraint_type = 'PRIMARY KEY'
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position
    `,
    [targetSchema, table]
  );
  return result.rows as ColumnInfo[];
}

/**
 * List all schemas in the database
 */
export async function listSchemas(): Promise<SchemaInfo[]> {
  const db = getPool();
  const result = await db.query(`
    SELECT
      schema_name as name,
      schema_owner as owner
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schema_name
  `);
  return result.rows as SchemaInfo[];
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
  { name: "postgres", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "pg_query",
      description:
        "Run a SELECT query on the PostgreSQL database. Returns rows as JSON.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sql: {
            type: "string",
            description: "SQL SELECT query to execute",
          },
          params: {
            type: "array",
            items: {},
            description: "Query parameters for parameterized queries ($1, $2, etc.)",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "pg_execute",
      description:
        "Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP). Returns affected row count.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sql: {
            type: "string",
            description: "SQL statement to execute",
          },
          params: {
            type: "array",
            items: {},
            description: "Query parameters for parameterized queries ($1, $2, etc.)",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "pg_list_tables",
      description: "List all tables in a schema (default: public)",
      inputSchema: {
        type: "object" as const,
        properties: {
          schema: {
            type: "string",
            description: "Schema name (default: public)",
          },
        },
      },
    },
    {
      name: "pg_describe_table",
      description: "Get column information for a table",
      inputSchema: {
        type: "object" as const,
        properties: {
          table: {
            type: "string",
            description: "Table name",
          },
          schema: {
            type: "string",
            description: "Schema name (default: public)",
          },
        },
        required: ["table"],
      },
    },
    {
      name: "pg_list_schemas",
      description: "List all schemas in the database",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ],
}));

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "pg_query": {
        const { sql, params } = args as { sql: string; params?: unknown[] };
        const result = await query(sql, params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "pg_execute": {
        const { sql, params } = args as { sql: string; params?: unknown[] };
        const result = await execute(sql, params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "pg_list_tables": {
        const { schema } = args as { schema?: string };
        const result = await listTables(schema);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "pg_describe_table": {
        const { table, schema } = args as { table: string; schema?: string };
        const result = await describeTable(table, schema);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "pg_list_schemas": {
        const result = await listSchemas();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// =============================================================================
// STARTUP
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PostgreSQL MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
