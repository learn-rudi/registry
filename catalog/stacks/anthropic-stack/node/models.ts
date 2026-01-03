/**
 * Claude Model IDs - Latest as of January 2025
 *
 * Use specific model versions in production for consistent behavior.
 * Aliases auto-update to newest snapshots (good for experimentation).
 */

// =============================================================================
// CLAUDE 4.5 FAMILY (LATEST - RECOMMENDED)
// =============================================================================

/** Claude Opus 4.5 - Premium model, maximum intelligence */
export const OPUS_4_5 = "claude-opus-4-5-20251101" as const;
export const OPUS_4_5_ALIAS = "claude-opus-4-5" as const;

/** Claude Sonnet 4.5 - Best for complex agents and coding (RECOMMENDED DEFAULT) */
export const SONNET_4_5 = "claude-sonnet-4-5-20250929" as const;
export const SONNET_4_5_ALIAS = "claude-sonnet-4-5" as const;

/** Claude Haiku 4.5 - Fastest with near-frontier intelligence */
export const HAIKU_4_5 = "claude-haiku-4-5-20251001" as const;
export const HAIKU_4_5_ALIAS = "claude-haiku-4-5" as const;

// =============================================================================
// CLAUDE 4 FAMILY (LEGACY - STILL AVAILABLE)
// =============================================================================

/** Claude Opus 4.1 */
export const OPUS_4_1 = "claude-opus-4-1-20250805" as const;
export const OPUS_4_1_ALIAS = "claude-opus-4-1" as const;

/** Claude Opus 4 */
export const OPUS_4 = "claude-opus-4-20250514" as const;
export const OPUS_4_ALIAS = "claude-opus-4-0" as const;

/** Claude Sonnet 4 */
export const SONNET_4 = "claude-sonnet-4-20250514" as const;
export const SONNET_4_ALIAS = "claude-sonnet-4-0" as const;

/** Claude Sonnet 3.7 */
export const SONNET_3_7 = "claude-3-7-sonnet-20250219" as const;
export const SONNET_3_7_ALIAS = "claude-3-7-sonnet-latest" as const;

/** Claude Haiku 3 */
export const HAIKU_3 = "claude-3-haiku-20240307" as const;

// =============================================================================
// AWS BEDROCK MODEL IDS
// =============================================================================

export const BEDROCK_OPUS_4_5 = "anthropic.claude-opus-4-5-20251101-v1:0" as const;
export const BEDROCK_SONNET_4_5 = "anthropic.claude-sonnet-4-5-20250929-v1:0" as const;
export const BEDROCK_HAIKU_4_5 = "anthropic.claude-haiku-4-5-20251001-v1:0" as const;
export const BEDROCK_OPUS_4_1 = "anthropic.claude-opus-4-1-20250805-v1:0" as const;
export const BEDROCK_SONNET_4 = "anthropic.claude-sonnet-4-20250514-v1:0" as const;

// =============================================================================
// GCP VERTEX AI MODEL IDS
// =============================================================================

export const VERTEX_OPUS_4_5 = "claude-opus-4-5@20251101" as const;
export const VERTEX_SONNET_4_5 = "claude-sonnet-4-5@20250929" as const;
export const VERTEX_HAIKU_4_5 = "claude-haiku-4-5@20251001" as const;
export const VERTEX_OPUS_4_1 = "claude-opus-4-1@20250805" as const;
export const VERTEX_SONNET_4 = "claude-sonnet-4@20250514" as const;

// =============================================================================
// MODEL CAPABILITIES
// =============================================================================

export interface ModelCapabilities {
  name: string;
  contextWindow: number;
  maxOutput: number;
  extendedThinking: boolean;
  inputPricePerMtok: number;
  outputPricePerMtok: number;
  knowledgeCutoff: string;
}

export const MODEL_INFO: Record<string, ModelCapabilities> = {
  [OPUS_4_5]: {
    name: "Claude Opus 4.5",
    contextWindow: 200_000,
    maxOutput: 64_000,
    extendedThinking: true,
    inputPricePerMtok: 5.0,
    outputPricePerMtok: 25.0,
    knowledgeCutoff: "May 2025",
  },
  [SONNET_4_5]: {
    name: "Claude Sonnet 4.5",
    contextWindow: 200_000, // 1M with beta header
    maxOutput: 64_000,
    extendedThinking: true,
    inputPricePerMtok: 3.0,
    outputPricePerMtok: 15.0,
    knowledgeCutoff: "Jan 2025",
  },
  [HAIKU_4_5]: {
    name: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutput: 64_000,
    extendedThinking: true,
    inputPricePerMtok: 1.0,
    outputPricePerMtok: 5.0,
    knowledgeCutoff: "Feb 2025",
  },
};

/** Default model for agents (best balance of intelligence/speed/cost) */
export const DEFAULT_MODEL = SONNET_4_5;

// Type helpers for model selection
export type LatestModel = typeof OPUS_4_5 | typeof SONNET_4_5 | typeof HAIKU_4_5;
export type LegacyModel = typeof OPUS_4_1 | typeof OPUS_4 | typeof SONNET_4 | typeof SONNET_3_7 | typeof HAIKU_3;
export type AllModels = LatestModel | LegacyModel;
