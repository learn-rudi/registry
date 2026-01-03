# Google AI Suite

Complete access to Google's AI models for image, video, and text generation. Use Gemini, Imagen 4, and Veo 3.1 for any creative or analytical task.

## Features

- **5 Image Models**: Nano Banana, Nano Banana Pro, Imagen 4 (Ultra, Standard, Fast)
- **2 Video Models**: Veo 3.1 (Standard, Fast)
- **Text Models**: Gemini 2.5 Flash, Gemini 3 Pro
- **ES Modules**: Modern JavaScript architecture
- **Service Layer**: Batch generation, retries, queuing
- **Tested & Production-Ready**: Node.js native tests

## Quick Start

### Generate Image

```bash
# Fast iteration
node src/commands/generateImage.js "Sunset over mountains"

# Professional quality
node src/commands/generateImage.js "Product photograph of smartwatch" --model nano-banana-pro

# Highest quality
node src/commands/generateImage.js "Hero banner" --model imagen4-ultra --aspect 16:9
```

### Generate Video

```bash
# 8-second video with audio
node src/commands/generateVideo.js "Ocean waves crashing on beach"

# Fast generation
node src/commands/generateVideo.js "City street timelapse" --fast
```

### Generate Text

```bash
# Coming soon - text generation with Gemini models
node src/commands/generateText.js "Explain quantum computing"
```

## Models

### Image Models

| Model | Speed | Quality | Cost | Daily Limit |
|-------|-------|---------|------|-------------|
| **nano-banana** | ⚡⚡ 6s | Good | $0.039 | 500 |
| **nano-banana-pro** | ⚡ 14s | Excellent | $0.06 | 250 |
| **imagen4-fast** | ⚡⚡⚡ 5s | High | Mid-tier | 70 |
| **imagen4-standard** | ⚡⚡ 7s | High | Mid-tier | 70 |
| **imagen4-ultra** | ⚡⚡ 9s | Premium | Premium | 30 |

### Video Models

| Model | Duration | Audio | Quality | Daily Limit |
|-------|----------|-------|---------|-------------|
| **veo-3.1-standard** | 8s | ✅ | 720p-1080p | 10 |
| **veo-3.1-fast** | 8s | ✅ | 720p-1080p | 10 |

## Programmatic Usage

### Using Services (High-level)

```javascript
import { ImageGenerationService, getApiKey, MODELS } from './src/index.js';

const service = new ImageGenerationService(getApiKey());

// Generate batch with rate limiting
const results = await service.generateBatch(
  MODELS.NANO_BANANA,
  ['prompt 1', 'prompt 2', 'prompt 3']
);

// Generate with automatic retry
const image = await service.generateWithRetry(
  MODELS.NANO_BANANA_PRO,
  'Architectural rendering',
  { maxRetries: 3 }
);

// Compare across models
const comparison = await service.generateComparison(
  [MODELS.NANO_BANANA, MODELS.NANO_BANANA_PRO],
  'Modern building'
);
```

### Using Clients (Low-level)

```javascript
import { GeminiImageClient, getApiKey, MODELS } from './src/index.js';

const client = new GeminiImageClient(getApiKey());
const result = await client.generateImage(
  MODELS.NANO_BANANA.id,
  "Modern architecture",
  { aspectRatio: '16:9', outputPath: './output.png' }
);
```

## Environment Setup

Create `.env` file:
```bash
GOOGLE_AI_API_KEY=your_api_key_here
```

Get your API key from: https://makersuite.google.com/app/apikey

## Testing

```bash
# Test all models
node src/commands/testModels.js

# Run unit tests
npm test
```

## Use Cases

### Creative Content
- Generate images for marketing, design mockups, concept art
- Create videos for social media, presentations, demonstrations
- Generate text for articles, summaries, analysis

### Workflow Example
```bash
# 1. Generate concepts (fast iterations)
node src/commands/generateImage.js "Minimalist logo design" --model nano-banana

# 2. Refine selected concept (higher quality)
node src/commands/generateImage.js "Professional minimalist logo" --model nano-banana-pro

# 3. Create video content
node src/commands/generateVideo.js "Product demonstration animation"
```

## Architecture

```
src/
├── clients/    # API communication
├── services/   # Business logic (batch, retry, queue)
├── commands/   # CLI entry points
├── utils/      # Helpers (env, download, poller)
└── config.js   # Model configurations
```

## Best Practices

1. **Iterate with Nano Banana** - Fast and cost-effective for exploring concepts
2. **Finalize with Pro/Ultra** - High quality for final deliverables
3. **Use Services** - Built-in retry, rate limiting, batch support
4. **Respect Rate Limits** - Daily limits apply per model
5. **Choose the Right Model** - Images for visual content, video for motion, text for analysis

## License

MIT
