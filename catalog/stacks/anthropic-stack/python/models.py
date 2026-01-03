"""
Claude Model IDs - Latest as of January 2025

Use specific model versions in production for consistent behavior.
Aliases auto-update to newest snapshots (good for experimentation).
"""

# =============================================================================
# CLAUDE 4.5 FAMILY (LATEST - RECOMMENDED)
# =============================================================================

# Claude Opus 4.5 - Premium model, maximum intelligence
OPUS_4_5 = "claude-opus-4-5-20251101"
OPUS_4_5_ALIAS = "claude-opus-4-5"

# Claude Sonnet 4.5 - Best for complex agents and coding (RECOMMENDED DEFAULT)
SONNET_4_5 = "claude-sonnet-4-5-20250929"
SONNET_4_5_ALIAS = "claude-sonnet-4-5"

# Claude Haiku 4.5 - Fastest with near-frontier intelligence
HAIKU_4_5 = "claude-haiku-4-5-20251001"
HAIKU_4_5_ALIAS = "claude-haiku-4-5"

# =============================================================================
# CLAUDE 4 FAMILY (LEGACY - STILL AVAILABLE)
# =============================================================================

# Claude Opus 4.1
OPUS_4_1 = "claude-opus-4-1-20250805"
OPUS_4_1_ALIAS = "claude-opus-4-1"

# Claude Opus 4
OPUS_4 = "claude-opus-4-20250514"
OPUS_4_ALIAS = "claude-opus-4-0"

# Claude Sonnet 4
SONNET_4 = "claude-sonnet-4-20250514"
SONNET_4_ALIAS = "claude-sonnet-4-0"

# Claude Sonnet 3.7
SONNET_3_7 = "claude-3-7-sonnet-20250219"
SONNET_3_7_ALIAS = "claude-3-7-sonnet-latest"

# Claude Haiku 3
HAIKU_3 = "claude-3-haiku-20240307"

# =============================================================================
# AWS BEDROCK MODEL IDS
# =============================================================================

BEDROCK_OPUS_4_5 = "anthropic.claude-opus-4-5-20251101-v1:0"
BEDROCK_SONNET_4_5 = "anthropic.claude-sonnet-4-5-20250929-v1:0"
BEDROCK_HAIKU_4_5 = "anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_OPUS_4_1 = "anthropic.claude-opus-4-1-20250805-v1:0"
BEDROCK_SONNET_4 = "anthropic.claude-sonnet-4-20250514-v1:0"

# =============================================================================
# GCP VERTEX AI MODEL IDS
# =============================================================================

VERTEX_OPUS_4_5 = "claude-opus-4-5@20251101"
VERTEX_SONNET_4_5 = "claude-sonnet-4-5@20250929"
VERTEX_HAIKU_4_5 = "claude-haiku-4-5@20251001"
VERTEX_OPUS_4_1 = "claude-opus-4-1@20250805"
VERTEX_SONNET_4 = "claude-sonnet-4@20250514"

# =============================================================================
# MODEL CAPABILITIES
# =============================================================================

MODEL_INFO = {
    OPUS_4_5: {
        "name": "Claude Opus 4.5",
        "context_window": 200_000,
        "max_output": 64_000,
        "extended_thinking": True,
        "input_price_per_mtok": 5.0,
        "output_price_per_mtok": 25.0,
        "knowledge_cutoff": "May 2025",
    },
    SONNET_4_5: {
        "name": "Claude Sonnet 4.5",
        "context_window": 200_000,  # 1M with beta header
        "max_output": 64_000,
        "extended_thinking": True,
        "input_price_per_mtok": 3.0,
        "output_price_per_mtok": 15.0,
        "knowledge_cutoff": "Jan 2025",
    },
    HAIKU_4_5: {
        "name": "Claude Haiku 4.5",
        "context_window": 200_000,
        "max_output": 64_000,
        "extended_thinking": True,
        "input_price_per_mtok": 1.0,
        "output_price_per_mtok": 5.0,
        "knowledge_cutoff": "Feb 2025",
    },
}

# Default model for agents (best balance of intelligence/speed/cost)
DEFAULT_MODEL = SONNET_4_5
