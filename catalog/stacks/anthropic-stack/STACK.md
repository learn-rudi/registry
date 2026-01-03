# Anthropic Agent SDK

Build autonomous AI agents with Claude. Give agents tools and let them work independently on complex tasks.

## Features

- **3 Latest Models**: Opus 4.5, Sonnet 4.5, Haiku 4.5
- **Built-in Tools**: File ops, bash, web search, and more
- **Custom MCP Tools**: Add your own tools (APIs, databases, etc.)
- **Python & TypeScript**: Both runtimes fully supported
- **Hooks**: Pre/post-process tool calls
- **Sub-agents**: Spawn specialized agents for subtasks

## Quick Start

### Python

```bash
cd python
python -m venv .venv && source .venv/bin/activate
pip install claude-agent-sdk anyio
ANTHROPIC_API_KEY="sk-ant-..." python api.py
```

### TypeScript

```bash
cd typescript
npm install
ANTHROPIC_API_KEY="sk-ant-..." npx tsx api.ts
```

## Models

| Model | ID | Speed | Best For | Cost |
|-------|-----|-------|----------|------|
| **Haiku 4.5** | `claude-haiku-4-5-20251001` | Fastest | Quick tasks, high volume | $1/$5 per MTok |
| **Sonnet 4.5** | `claude-sonnet-4-5-20250929` | Fast | Complex agents, coding | $3/$15 per MTok |
| **Opus 4.5** | `claude-opus-4-5-20251101` | Moderate | Maximum intelligence | $5/$25 per MTok |

## API Usage

### Python

```python
from api import ask, ask_haiku, ask_sonnet, ask_opus

# Simple query (no tools)
result = await ask_sonnet("Explain quantum computing")
print(result["text"])

# With tools (autonomous agent)
from claude_agent_sdk import query, ClaudeAgentOptions

options = ClaudeAgentOptions(
    model="claude-sonnet-4-5-20250929",
    allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permission_mode="acceptEdits",
    max_turns=10,
)

async for msg in query(prompt="Refactor api.py to add error handling", options=options):
    pass  # Agent works autonomously
```

### TypeScript

```typescript
import { ask, askHaiku, askSonnet, askOpus } from "./api.js";

// Simple query (no tools)
const result = await askSonnet("Explain quantum computing");
console.log(result.text);

// With tools (autonomous agent)
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
  prompt: "Add unit tests for the api module",
  options: {
    model: "claude-sonnet-4-5-20250929",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    maxTurns: 10,
  },
});

for await (const msg of response) {
  // Agent works autonomously
}
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `Read` | Read files (text, images, PDFs, notebooks) |
| `Write` | Create new files |
| `Edit` | Edit existing files |
| `Bash` | Run shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebFetch` | Fetch and analyze web pages |
| `WebSearch` | Search the web |
| `Task` | Spawn sub-agents |

## Custom MCP Tools

```python
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool("weather", "Get weather for a location", {"location": str})
async def get_weather(args):
    # Call your weather API
    return {"content": [{"type": "text", "text": f"Weather in {args['location']}: 72°F"}]}

server = create_sdk_mcp_server(
    name="my-tools",
    version="1.0.0",
    tools=[get_weather]
)

options = ClaudeAgentOptions(
    mcp_servers={"tools": server},
    allowed_tools=["mcp__tools__weather"],
)
```

## Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Ask for approval on each tool use |
| `acceptEdits` | Auto-approve file edits |
| `bypassPermissions` | Auto-approve everything |
| `plan` | Planning mode, no execution |

## Environment Setup

Create `.env` file:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from: https://console.anthropic.com/settings/keys

## Architecture

```
anthropic-stack/
├── python/
│   ├── api.py          # Simple API interface
│   ├── agent.py        # Full agent examples
│   └── models.py       # Model IDs & config
└── typescript/
    ├── api.ts          # Simple API interface
    ├── agent.ts        # Full agent examples
    └── models.ts       # Model IDs & config
```

## Use Cases

- **Coding Agents**: Read, write, and refactor code autonomously
- **Research Agents**: Search web, analyze documents, summarize findings
- **Data Agents**: Query databases, process files, generate reports
- **Workflow Automation**: Chain multiple tools for complex tasks

## License

MIT
