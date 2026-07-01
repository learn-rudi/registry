import assert from "node:assert/strict";
import test from "node:test";
import {
  createProject,
  generateCliWorkflow,
  generateMcpConfig,
  getConfigStatus,
  getConnectionString,
  listProjects,
} from "../dist/core.js";

test("config status reports Neon API key readiness without values", () => {
  const status = getConfigStatus({
    NEON_API_KEY: "test-key",
  });

  assert.equal(status.api_key_configured, true);
  assert.equal(status.can_authenticate, true);
  assert.equal(JSON.stringify(status).includes("test-key"), false);
});

function makeFetch(responseBody = { ok: true }, responseInit = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: responseInit.ok ?? true,
      status: responseInit.status ?? 200,
      statusText: responseInit.statusText ?? "OK",
      headers: {
        get(name) {
          return responseInit.headers?.[name.toLowerCase()] ?? null;
        },
      },
      async text() {
        return JSON.stringify(responseBody);
      },
    };
  };

  return { fetchImpl, calls };
}

test("listProjects builds an authenticated bounded Neon API request", async () => {
  const { fetchImpl, calls } = makeFetch({ projects: [] });

  const result = await listProjects(
    { limit: 25, search: "architect", org_id: "org-example" },
    {
      env: { NEON_API_KEY: "test-key" },
      fetchImpl,
    }
  );

  assert.deepEqual(result, { projects: [] });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://console.neon.tech/api/v2/projects?limit=25&search=architect&org_id=org-example"
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
});

test("createProject dry-runs unless explicitly confirmed", async () => {
  const { fetchImpl, calls } = makeFetch();

  const result = await createProject(
    { name: "architect-dev", org_id: "org-example" },
    {
      env: { NEON_API_KEY: "test-key" },
      fetchImpl,
    }
  );

  assert.equal(result.dry_run, true);
  assert.equal(result.would_create.project.name, "architect-dev");
  assert.equal(calls.length, 0);
});

test("createProject posts project body when confirm_create is true", async () => {
  const { fetchImpl, calls } = makeFetch({ project: { id: "cool-rain-123456" } });

  await createProject(
    {
      name: "architect-dev",
      org_id: "org-example",
      region_id: "aws-us-east-2",
      pg_version: 17,
      branch_name: "main",
      database_name: "architect",
      role_name: "architect_owner",
      confirm_create: true,
    },
    {
      env: { NEON_API_KEY: "test-key" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://console.neon.tech/api/v2/projects?org_id=org-example");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    project: {
      name: "architect-dev",
      region_id: "aws-us-east-2",
      pg_version: 17,
      branch: {
        name: "main",
        database_name: "architect",
        role_name: "architect_owner",
      },
    },
  });
});

test("getConnectionString redacts credentials by default", async () => {
  const uri = "postgresql://alice:super-secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const { fetchImpl } = makeFetch({ uri });

  const result = await getConnectionString(
    {
      project_id: "cool-rain-123456",
      database_name: "neondb",
      role_name: "alice",
    },
    {
      env: { NEON_API_KEY: "test-key" },
      fetchImpl,
    }
  );

  const serialized = JSON.stringify(result);
  assert.equal(result.connection_uri, undefined);
  assert.match(result.connection_uri_redacted, /postgresql:\/\/alice:\*\*\*@/);
  assert.equal(serialized.includes("super-secret"), false);
});

test("getConnectionString only reveals credentials with explicit confirmation", async () => {
  const uri = "postgresql://alice:super-secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const { fetchImpl } = makeFetch({ uri });

  const result = await getConnectionString(
    {
      project_id: "cool-rain-123456",
      database_name: "neondb",
      role_name: "alice",
      reveal: true,
      confirm_sensitive: true,
    },
    {
      env: { NEON_API_KEY: "test-key" },
      fetchImpl,
    }
  );

  assert.equal(result.connection_uri, uri);
});

test("generateMcpConfig returns safe Neon managed MCP config", () => {
  const config = generateMcpConfig({
    auth_mode: "api_key",
    readonly: true,
    project_id: "cool-rain-123456",
    categories: ["projects", "branches"],
  });

  assert.deepEqual(config.mcp_config, {
    mcpServers: {
      neon: {
        type: "http",
        url: "https://mcp.neon.tech/mcp?readonly=true&projectId=cool-rain-123456&category=projects&category=branches",
        headers: {
          Authorization: "Bearer ${NEON_API_KEY}",
        },
      },
    },
  });
  assert.match(config.production_guardrail, /development and testing/i);
});

test("generateCliWorkflow returns a secret-safe Neon and Vercel CLI plan", () => {
  const workflow = generateCliWorkflow({
    org_id: "org-polished-dew-16323624",
    project_name: "architect-philanthropic-collective",
    region_id: "aws-us-east-1",
    database_name: "architect_ops",
    role_name: "architect_app",
    vercel_environments: ["production", "preview"],
  });

  assert.equal(workflow.sensitive_values_included, false);
  assert.deepEqual(workflow.commands.neon, [
    "neon orgs list",
    "neon projects create --org-id org-polished-dew-16323624 --name architect-philanthropic-collective --region-id aws-us-east-1 --database architect_ops --role architect_app --set-context --output json",
    "neon connection-string --pooled",
  ]);
  assert.deepEqual(workflow.commands.vercel, [
    "vercel env add DATABASE_URL production",
    "vercel env add DATABASE_URL preview",
  ]);
  assert.equal(JSON.stringify(workflow).includes("postgresql://"), false);
});
