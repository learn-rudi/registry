/**
 * Anthropic Agent SDK - API-style interface
 *
 * Provides simple functions to call Claude models programmatically.
 */

import {
  query,
  type Options,
  type SDKAssistantMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { OPUS_4_5, SONNET_4_5, HAIKU_4_5, DEFAULT_MODEL } from "./models.js";

export interface AskResult {
  text: string;
  model: string;
  cost: number;
  usage: Record<string, unknown>;
}

export interface AskOptions {
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
}

/**
 * Simple API call to Claude.
 */
export async function ask(
  prompt: string,
  options: AskOptions = {}
): Promise<AskResult> {
  const {
    model = DEFAULT_MODEL,
    systemPrompt,
    maxTurns = 1,
    allowedTools = [],
  } = options;

  const queryOptions: Options = {
    model,
    maxTurns,
    systemPrompt,
    allowedTools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  };

  const result: AskResult = {
    text: "",
    model,
    cost: 0,
    usage: {},
  };

  const response = query({ prompt, options: queryOptions });

  for await (const message of response) {
    if (message.type === "assistant") {
      const assistantMsg = message as SDKAssistantMessage;
      for (const block of assistantMsg.message.content) {
        if (block.type === "text") {
          result.text += block.text;
        }
      }
    } else if (message.type === "result") {
      const resultMsg = message as SDKResultMessage;
      if (resultMsg.subtype === "success") {
        result.cost = resultMsg.total_cost_usd;
        result.usage = resultMsg.usage;
      }
    }
  }

  return result;
}

/**
 * Call Claude Opus 4.5 (most capable)
 */
export async function askOpus(
  prompt: string,
  options: Omit<AskOptions, "model"> = {}
): Promise<AskResult> {
  return ask(prompt, { ...options, model: OPUS_4_5 });
}

/**
 * Call Claude Sonnet 4.5 (default, best for most tasks)
 */
export async function askSonnet(
  prompt: string,
  options: Omit<AskOptions, "model"> = {}
): Promise<AskResult> {
  return ask(prompt, { ...options, model: SONNET_4_5 });
}

/**
 * Call Claude Haiku 4.5 (fastest, cheapest)
 */
export async function askHaiku(
  prompt: string,
  options: Omit<AskOptions, "model"> = {}
): Promise<AskResult> {
  return ask(prompt, { ...options, model: HAIKU_4_5 });
}

// =============================================================================
// TEST
// =============================================================================

async function testAllModels(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Testing Anthropic Agent SDK - All Models");
  console.log("=".repeat(60));

  const models: [string, string][] = [
    ["Haiku 4.5", HAIKU_4_5],
    ["Sonnet 4.5", SONNET_4_5],
    ["Opus 4.5", OPUS_4_5],
  ];

  for (const [name, modelId] of models) {
    console.log(`\n--- ${name} (${modelId}) ---`);
    try {
      const result = await ask("What is 2+2? Reply with just the number.", {
        model: modelId,
      });
      console.log(`Response: ${result.text}`);
      console.log(`Cost: $${result.cost.toFixed(6)}`);
    } catch (e) {
      console.log(`Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("All tests complete!");
}

// Run if executed directly
testAllModels().catch(console.error);
