/**
 * Anthropic Agent SDK - Complete TypeScript Example
 *
 * Demonstrates the Claude Agent SDK with:
 * - Basic queries
 * - Custom tools (in-process MCP servers)
 * - Hooks for pre-processing
 * - Subagent definitions
 * - Permission handling
 */

import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type HookCallback,
  type HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SONNET_4_5, HAIKU_4_5, OPUS_4_5 } from "./models.js";

// =============================================================================
// CUSTOM TOOLS - Define tools that Claude can use
// =============================================================================

/**
 * Calculator tool - performs safe mathematical calculations
 */
const calculator = tool(
  "calculator",
  "Perform mathematical calculations",
  { expression: z.string().describe("Math expression to evaluate") },
  async (args) => {
    const { expression } = args;

    // Only allow safe math operations
    const allowed = new Set("0123456789+-*/.() ".split(""));
    if (![...expression].every((c) => allowed.has(c))) {
      return {
        content: [{ type: "text", text: "Error: Invalid characters in expression" }],
        isError: true,
      };
    }

    try {
      // Safe due to character filtering
      const result = eval(expression);
      return {
        content: [{ type: "text", text: `Result: ${result}` }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "Unknown error"}` }],
        isError: true,
      };
    }
  }
);

/**
 * Weather tool - mock weather API
 */
const weather = tool(
  "weather",
  "Get current weather for a location",
  { location: z.string().describe("City or location name") },
  async (args) => {
    // In production, call a real weather API
    return {
      content: [{ type: "text", text: `Weather in ${args.location}: 72°F, Partly cloudy` }],
    };
  }
);

/**
 * Documentation search tool
 */
const searchDocs = tool(
  "search_docs",
  "Search internal documentation",
  { query: z.string().describe("Search query") },
  async (args) => {
    return {
      content: [
        {
          type: "text",
          text: `Found 3 results for '${args.query}':\n1. Getting Started Guide\n2. API Reference\n3. Best Practices`,
        },
      ],
    };
  }
);

// =============================================================================
// HOOKS - Pre-process tool calls
// =============================================================================

/**
 * Log all tool usage for monitoring
 */
const logToolUse: HookCallback = async (input, toolUseId, options) => {
  if (input.hook_event_name === "PreToolUse") {
    console.log(`[HOOK] Tool called: ${input.tool_name}`);
  }
  return {};
};

/**
 * Block potentially dangerous bash commands
 */
const blockDangerousCommands: HookCallback = async (input, toolUseId, options) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") {
    return {};
  }

  const command = (input.tool_input as { command?: string })?.command ?? "";
  const dangerousPatterns = ["rm -rf", "sudo", "> /dev/", "mkfs", "dd if="];

  for (const pattern of dangerousPatterns) {
    if (command.includes(pattern)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Blocked dangerous command pattern: ${pattern}`,
        },
      };
    }
  }
  return {};
};

// =============================================================================
// AGENT EXAMPLES
// =============================================================================

/**
 * Helper to extract text from SDK messages
 */
function extractText(message: SDKMessage): string | null {
  if (message.type === "assistant") {
    const assistantMsg = message as SDKAssistantMessage;
    for (const block of assistantMsg.message.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
  }
  return null;
}

/**
 * Basic query example
 */
async function simpleQuery(): Promise<void> {
  console.log("\n=== Simple Query ===");

  const result = query({
    prompt: "What is the capital of France?",
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Query with file system tools enabled
 */
async function queryWithTools(): Promise<void> {
  console.log("\n=== Query with Tools ===");

  const options: Options = {
    allowedTools: ["Read", "Glob", "Grep"],
    maxTurns: 3,
  };

  const result = query({
    prompt: "List all TypeScript files in the current directory",
    options,
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Agent with custom in-process MCP tools
 */
async function agentWithCustomTools(): Promise<void> {
  console.log("\n=== Agent with Custom Tools ===");

  // Create MCP server with our custom tools
  const toolsServer = createSdkMcpServer({
    name: "custom-tools",
    version: "1.0.0",
    tools: [calculator, weather, searchDocs],
  });

  const options: Options = {
    mcpServers: { tools: toolsServer },
    allowedTools: [
      "mcp__tools__calculator",
      "mcp__tools__weather",
      "mcp__tools__search_docs",
    ],
    maxTurns: 5,
  };

  const result = query({
    prompt: "What's 15 * 7 + 23? Then tell me the weather in San Francisco.",
    options,
  });

  for await (const message of result) {
    if (message.type === "assistant") {
      const assistantMsg = message as SDKAssistantMessage;
      for (const block of assistantMsg.message.content) {
        if (block.type === "text") {
          console.log(block.text);
        } else if (block.type === "tool_use") {
          console.log(`[Using tool: ${block.name}]`);
        }
      }
    }
  }
}

/**
 * Agent with pre-processing hooks
 */
async function agentWithHooks(): Promise<void> {
  console.log("\n=== Agent with Hooks ===");

  const hooks: Options["hooks"] = {
    PreToolUse: [
      { matcher: "*", hooks: [logToolUse] },
      { matcher: "Bash", hooks: [blockDangerousCommands] },
    ],
  };

  const options: Options = {
    allowedTools: ["Bash", "Read"],
    hooks,
    maxTurns: 3,
  };

  const result = query({
    prompt: "List files in the current directory using ls",
    options,
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Agent with programmatic subagent definitions
 */
async function agentWithSubagents(): Promise<void> {
  console.log("\n=== Agent with Subagents ===");

  const options: Options = {
    agents: {
      researcher: {
        description: "Use this agent for research tasks and gathering information",
        tools: ["Read", "Glob", "Grep", "WebSearch"],
        prompt: "You are a research specialist. Find and summarize relevant information.",
        model: "haiku", // Use faster model for research
      },
      coder: {
        description: "Use this agent for writing and editing code",
        tools: ["Read", "Write", "Edit", "Bash"],
        prompt: "You are an expert programmer. Write clean, well-documented code.",
        model: "sonnet", // Use smarter model for coding
      },
    },
    allowedTools: ["Task", "Read"],
    maxTurns: 10,
  };

  const result = query({
    prompt: "Find all TODO comments in the codebase",
    options,
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Coding agent configured for file operations
 */
async function codingAgent(): Promise<void> {
  console.log("\n=== Coding Agent ===");

  const options: Options = {
    systemPrompt: "You are an expert TypeScript developer. Write clean, well-documented code.",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    permissionMode: "acceptEdits", // Auto-accept file edits
    maxTurns: 10,
  };

  const result = query({
    prompt: "Create a simple hello.ts file that prints 'Hello, World!'",
    options,
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Example with custom permission handling
 */
async function agentWithCustomPermissions(): Promise<void> {
  console.log("\n=== Agent with Custom Permissions ===");

  const options: Options = {
    allowedTools: ["Bash", "Read", "Write"],
    canUseTool: async (toolName, input, opts) => {
      console.log(`[Permission check] Tool: ${toolName}`);

      // Block writes to certain paths
      if (toolName === "Write") {
        const filePath = (input as { file_path?: string }).file_path ?? "";
        if (filePath.includes("node_modules") || filePath.includes(".git")) {
          return {
            behavior: "deny",
            message: "Cannot write to node_modules or .git directories",
          };
        }
      }

      // Allow everything else
      return {
        behavior: "allow",
        updatedInput: input,
      };
    },
    maxTurns: 5,
  };

  const result = query({
    prompt: "Read the package.json file",
    options,
  });

  for await (const message of result) {
    const text = extractText(message);
    if (text) {
      console.log(text);
    }
  }
}

/**
 * Example showing result handling
 */
async function handleResults(): Promise<void> {
  console.log("\n=== Result Handling ===");

  const result = query({
    prompt: "What is 2 + 2?",
  });

  for await (const message of result) {
    switch (message.type) {
      case "system":
        const sysMsg = message as SDKSystemMessage;
        console.log(`[System] Model: ${sysMsg.model}, Tools: ${sysMsg.tools.length}`);
        break;

      case "assistant":
        const text = extractText(message);
        if (text) {
          console.log(`[Assistant] ${text}`);
        }
        break;

      case "result":
        const resultMsg = message as SDKResultMessage;
        if (resultMsg.subtype === "success") {
          console.log(`[Result] Success! Cost: $${resultMsg.total_cost_usd.toFixed(4)}`);
          console.log(`[Result] Turns: ${resultMsg.num_turns}, Duration: ${resultMsg.duration_ms}ms`);
        } else {
          console.log(`[Result] Error: ${resultMsg.subtype}`);
        }
        break;
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  try {
    await simpleQuery();
    await queryWithTools();
    await agentWithCustomTools();
    await agentWithHooks();
    // await agentWithSubagents();  // Uncomment to test subagents
    // await codingAgent();         // Uncomment to test file creation
    // await agentWithCustomPermissions();
    await handleResults();
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("CLI not found")) {
        console.error("Error: Claude Code CLI not found.");
        console.error("It should be bundled with @anthropic-ai/claude-agent-sdk.");
        console.error("If issues persist, install: curl -fsSL https://claude.ai/install.sh | bash");
      } else {
        console.error(`Error: ${error.message}`);
      }
    } else {
      console.error("Unknown error:", error);
    }
    process.exit(1);
  }
}

main();
