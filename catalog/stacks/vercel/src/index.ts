#!/usr/bin/env node
/**
 * Vercel MCP Server
 * Deploy to Vercel, manage environment variables, and monitor deployments
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { listProjects, setEnvVariable, deploy, ... } from './index'
 *   - As CLI: node index.ts projects | env <project> | deploy <project> | ...
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

const VERCEL_API_BASE = "https://api.vercel.com";

function getToken(): string {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error("VERCEL_TOKEN environment variable not set");
  }
  return token;
}

const VERCEL_ORG_ID = process.env.VERCEL_ORG_ID;

/**
 * Helper function to make Vercel API requests
 */
async function vercelFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const token = getToken();
  const url = new URL(path, VERCEL_API_BASE).toString();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (VERCEL_ORG_ID) {
    headers["X-Vercel-Team-Id"] = VERCEL_ORG_ID;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Vercel API error: ${response.status} - ${(error as any).error?.message || JSON.stringify(error)}`
    );
  }

  return response.json();
}

// Types
export interface Project {
  id: string;
  name: string;
  framework: string | null;
}

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  target: string[];
  type: string;
}

export interface Deployment {
  uid: string;
  url: string;
  state: string;
  created: number;
  target: string;
}

/**
 * List all Vercel projects
 */
export async function listProjects(): Promise<Project[]> {
  const data = (await vercelFetch("/v9/projects")) as { projects: Project[] };
  return data.projects || [];
}

/**
 * Get project details
 */
export async function getProject(projectNameOrId: string): Promise<Project> {
  const data = (await vercelFetch(`/v9/projects/${projectNameOrId}`)) as Project;
  return data;
}

/**
 * Get environment variables for a project
 */
export async function getEnvVariables(projectNameOrId: string): Promise<EnvVariable[]> {
  const data = (await vercelFetch(`/v9/projects/${projectNameOrId}/env`)) as {
    envs: EnvVariable[];
  };
  return data.envs || [];
}

/**
 * Set or update environment variable for a project
 */
export async function setEnvVariable(
  projectNameOrId: string,
  key: string,
  value: string,
  targets: string[] = ["production", "preview", "development"]
): Promise<{ success: boolean; message: string }> {
  // Check for existing variable
  const existing = await getEnvVariables(projectNameOrId);
  const existingVar = existing.find(
    (v) => v.key === key && targets.some((t) => v.target.includes(t))
  );

  if (existingVar) {
    // Update existing variable
    await vercelFetch(`/v9/projects/${projectNameOrId}/env/${existingVar.id}`, {
      method: "PATCH",
      body: JSON.stringify({ value, target: targets }),
    });
    return { success: true, message: `Updated ${key} for ${targets.join(", ")}` };
  }

  // Create new variable
  await vercelFetch(`/v10/projects/${projectNameOrId}/env`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      target: targets,
      type: "encrypted",
    }),
  });

  return { success: true, message: `Added ${key} to ${targets.join(", ")}` };
}

/**
 * Remove environment variable
 */
export async function removeEnvVariable(
  projectNameOrId: string,
  envId: string
): Promise<{ success: boolean; message: string }> {
  await vercelFetch(`/v9/projects/${projectNameOrId}/env/${envId}`, {
    method: "DELETE",
  });
  return { success: true, message: "Environment variable removed" };
}

/**
 * List deployments for a project
 */
export async function listDeployments(
  projectNameOrId: string,
  limit = 10
): Promise<Deployment[]> {
  const data = (await vercelFetch(
    `/v6/deployments?projectId=${projectNameOrId}&limit=${limit}`
  )) as { deployments: Deployment[] };
  return data.deployments || [];
}

/**
 * Get deployment details
 */
export async function getDeployment(deploymentId: string): Promise<Deployment> {
  const data = (await vercelFetch(`/v13/deployments/${deploymentId}`)) as Deployment;
  return data;
}

/**
 * Trigger a deployment
 */
export async function triggerDeployment(
  projectNameOrId: string,
  target: "production" | "preview" = "production"
): Promise<{ success: boolean; url: string; deploymentId: string }> {
  const project = await getProject(projectNameOrId);
  const data = (await vercelFetch("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name: project.name,
      project: projectNameOrId,
      target,
    }),
  })) as { id: string; url: string };

  return {
    success: true,
    url: `https://${data.url}`,
    deploymentId: data.id,
  };
}

/**
 * Promote a deployment to production
 */
export async function promoteDeployment(
  deploymentId: string
): Promise<{ success: boolean; message: string }> {
  await vercelFetch(`/v10/deployments/${deploymentId}/promote`, {
    method: "POST",
  });
  return { success: true, message: "Deployment promoted to production" };
}

/**
 * Get deployment logs
 */
export async function getDeploymentLogs(
  deploymentId: string
): Promise<{ logs: string[] }> {
  const data = (await vercelFetch(`/v2/deployments/${deploymentId}/events`)) as {
    events?: Array<{ text?: string }>;
  };
  const logs = (data.events || []).filter((e) => e.text).map((e) => e.text as string);
  return { logs };
}

/**
 * List domains for a project
 */
export async function listDomains(projectNameOrId: string): Promise<string[]> {
  const data = (await vercelFetch(
    `/v9/projects/${projectNameOrId}/domains`
  )) as { domains: Array<{ name: string }> };
  return (data.domains || []).map((d) => d.name);
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

const server = new Server(
  { name: "vercel", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "vercel_list_projects",
      description: "List all Vercel projects in your account",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "vercel_get_project",
      description: "Get details about a specific Vercel project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Project name or ID (e.g., 'resonance' or 'prj_...')",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "vercel_set_env_variable",
      description: "Set or update an environment variable for a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
          key: { type: "string", description: "Environment variable name (e.g., 'OPENAI_API_KEY')" },
          value: { type: "string", description: "Environment variable value" },
          targets: {
            type: "array",
            items: { type: "string" },
            description: "Environments: production, preview, development. Defaults to all.",
          },
        },
        required: ["project_id", "key", "value"],
      },
    },
    {
      name: "vercel_get_env_variables",
      description: "Get all environment variables for a project (values redacted)",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
        },
        required: ["project_id"],
      },
    },
    {
      name: "vercel_remove_env_variable",
      description: "Remove an environment variable from a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
          env_id: { type: "string", description: "Environment variable ID (from vercel_get_env_variables)" },
        },
        required: ["project_id", "env_id"],
      },
    },
    {
      name: "vercel_list_deployments",
      description: "List recent deployments for a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
          limit: { type: "number", description: "Number of deployments (default: 10)" },
        },
        required: ["project_id"],
      },
    },
    {
      name: "vercel_get_deployment",
      description: "Get details about a specific deployment",
      inputSchema: {
        type: "object",
        properties: {
          deployment_id: { type: "string", description: "Deployment ID or URL" },
        },
        required: ["deployment_id"],
      },
    },
    {
      name: "vercel_deploy",
      description: "Trigger a new deployment for a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
          target: { type: "string", enum: ["production", "preview"], description: "Deployment target (default: production)" },
        },
        required: ["project_id"],
      },
    },
    {
      name: "vercel_promote_deployment",
      description: "Promote a preview deployment to production",
      inputSchema: {
        type: "object",
        properties: {
          deployment_id: { type: "string", description: "Deployment ID to promote" },
        },
        required: ["deployment_id"],
      },
    },
    {
      name: "vercel_get_logs",
      description: "Get build logs for a deployment",
      inputSchema: {
        type: "object",
        properties: {
          deployment_id: { type: "string", description: "Deployment ID" },
        },
        required: ["deployment_id"],
      },
    },
    {
      name: "vercel_list_domains",
      description: "List domains connected to a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project name or ID" },
        },
        required: ["project_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "vercel_list_projects") {
      const projects = await listProjects();
      const summary = projects.map((p) => ({ id: p.id, name: p.name, framework: p.framework }));
      return { content: [{ type: "text", text: `Found ${projects.length} projects:\n${JSON.stringify(summary, null, 2)}` }] };
    }

    if (name === "vercel_get_project") {
      const project = await getProject(args?.project_id as string);
      return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
    }

    if (name === "vercel_set_env_variable") {
      const result = await setEnvVariable(
        args?.project_id as string,
        args?.key as string,
        args?.value as string,
        (args?.targets as string[]) || ["production", "preview", "development"]
      );
      return { content: [{ type: "text", text: result.message }] };
    }

    if (name === "vercel_get_env_variables") {
      const envVars = await getEnvVariables(args?.project_id as string);
      const redacted = envVars.map((v) => ({ id: v.id, key: v.key, target: v.target, type: v.type }));
      return { content: [{ type: "text", text: `Found ${envVars.length} environment variables:\n${JSON.stringify(redacted, null, 2)}` }] };
    }

    if (name === "vercel_remove_env_variable") {
      const result = await removeEnvVariable(args?.project_id as string, args?.env_id as string);
      return { content: [{ type: "text", text: result.message }] };
    }

    if (name === "vercel_list_deployments") {
      const deployments = await listDeployments(args?.project_id as string, (args?.limit as number) || 10);
      const summary = deployments.map((d) => ({
        id: d.uid,
        url: d.url,
        state: d.state,
        target: d.target,
        created: new Date(d.created).toISOString(),
      }));
      return { content: [{ type: "text", text: `Recent deployments:\n${JSON.stringify(summary, null, 2)}` }] };
    }

    if (name === "vercel_get_deployment") {
      const deployment = await getDeployment(args?.deployment_id as string);
      return { content: [{ type: "text", text: JSON.stringify(deployment, null, 2) }] };
    }

    if (name === "vercel_deploy") {
      const result = await triggerDeployment(
        args?.project_id as string,
        (args?.target as "production" | "preview") || "production"
      );
      return { content: [{ type: "text", text: `Deployment triggered!\nURL: ${result.url}\nDeployment ID: ${result.deploymentId}` }] };
    }

    if (name === "vercel_promote_deployment") {
      const result = await promoteDeployment(args?.deployment_id as string);
      return { content: [{ type: "text", text: result.message }] };
    }

    if (name === "vercel_get_logs") {
      const result = await getDeploymentLogs(args?.deployment_id as string);
      return { content: [{ type: "text", text: result.logs.length ? result.logs.join("\n") : "No logs available" }] };
    }

    if (name === "vercel_list_domains") {
      const domains = await listDomains(args?.project_id as string);
      return { content: [{ type: "text", text: domains.length ? `Domains:\n${domains.map((d) => `  - ${d}`).join("\n")}` : "No custom domains configured" }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const cliArgs = process.argv.slice(2);

// CLI mode
if (cliArgs.length > 0 && ["projects", "env", "deploy", "deployments", "domains"].includes(cliArgs[0])) {
  const command = cliArgs[0];

  (async () => {
    try {
      if (command === "projects") {
        const projects = await listProjects();
        console.log(JSON.stringify(projects, null, 2));
      } else if (command === "env") {
        if (cliArgs.length < 2) {
          console.error("Usage: node index.js env <project> [set <key> <value>]");
          process.exit(1);
        }
        if (cliArgs[2] === "set" && cliArgs.length >= 5) {
          const result = await setEnvVariable(cliArgs[1], cliArgs[3], cliArgs[4]);
          console.log(result.message);
        } else {
          const envVars = await getEnvVariables(cliArgs[1]);
          console.log(JSON.stringify(envVars.map((v) => ({ ...v, value: "[REDACTED]" })), null, 2));
        }
      } else if (command === "deploy") {
        if (cliArgs.length < 2) {
          console.error("Usage: node index.js deploy <project> [production|preview]");
          process.exit(1);
        }
        const target = (cliArgs[2] as "production" | "preview") || "production";
        const result = await triggerDeployment(cliArgs[1], target);
        console.log(`Deployed: ${result.url}`);
      } else if (command === "deployments") {
        if (cliArgs.length < 2) {
          console.error("Usage: node index.js deployments <project> [limit]");
          process.exit(1);
        }
        const limit = cliArgs[2] ? parseInt(cliArgs[2]) : 10;
        const deployments = await listDeployments(cliArgs[1], limit);
        console.log(JSON.stringify(deployments, null, 2));
      } else if (command === "domains") {
        if (cliArgs.length < 2) {
          console.error("Usage: node index.js domains <project>");
          process.exit(1);
        }
        const domains = await listDomains(cliArgs[1]);
        console.log(domains.join("\n"));
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  })();
}
// MCP mode: no args, JSON-RPC over stdio
else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
