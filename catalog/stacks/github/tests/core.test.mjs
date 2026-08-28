import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BODY_LENGTH,
  addComment,
  createOrUpdateFile,
  createIssue,
  createPullRequest,
  createRepo,
  getConfigStatus,
  githubAuthStatus,
  githubRestRequest,
  listRepos,
  mergePullRequest,
} from "../dist/core.js";

function makeFetch(responseBody = {}, responseInit = {}) {
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
        return typeof responseBody === "string"
          ? responseBody
          : JSON.stringify(responseBody);
      },
    };
  };

  return { calls, fetchImpl };
}

test("config status does not equate GitHub token presence with authentication", () => {
  const status = getConfigStatus({
    GITHUB_TOKEN: "test-token-redacted",
  });

  assert.equal(status.token_configured, true);
  assert.equal(status.can_authenticate, false);
  assert.equal(JSON.stringify(status).includes("test-token-redacted"), false);
});

test("auth status verifies the configured GitHub identity without exposing credentials", async () => {
  const { calls, fetchImpl } = makeFetch({
    login: "rudijetson",
    id: 123,
  });

  const status = await githubAuthStatus(
    {},
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/user");
  assert.equal(status.credential_present, true);
  assert.equal(status.provider_verified, true);
  assert.equal(status.can_authenticate, true);
  assert.equal(status.authenticated_login, "rudijetson");
  assert.equal(JSON.stringify(status).includes("test-token-redacted"), false);
});

test("auth status accepts a provider-issued Enterprise Managed User login", async () => {
  const { fetchImpl } = makeFetch({ login: "alice_acme" });

  const status = await githubAuthStatus(
    {},
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(status.provider_verified, true);
  assert.equal(status.authenticated_login, "alice_acme");
});

test("auth status never reflects the configured token as the provider login", async () => {
  const token = "github_pat_REFLECTED_TOKEN";
  const { fetchImpl } = makeFetch({ login: token });

  const status = await githubAuthStatus(
    {},
    {
      env: { GITHUB_TOKEN: token },
      fetchImpl,
    }
  );

  assert.equal(status.provider_verified, false);
  assert.equal(status.can_authenticate, false);
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.match(status.blocker, /invalid authenticated user login/);
});

test("auth status never echoes credentials embedded in a custom API base URL", async () => {
  const status = await githubAuthStatus(
    {},
    {
      env: {
        GITHUB_TOKEN: "test-token-redacted",
        GITHUB_API_BASE_URL: "https://reader:supersecret@ghe.example.com/api/v3",
      },
    }
  );

  assert.equal(status.provider_verified, false);
  assert.equal(JSON.stringify(status).includes("reader"), false);
  assert.equal(JSON.stringify(status).includes("supersecret"), false);
  assert.match(status.blocker, /must not include credentials/);
});

test("auth status safely reports a missing GitHub token without calling the provider", async () => {
  const { calls, fetchImpl } = makeFetch({ login: "should-not-be-called" });

  const status = await githubAuthStatus(
    {},
    {
      env: {},
      fetchImpl,
    }
  );

  assert.equal(calls.length, 0);
  assert.deepEqual(status, {
    credential_present: false,
    token_configured: false,
    provider_verified: false,
    can_authenticate: false,
    api_base_url: "https://api.github.com",
    blocker: "Set GITHUB_TOKEN in RUDI secrets.",
  });
});

test("auth status safely reports a GitHub-rejected token", async () => {
  const { fetchImpl } = makeFetch(
    { message: "Bad credentials: test-token-redacted" },
    { ok: false, status: 401, statusText: "Unauthorized" }
  );

  const status = await githubAuthStatus(
    {},
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(status.credential_present, true);
  assert.equal(status.provider_verified, false);
  assert.equal(status.can_authenticate, false);
  assert.equal(status.provider_status, 401);
  assert.match(status.blocker, /GitHub identity verification failed/);
  assert.equal(JSON.stringify(status).includes("test-token-redacted"), false);
});

test("listRepos builds an authenticated bounded GitHub API request", async () => {
  const { calls, fetchImpl } = makeFetch([
    {
      id: 1,
      name: "registry",
      full_name: "learnrudi/registry",
      private: true,
      html_url: "https://github.com/learnrudi/registry",
      default_branch: "main",
      archived: false,
      fork: false,
    },
  ]);

  const result = await listRepos(
    {
      per_page: 25,
      visibility: "private",
      affiliation: ["owner", "collaborator"],
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/user/repos?per_page=25&visibility=private&affiliation=owner%2Ccollaborator"
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token-redacted");
  assert.equal(result.repositories[0].full_name, "learnrudi/registry");
  assert.equal(JSON.stringify(result).includes("test-token-redacted"), false);
});

test("createPullRequest dry-runs unless explicitly confirmed", async () => {
  const { fetchImpl, calls } = makeFetch();

  const result = await createPullRequest(
    {
      owner: "learnrudi",
      repo: "registry",
      title: "Add GitHub stack",
      head: "codex/github-stack",
      base: "main",
      body: "Wire the stack.",
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(result.dry_run, true);
  assert.equal(result.would_create.owner, "learnrudi");
  assert.equal(calls.length, 0);
});

test("createIssue posts a bounded issue body when confirmed", async () => {
  const { fetchImpl, calls } = makeFetch({
    id: 123,
    number: 7,
    title: "Finish GitHub stack",
    html_url: "https://github.com/learnrudi/registry/issues/7",
    state: "open",
  });

  const result = await createIssue(
    {
      owner: "learnrudi",
      repo: "registry",
      title: "Finish GitHub stack",
      body: "Implementation is missing.",
      labels: ["stack"],
      assignees: ["example-user"],
      confirm_create: true,
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/learnrudi/registry/issues"
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    title: "Finish GitHub stack",
    body: "Implementation is missing.",
    labels: ["stack"],
    assignees: ["example-user"],
  });
  assert.equal(result.issue.number, 7);
});

test("addComment dry-runs and rejects oversized bodies", async () => {
  const { fetchImpl, calls } = makeFetch();

  const dryRun = await addComment(
    {
      owner: "learnrudi",
      repo: "registry",
      issue_number: 7,
      body: "Looks right.",
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(dryRun.dry_run, true);
  assert.equal(calls.length, 0);
  await assert.rejects(
    () =>
      addComment(
        {
          owner: "learnrudi",
          repo: "registry",
          issue_number: 7,
          body: "x".repeat(MAX_BODY_LENGTH + 1),
        },
        {
          env: { GITHUB_TOKEN: "test-token-redacted" },
          fetchImpl,
        }
      ),
    /body must be/
  );
});

test("GitHub API errors are structured and redact configured tokens", async () => {
  const { fetchImpl } = makeFetch(
    {
      message: "bad token test-token-redacted",
      documentation_url: "https://docs.github.com/rest",
    },
    { ok: false, status: 401, statusText: "Unauthorized" }
  );

  await assert.rejects(
    () =>
      listRepos(
        { per_page: 1 },
        {
          env: { GITHUB_TOKEN: "test-token-redacted" },
          fetchImpl,
        }
      ),
    (error) => {
      assert.match(error.message, /GitHub API error 401/);
      assert.equal(error.message.includes("test-token-redacted"), false);
      assert.match(error.message, /\[REDACTED_TOKEN\]/);
      return true;
    }
  );
});

test("permission guidance reports provider-accepted permissions without exposing credentials", async () => {
  const { fetchImpl } = makeFetch(
    {
      message: "Resource not accessible by personal access token",
      documentation_url: "https://docs.github.com/rest/pulls/pulls#create-a-pull-request",
    },
    {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: { "x-accepted-github-permissions": "pull_requests=write" },
    }
  );

  await assert.rejects(
    () =>
      createPullRequest(
        {
          owner: "learnrudi",
          repo: "registry",
          title: "Verify permission guidance",
          head: "fix/github-auth-readiness",
          base: "main",
          confirm_create: true,
        },
        {
          env: { GITHUB_TOKEN: "test-token-redacted" },
          fetchImpl,
        }
      ),
    (error) => {
      assert.match(error.message, /GitHub API error 403/);
      assert.match(error.message, /Accepted GitHub permissions: pull_requests=write/);
      assert.equal(error.message.includes("test-token-redacted"), false);
      return true;
    }
  );
});

test("permission guidance never reflects a credential-shaped provider header", async () => {
  const { fetchImpl } = makeFetch(
    { message: "Forbidden" },
    {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: { "x-accepted-github-permissions": "test-token-redacted" },
    }
  );

  await assert.rejects(
    () => listRepos({}, { env: { GITHUB_TOKEN: "test-token-redacted" }, fetchImpl }),
    (error) => {
      assert.equal(error.message.includes("test-token-redacted"), false);
      assert.equal(error.message.includes("Accepted GitHub permissions"), false);
      return true;
    }
  );
});

test("permission guidance names pull-request write access when GitHub omits permission headers", async () => {
  const { fetchImpl } = makeFetch(
    { message: "Resource not accessible by personal access token" },
    { ok: false, status: 403, statusText: "Forbidden" }
  );

  await assert.rejects(
    () =>
      createPullRequest(
        {
          owner: "learnrudi",
          repo: "registry",
          title: "Verify permission fallback",
          head: "fix/github-auth-readiness",
          base: "main",
          confirm_create: true,
        },
        {
          env: { GITHUB_TOKEN: "test-token-redacted" },
          fetchImpl,
        }
      ),
    /Required repository permission: Pull requests \(write\)/
  );
});

test("githubRestRequest supports arbitrary reads and confirmation-gates writes", async () => {
  const { fetchImpl, calls } = makeFetch({ ok: true });

  const read = await githubRestRequest(
    {
      method: "GET",
      path: "/repos/learnrudi/registry/actions/runs",
      query: { per_page: 5 },
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(read.status, "ok");
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/learnrudi/registry/actions/runs?per_page=5"
  );

  const dryRun = await githubRestRequest(
    {
      method: "POST",
      path: "/repos/learnrudi/registry/dispatches",
      body: { event_type: "sync" },
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(dryRun.dry_run, true);
  assert.equal(calls.length, 1);

  await assert.rejects(
    () =>
      githubRestRequest(
        {
          method: "GET",
          path: "https://evil.example/repos/learnrudi/registry",
        },
        {
          env: { GITHUB_TOKEN: "test-token-redacted" },
          fetchImpl,
        }
      ),
    /path must start/
  );
});

test("createRepo dry-runs and can create a user repository when confirmed", async () => {
  const { fetchImpl, calls } = makeFetch({
    id: 10,
    name: "agent-tools",
    full_name: "example/agent-tools",
    private: true,
    html_url: "https://github.com/example/agent-tools",
  });

  const dryRun = await createRepo(
    {
      name: "agent-tools",
      private: true,
      description: "MCP helper repo",
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(dryRun.dry_run, true);
  assert.equal(calls.length, 0);

  const created = await createRepo(
    {
      name: "agent-tools",
      private: true,
      description: "MCP helper repo",
      confirm_create: true,
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/user/repos");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: "agent-tools",
    description: "MCP helper repo",
    private: true,
  });
  assert.equal(created.repository.full_name, "example/agent-tools");
});

test("createOrUpdateFile encodes content and requires confirmation", async () => {
  const { fetchImpl, calls } = makeFetch({
    content: {
      path: "README.md",
      sha: "new-sha",
      html_url: "https://github.com/learnrudi/registry/blob/main/README.md",
    },
    commit: {
      sha: "commit-sha",
      html_url: "https://github.com/learnrudi/registry/commit/commit-sha",
    },
  });

  const dryRun = await createOrUpdateFile(
    {
      owner: "learnrudi",
      repo: "registry",
      path: "README.md",
      message: "Update README",
      content: "hello\nworld\n",
      branch: "main",
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(dryRun.dry_run, true);
  assert.equal(calls.length, 0);

  await createOrUpdateFile(
    {
      owner: "learnrudi",
      repo: "registry",
      path: "README.md",
      message: "Update README",
      content: "hello\nworld\n",
      branch: "main",
      confirm_write: true,
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/learnrudi/registry/contents/README.md"
  );
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    message: "Update README",
    content: Buffer.from("hello\nworld\n", "utf8").toString("base64"),
    branch: "main",
  });
});

test("mergePullRequest dry-runs and posts merge options when confirmed", async () => {
  const { fetchImpl, calls } = makeFetch({
    sha: "merge-sha",
    merged: true,
    message: "Pull Request successfully merged",
  });

  const dryRun = await mergePullRequest(
    {
      owner: "learnrudi",
      repo: "registry",
      pull_number: 12,
      merge_method: "squash",
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(dryRun.dry_run, true);
  assert.equal(calls.length, 0);

  const merged = await mergePullRequest(
    {
      owner: "learnrudi",
      repo: "registry",
      pull_number: 12,
      commit_title: "Merge registry GitHub stack",
      merge_method: "squash",
      confirm_merge: true,
    },
    {
      env: { GITHUB_TOKEN: "test-token-redacted" },
      fetchImpl,
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/learnrudi/registry/pulls/12/merge"
  );
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    commit_title: "Merge registry GitHub stack",
    merge_method: "squash",
  });
  assert.equal(merged.merge.merged, true);
});
