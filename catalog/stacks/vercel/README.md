# Vercel Stack

Deploy to Vercel, manage environment variables, and monitor deployments programmatically.

## Features

- **Project Management** - List and get details about Vercel projects
- **Environment Variables** - Set, list, and remove env vars across all environments
- **Deployments** - View deployment history, promote previews, and rollback
- **One-Command Setup** - Configure projects and deploy in seconds

## Installation

```bash
rudi install vercel
rudi secrets set VERCEL_TOKEN "your_token_here"
rudi integrate claude
```

## Usage

### List Your Projects

```
User: "Show me my Vercel projects"
Agent: [Lists all projects with status and URLs]
```

### Set Environment Variables

```
User: "Add OPENAI_API_KEY to the resonance project for all environments"
Agent: [Adds the variable and confirms]
```

### Deploy

```
User: "Deploy resonance to production"
Agent: [Triggers deployment and returns live URL]
```

### Rollback

```
User: "Show me recent deployments for resonance"
Agent: [Lists deployments]

User: "Rollback to deployment xyz123"
Agent: [Promotes that deployment back to production]
```

## Available Tools

### `vercel_list_projects`
List all your Vercel projects with metadata.

**Example:**
```json
{
  "projects": [
    {
      "id": "prj_...",
      "name": "resonance",
      "latestDeployments": [...],
      "productionDeployment": {...}
    }
  ]
}
```

### `vercel_get_project`
Get details about a specific project.

**Input:**
- `project_id` (string) - Project name or ID

### `vercel_set_env_variable`
Set an environment variable for a project.

**Input:**
- `project_id` (string) - Project name or ID
- `name` (string) - Variable name (e.g., `OPENAI_API_KEY`)
- `value` (string) - Variable value
- `environments` (array, optional) - Environments to set (production, preview, development)

**Example:**
```
Set OPENAI_API_KEY to sk-proj-... in resonance for production, preview, development
```

### `vercel_get_env_variables`
Get all environment variables for a project.

**Input:**
- `project_id` (string) - Project name or ID

### `vercel_remove_env_variable`
Remove an environment variable from a project.

**Input:**
- `project_id` (string) - Project name or ID
- `env_id` (string) - Environment variable ID

### `vercel_list_deployments`
List recent deployments for a project.

**Input:**
- `project_id` (string) - Project name or ID
- `limit` (number, optional) - Number of deployments (default: 10)

### `vercel_get_deployment`
Get details about a specific deployment.

**Input:**
- `deployment_id` (string) - Deployment ID

### `vercel_deploy`
Trigger a new deployment.

**Input:**
- `project_id` (string) - Project name or ID
- `ref` (string, optional) - Git branch/tag to deploy
- `target` (string, optional) - 'production' or 'preview' (default: production)

### `vercel_rollback`
Rollback to a previous deployment by promoting an older one.

**Input:**
- `project_id` (string) - Project name or ID
- `deployment_id` (string) - Deployment ID to rollback to

### `vercel_promote_preview`
Promote a preview deployment to production.

**Input:**
- `project_id` (string) - Project name or ID
- `deployment_id` (string) - Preview deployment ID

## Configuration

### Getting Your Vercel Token

1. Go to https://vercel.com/account/tokens
2. Create a new token with scopes:
   - `read` (read project info)
   - `write` (create/update projects)
   - `deployment_read` (view deployments)
   - `deployment_write` (create deployments)
3. Copy the token and add it:

```bash
rudi secrets set VERCEL_TOKEN "your_token"
```

### Organization ID (Optional)

If you're using a Vercel team account, also set:

```bash
rudi secrets set VERCEL_ORG_ID "your_org_id"
```

Find your org ID at: https://vercel.com/account/settings

## Real-World Example: Deploy Resonance

```
User: "I need to set up the resonance project with OpenAI and Anthropic keys and deploy it"

Agent:
1. Get project: resonance
2. Set OPENAI_API_KEY to sk-proj-...
3. Set ANTHROPIC_API_KEY to sk-ant-...
4. Deploy to production

Result: ✅ Deployed to https://resonance.vercel.app
```

## Cost Tracking

Vercel provides:
- **Free** - 100 deployments/month
- **Pro** - Unlimited deployments
- **Enterprise** - Custom

Check your usage at: https://vercel.com/account/billing/overview

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid token" | Bad/expired VERCEL_TOKEN | Regenerate at https://vercel.com/account/tokens |
| "Project not found" | Wrong project ID/name | Use full project ID (prj_...) |
| "Env var already exists" | Duplicate key | Remove old one first or update value |
| "Not authorized" | Missing org ID | Set VERCEL_ORG_ID if on a team |

## More Information

- Vercel Docs: https://vercel.com/docs
- API Reference: https://vercel.com/docs/rest-api
- CLI Docs: https://vercel.com/docs/cli
