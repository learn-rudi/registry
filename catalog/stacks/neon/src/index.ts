#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_LIST_LIMIT,
  ToolArgs,
  createBranch,
  createProject,
  generateCliWorkflow,
  generateMcpConfig,
  getConfigStatus,
  getConnectionString,
  listBranches,
  listOrgs,
  listProjects,
} from "./core.js";

function asText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    try {
      return JSON.stringify(JSON.parse(error.message), null, 2);
    } catch {
      return error.message;
    }
  }
  return String(error);
}

function asError(error: unknown) {
  return {
    ...asText({ error: errorText(error) }),
    isError: true,
  };
}

const server = new Server(
  { name: "neon", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "neon_config_status",
      description: "Check whether Neon API configuration is present without revealing secret values.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "neon_list_orgs",
      description: "List Neon organizations available to the configured API key.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "neon_list_projects",
      description: "List Neon projects. Supports pagination, search, and optional organization scoping.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: `Maximum projects to return, 1-${MAX_LIST_LIMIT}.`,
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous Neon API response.",
          },
          search: {
            type: "string",
            description: "Search by project name or id.",
          },
          org_id: {
            type: "string",
            description: "Optional Neon organization id.",
          },
        },
      },
    },
    {
      name: "neon_create_project",
      description: "Create a Neon project. Dry-run by default; pass confirm_create: true to create.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Project name.",
          },
          org_id: {
            type: "string",
            description: "Optional Neon organization id.",
          },
          region_id: {
            type: "string",
            description: "Optional Neon region id, e.g. aws-us-east-2.",
          },
          pg_version: {
            type: "number",
            description: "Optional PostgreSQL major version.",
          },
          branch_name: {
            type: "string",
            description: "Optional initial branch name.",
          },
          database_name: {
            type: "string",
            description: "Optional initial database name.",
          },
          role_name: {
            type: "string",
            description: "Optional initial role name.",
          },
          confirm_create: {
            type: "boolean",
            description: "Must be true to create the project. Omit or false for dry-run.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "neon_get_connection_string",
      description: "Retrieve a Neon connection URI for a database and role. Credentials are redacted unless reveal and confirm_sensitive are both true.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Neon project id.",
          },
          branch_id: {
            type: "string",
            description: "Optional branch id. Defaults to the project default branch.",
          },
          endpoint_id: {
            type: "string",
            description: "Optional endpoint id. Defaults to the read-write endpoint for the branch.",
          },
          database_name: {
            type: "string",
            description: "Database name.",
          },
          role_name: {
            type: "string",
            description: "Role name.",
          },
          pooled: {
            type: "boolean",
            description: "Return a pooled connection URI when true.",
          },
          reveal: {
            type: "boolean",
            description: "Request the full sensitive connection URI.",
          },
          confirm_sensitive: {
            type: "boolean",
            description: "Must be true with reveal to return the full sensitive connection URI.",
          },
        },
        required: ["project_id", "database_name", "role_name"],
      },
    },
    {
      name: "neon_create_branch",
      description: "Create a Neon branch. Dry-run by default; pass confirm_create: true to create. A compute is created only when create_compute is true.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Neon project id.",
          },
          name: {
            type: "string",
            description: "Optional branch name.",
          },
          parent_id: {
            type: "string",
            description: "Optional parent branch id.",
          },
          create_compute: {
            type: "boolean",
            description: "Create a read-write compute endpoint for the branch. Defaults to false.",
          },
          confirm_create: {
            type: "boolean",
            description: "Must be true to create the branch. Omit or false for dry-run.",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "neon_list_branches",
      description: "List branches for a Neon project.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Neon project id.",
          },
          limit: {
            type: "number",
            description: `Maximum branches to return, 1-${MAX_LIST_LIMIT}.`,
          },
          cursor: {
            type: "string",
            description: "Pagination cursor from a previous Neon API response.",
          },
          search: {
            type: "string",
            description: "Search by branch name or id.",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "neon_generate_mcp_config",
      description: "Generate a safe Neon managed MCP client configuration. Use MCP for development/testing, not production databases.",
      inputSchema: {
        type: "object",
        properties: {
          server_name: {
            type: "string",
            description: "MCP server name. Defaults to neon.",
          },
          auth_mode: {
            type: "string",
            enum: ["oauth", "api_key"],
            description: "Use oauth for local editors or api_key for remote agent config placeholders.",
          },
          readonly: {
            type: "boolean",
            description: "Append readonly=true to restrict the Neon managed MCP server to read operations.",
          },
          project_id: {
            type: "string",
            description: "Optional Neon project id used to scope the managed MCP server.",
          },
          categories: {
            type: "array",
            description: "Optional Neon MCP category filters such as projects, branches, schema, querying, neon_auth, data_api, or docs.",
            items: {
              type: "string",
              enum: ["projects", "branches", "schema", "querying", "neon_auth", "data_api", "docs"],
            },
          },
        },
      },
    },
    {
      name: "neon_generate_cli_workflow",
      description: "Generate a secret-safe Neon/Vercel/local CLI workflow for project creation, pooled DATABASE_URL setup, migrations, tests, and deploy.",
      inputSchema: {
        type: "object",
        properties: {
          org_id: {
            type: "string",
            description: "Optional Neon organization id.",
          },
          project_name: {
            type: "string",
            description: "Neon project name.",
          },
          region_id: {
            type: "string",
            description: "Neon region id. Defaults to aws-us-east-1.",
          },
          database_name: {
            type: "string",
            description: "Initial database name. Defaults to neondb.",
          },
          role_name: {
            type: "string",
            description: "Initial database role name. Defaults to app.",
          },
          vercel_environments: {
            type: "array",
            description: "Vercel environments that should receive DATABASE_URL.",
            items: {
              type: "string",
            },
          },
          local_env_path: {
            type: "string",
            description: "Local env file path. Defaults to .env.local.",
          },
          include_brew_install: {
            type: "boolean",
            description: "Include brew install neonctl in the install command list.",
          },
          include_npm_install: {
            type: "boolean",
            description: "Include npm i -g neonctl in the install command list. Defaults to true.",
          },
        },
        required: ["project_name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments as ToolArgs;

  try {
    switch (request.params.name) {
      case "neon_config_status":
        return asText(getConfigStatus());
      case "neon_list_orgs":
        return asText(await listOrgs(args));
      case "neon_list_projects":
        return asText(await listProjects(args));
      case "neon_create_project":
        return asText(await createProject(args));
      case "neon_get_connection_string":
        return asText(await getConnectionString(args));
      case "neon_create_branch":
        return asText(await createBranch(args));
      case "neon_list_branches":
        return asText(await listBranches(args));
      case "neon_generate_mcp_config":
        return asText(generateMcpConfig(args));
      case "neon_generate_cli_workflow":
        return asText(generateCliWorkflow(args));
      default:
        return {
          ...asText({ error: `Unknown tool: ${request.params.name}` }),
          isError: true,
        };
    }
  } catch (error) {
    return asError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
