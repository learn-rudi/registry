"""
Anthropic Agent SDK - Complete Example

This demonstrates the Claude Agent SDK with:
- Basic queries
- Custom tools (in-process MCP servers)
- Hooks for pre-processing
- Error handling
"""

import anyio
from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    AssistantMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    tool,
    create_sdk_mcp_server,
    HookMatcher,
    CLINotFoundError,
    ProcessError,
)

from models import SONNET_4_5, HAIKU_4_5, OPUS_4_5


# =============================================================================
# CUSTOM TOOLS - Define tools that Claude can use
# =============================================================================

@tool("calculator", "Perform mathematical calculations", {
    "expression": str,  # Math expression to evaluate
})
async def calculator(args: dict) -> dict:
    """Safe calculator tool - evaluates math expressions."""
    expression = args["expression"]

    # Only allow safe math operations
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        return {
            "content": [{"type": "text", "text": f"Error: Invalid characters in expression"}]
        }

    try:
        result = eval(expression)  # Safe due to character filtering
        return {
            "content": [{"type": "text", "text": f"Result: {result}"}]
        }
    except Exception as e:
        return {
            "content": [{"type": "text", "text": f"Error: {str(e)}"}]
        }


@tool("weather", "Get current weather for a location", {
    "location": str,
})
async def get_weather(args: dict) -> dict:
    """Mock weather tool - replace with real API call."""
    location = args["location"]
    # In production, call a real weather API
    return {
        "content": [{
            "type": "text",
            "text": f"Weather in {location}: 72°F, Partly cloudy"
        }]
    }


@tool("search_docs", "Search internal documentation", {
    "query": str,
})
async def search_docs(args: dict) -> dict:
    """Mock documentation search - replace with real search."""
    query = args["query"]
    return {
        "content": [{
            "type": "text",
            "text": f"Found 3 results for '{query}':\n1. Getting Started Guide\n2. API Reference\n3. Best Practices"
        }]
    }


# =============================================================================
# HOOKS - Pre-process tool calls
# =============================================================================

async def log_tool_use(input_data: dict, tool_use_id: str, context: dict) -> dict:
    """Log all tool usage for monitoring."""
    tool_name = input_data.get("tool_name", "unknown")
    print(f"[HOOK] Tool called: {tool_name}")
    return {}  # Allow the tool to proceed


async def block_dangerous_commands(input_data: dict, tool_use_id: str, context: dict) -> dict:
    """Block potentially dangerous bash commands."""
    if input_data.get("tool_name") != "Bash":
        return {}

    command = input_data.get("tool_input", {}).get("command", "")
    dangerous_patterns = ["rm -rf", "sudo", "> /dev/", "mkfs", "dd if="]

    for pattern in dangerous_patterns:
        if pattern in command:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"Blocked dangerous command pattern: {pattern}",
                }
            }
    return {}


# =============================================================================
# AGENT EXAMPLES
# =============================================================================

async def simple_query():
    """Basic query example."""
    print("\n=== Simple Query ===")

    async for message in query(prompt="What is the capital of France?"):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text)


async def query_with_tools():
    """Query with file system tools enabled."""
    print("\n=== Query with Tools ===")

    options = ClaudeAgentOptions(
        allowed_tools=["Read", "Glob", "Grep"],
        max_turns=3,
    )

    async for message in query(
        prompt="List all Python files in the current directory",
        options=options
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text)


async def agent_with_custom_tools():
    """Agent with custom in-process MCP tools."""
    print("\n=== Agent with Custom Tools ===")

    # Create MCP server with our custom tools
    tools_server = create_sdk_mcp_server(
        name="custom-tools",
        version="1.0.0",
        tools=[calculator, get_weather, search_docs]
    )

    options = ClaudeAgentOptions(
        mcp_servers={"tools": tools_server},
        allowed_tools=[
            "mcp__tools__calculator",
            "mcp__tools__weather",
            "mcp__tools__search_docs",
        ],
        max_turns=5,
    )

    async with ClaudeSDKClient(options=options) as client:
        await client.query("What's 15 * 7 + 23? Then tell me the weather in San Francisco.")

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text)
                    elif isinstance(block, ToolUseBlock):
                        print(f"[Using tool: {block.name}]")


async def agent_with_hooks():
    """Agent with pre-processing hooks."""
    print("\n=== Agent with Hooks ===")

    options = ClaudeAgentOptions(
        allowed_tools=["Bash", "Read"],
        hooks={
            "PreToolUse": [
                HookMatcher(matcher="*", hooks=[log_tool_use]),
                HookMatcher(matcher="Bash", hooks=[block_dangerous_commands]),
            ],
        },
        max_turns=3,
    )

    async with ClaudeSDKClient(options=options) as client:
        await client.query("List files in the current directory using ls")

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text)


async def coding_agent():
    """Agent configured for coding tasks."""
    print("\n=== Coding Agent ===")

    options = ClaudeAgentOptions(
        system_prompt="You are an expert Python developer. Write clean, well-documented code.",
        allowed_tools=["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        permission_mode="acceptEdits",  # Auto-accept file edits
        max_turns=10,
    )

    async for message in query(
        prompt="Create a simple hello.py file that prints 'Hello, World!'",
        options=options
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text)


async def main():
    """Run all examples."""
    try:
        await simple_query()
        await query_with_tools()
        await agent_with_custom_tools()
        await agent_with_hooks()
        # await coding_agent()  # Uncomment to test file creation

    except CLINotFoundError:
        print("Error: Claude Code CLI not found. It should be bundled with claude-agent-sdk.")
        print("If issues persist, install manually: curl -fsSL https://claude.ai/install.sh | bash")
    except ProcessError as e:
        print(f"Process error (exit code {e.exit_code}): {e}")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    anyio.run(main)
