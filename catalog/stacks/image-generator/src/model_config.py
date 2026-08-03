"""Provider model defaults and static capability metadata."""

from __future__ import annotations


REPLICATE_RELEASE_STATUS = "beta"
REPLICATE_STABILITY = "model-specific"
REPLICATE_BETA_REASON = (
    "Replicate hosted model schemas can drift; use known models and aliases, "
    "and live-smoke a model before depending on it for production workflows."
)


DEFAULT_MODELS: dict[str, dict[str, str]] = {
    "gemini": {
        "sketch": "gemini-3.1-flash-image",
        "photoreal": "gemini-3-pro-image",
    },
    "openai": {
        "sketch": "gpt-image-2",
        "photoreal": "gpt-image-2",
        "edit": "gpt-image-2",
    },
    "replicate": {
        "sketch": "black-forest-labs/flux-schnell",
        "photoreal": "black-forest-labs/flux-1.1-pro",
        "edit": "black-forest-labs/flux-2-max",
    },
}

KNOWN_MODELS: dict[str, dict[str, dict[str, object]]] = {
    "gemini": {
        "gemini-3.1-flash-image": {
            "label": "Nano Banana 2",
            "status": "current",
            "default_for": ["sketch"],
            "notes": "GA Gemini 3.1 Flash Image model optimized for high-volume image generation.",
        },
        "gemini-3-pro-image": {
            "label": "Nano Banana Pro",
            "status": "current",
            "default_for": ["photoreal"],
            "notes": "GA Gemini 3 Pro Image model for professional asset production.",
        },
        "gemini-3.1-flash-image-preview": {
            "label": "Nano Banana 2 Preview",
            "status": "deprecated",
            "default_for": [],
            "notes": "Deprecated preview predecessor; use gemini-3.1-flash-image.",
        },
        "gemini-3-pro-image-preview": {
            "label": "Nano Banana Pro Preview",
            "status": "deprecated",
            "default_for": [],
            "notes": "Deprecated preview predecessor; use gemini-3-pro-image.",
        },
        "gemini-2.5-flash-image": {
            "label": "Nano Banana",
            "status": "legacy",
            "default_for": [],
            "notes": "Previous fast Gemini image model, still selectable explicitly if available.",
        },
    },
    "openai": {
        "gpt-image-2": {
            "label": "GPT Image 2",
            "status": "current",
            "default_for": ["sketch", "photoreal", "edit"],
            "notes": "Current state-of-the-art OpenAI image generation and editing model.",
        },
        "gpt-image-1.5": {
            "label": "GPT Image 1.5",
            "status": "deprecated",
            "default_for": [],
            "notes": "Previous OpenAI image model retained for explicit compatibility only.",
        },
        "gpt-image-1": {
            "label": "GPT Image 1",
            "status": "deprecated",
            "default_for": [],
            "notes": "Older GPT Image model retained for explicit compatibility only.",
        },
        "gpt-image-1-mini": {
            "label": "GPT Image 1 Mini",
            "status": "deprecated",
            "default_for": [],
            "notes": "Lower-cost GPT Image 1 family model retained for explicit compatibility only.",
        },
        "dall-e-3": {
            "label": "DALL-E 3",
            "status": "deprecated",
            "default_for": [],
            "notes": "Deprecated previous-generation generation model; no reference image support.",
        },
        "dall-e-2": {
            "label": "DALL-E 2",
            "status": "deprecated",
            "default_for": [],
            "notes": "Deprecated legacy model; supports one reference image and square output only.",
        },
    },
    "replicate": {
        "black-forest-labs/flux-2-max": {
            "label": "FLUX 2 Max",
            "status": "beta",
            "default_for": ["edit"],
            "notes": "Beta in this stack; high-fidelity FLUX 2 model with multi-reference support.",
        },
        "black-forest-labs/flux-1.1-pro": {
            "label": "FLUX 1.1 Pro",
            "status": "beta",
            "default_for": ["photoreal"],
            "notes": "Beta in this stack; photoreal default with single-reference support.",
        },
        "black-forest-labs/flux-schnell": {
            "label": "FLUX Schnell",
            "status": "beta",
            "default_for": ["sketch"],
            "notes": "Beta in this stack; fast sketch/default draft model.",
        },
        "bytedance/seedream-4": {
            "label": "Seedream 4",
            "status": "beta",
            "default_for": [],
            "notes": "Beta in this stack; ByteDance text-to-image and image-to-image model on Replicate.",
        },
        "bytedance/seedream-4.5": {
            "label": "Seedream 4.5",
            "status": "beta",
            "default_for": [],
            "notes": "Beta in this stack; upgraded ByteDance image model on Replicate.",
        },
    },
}

REPLICATE_PRESET_ALIASES: dict[str, str] = {
    "flux-2": "black-forest-labs/flux-2-max",
    "flux-2-max": "black-forest-labs/flux-2-max",
    "flux-2-pro": "black-forest-labs/flux-2-pro",
    "flux-2-flex": "black-forest-labs/flux-2-flex",
    "flux-2-dev": "black-forest-labs/flux-2-dev",
    "flux-2-klein": "black-forest-labs/flux-2-klein-4b",
    "flux-canny-pro": "black-forest-labs/flux-canny-pro",
    "flux-depth-pro": "black-forest-labs/flux-depth-pro",
    "flux-fill-pro": "black-forest-labs/flux-fill-pro",
    "flux-kontext-pro": "black-forest-labs/flux-kontext-pro",
    "flux-kontext-max": "black-forest-labs/flux-kontext-max",
    "flux-redux-dev": "black-forest-labs/flux-redux-dev",
    "flux-1.1-pro": "black-forest-labs/flux-1.1-pro",
    "flux-1.1-pro-ultra": "black-forest-labs/flux-1.1-pro-ultra",
    "flux-schnell": "black-forest-labs/flux-schnell",
    "sd-3.5": "stability-ai/stable-diffusion-3.5-large",
    "ideogram-v3": "ideogram-ai/ideogram-v3",
    "seedream-4": "bytedance/seedream-4",
    "seedream-4.5": "bytedance/seedream-4.5",
}

REPLICATE_REFERENCE_CONFIG: dict[str, tuple[str, bool, int]] = {
    "black-forest-labs/flux-2-max": ("input_images", True, 10),
    "black-forest-labs/flux-2-pro": ("input_images", True, 10),
    "black-forest-labs/flux-2-flex": ("input_images", True, 10),
    "black-forest-labs/flux-2-dev": ("input_images", True, 10),
    "black-forest-labs/flux-2-klein-4b": ("input_images", True, 10),
    "black-forest-labs/flux-1.1-pro": ("image_prompt", False, 1),
    "black-forest-labs/flux-canny-pro": ("control_image", False, 1),
    "black-forest-labs/flux-depth-pro": ("control_image", False, 1),
    "black-forest-labs/flux-kontext-pro": ("input_image", False, 1),
    "black-forest-labs/flux-kontext-max": ("input_image", False, 1),
    "black-forest-labs/flux-redux-dev": ("redux_image", False, 1),
    "black-forest-labs/flux-fill-pro": ("image", False, 1),
    "stability-ai/stable-diffusion-3.5-large": ("image", False, 1),
    "bytedance/seedream-4": ("image_input", True, 10),
    "bytedance/seedream-4.5": ("image_input", True, 10),
}

REPLICATE_ASPECT_RATIO_MODELS = {
    DEFAULT_MODELS["replicate"]["sketch"],
    DEFAULT_MODELS["replicate"]["photoreal"],
    DEFAULT_MODELS["replicate"]["edit"],
    "black-forest-labs/flux-2-pro",
    "black-forest-labs/flux-2-flex",
    "black-forest-labs/flux-2-dev",
    "black-forest-labs/flux-2-klein-4b",
    "black-forest-labs/flux-1.1-pro-ultra",
    "stability-ai/stable-diffusion-3.5-large",
    "bytedance/seedream-4",
    "bytedance/seedream-4.5",
}

OPENAI_GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "9:16": "1008x1792",
    "3:2": "1536x1024",
}

OPENAI_GPT_IMAGE_LEGACY_SIZE_BY_ASPECT_RATIO = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
}

OPENAI_DALL_E_3_SIZE_BY_ASPECT_RATIO = {
    "1:1": "1024x1024",
    "2:3": "1024x1792",
    "3:2": "1792x1024",
}
