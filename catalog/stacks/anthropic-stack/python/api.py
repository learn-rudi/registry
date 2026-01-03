"""
Anthropic Agent SDK - API-style interface

Provides simple functions to call Claude models programmatically.
"""

import anyio
from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
    ResultMessage,
)
from models import OPUS_4_5, SONNET_4_5, HAIKU_4_5, DEFAULT_MODEL


async def ask(
    prompt: str,
    model: str = DEFAULT_MODEL,
    system_prompt: str | None = None,
    max_turns: int = 1,
    allowed_tools: list[str] | None = None,
) -> dict:
    """
    Simple API call to Claude.

    Args:
        prompt: The user prompt
        model: Model ID (default: Sonnet 4.5)
        system_prompt: Optional system prompt
        max_turns: Max conversation turns
        allowed_tools: List of allowed tools (empty = no tools)

    Returns:
        dict with 'text', 'model', 'cost', 'usage'
    """
    options = ClaudeAgentOptions(
        model=model,
        max_turns=max_turns,
        system_prompt=system_prompt,
        allowed_tools=allowed_tools if allowed_tools is not None else [],
        permission_mode="bypassPermissions",
    )

    result = {
        "text": "",
        "model": model,
        "cost": 0.0,
        "usage": {},
    }

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    result["text"] += block.text
        elif isinstance(message, ResultMessage):
            result["cost"] = getattr(message, "total_cost_usd", 0.0)
            result["usage"] = getattr(message, "usage", {})

    return result


async def ask_opus(prompt: str, **kwargs) -> dict:
    """Call Claude Opus 4.5"""
    return await ask(prompt, model=OPUS_4_5, **kwargs)


async def ask_sonnet(prompt: str, **kwargs) -> dict:
    """Call Claude Sonnet 4.5 (default, best for most tasks)"""
    return await ask(prompt, model=SONNET_4_5, **kwargs)


async def ask_haiku(prompt: str, **kwargs) -> dict:
    """Call Claude Haiku 4.5 (fastest, cheapest)"""
    return await ask(prompt, model=HAIKU_4_5, **kwargs)


# =============================================================================
# TEST
# =============================================================================

async def test_all_models():
    """Test all 3 models"""
    print("=" * 60)
    print("Testing Anthropic Agent SDK - All Models")
    print("=" * 60)

    models = [
        ("Haiku 4.5", HAIKU_4_5),
        ("Sonnet 4.5", SONNET_4_5),
        ("Opus 4.5", OPUS_4_5),
    ]

    for name, model_id in models:
        print(f"\n--- {name} ({model_id}) ---")
        try:
            result = await ask(
                prompt="What is 2+2? Reply with just the number.",
                model=model_id,
            )
            print(f"Response: {result['text']}")
            print(f"Cost: ${result['cost']:.6f}")
        except Exception as e:
            print(f"Error: {e}")

    print("\n" + "=" * 60)
    print("All tests complete!")


if __name__ == "__main__":
    anyio.run(test_all_models)
