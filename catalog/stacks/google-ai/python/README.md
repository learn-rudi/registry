# Google AI Suite

Clean, modular SDK for accessing Google's complete AI suite. Generate images, videos, and text using Gemini, Imagen 4, and Veo 3.1 models. Built with ES modules, separation of concerns, and comprehensive testing.

## Architecture

```
src/
├── clients/           # API clients (Gemini, Imagen, Veo)
│   ├── BaseClient.js
│   ├── GeminiImageClient.js
│   ├── ImagenClient.js
│   └── VeoVideoClient.js
├── services/          # Business logic orchestration
│   ├── ImageGenerationService.js
│   ├── VideoGenerationService.js
│   └── ModelTestService.js
├── commands/          # CLI entry points
│   ├── generateImage.js
│   ├── generateVideo.js
│   └── testModels.js
├── utils/             # Pure utilities
│   ├── env.js
│   ├── download.js
│   └── poller.js
├── config.js          # Model configurations
├── constants.js       # API constants
└── index.js           # Public API exports

__tests__/
├── unit/              # Unit tests
└── integration/       # Integration tests
```

## Setup

1. Create `.env` file:
```bash
GOOGLE_AI_API_KEY=your_api_key_here
```

2. Run tests:
```bash
npm test
```

## Usage

### Generate Image

```bash
# Nano Banana (fast, cost-effective)
node src/commands/generateImage.js "Sunset over mountains"

# Nano Banana Pro (professional quality)
node src/commands/generateImage.js "Product photograph" --model nano-banana-pro

# Imagen 4 Ultra (highest quality)
node src/commands/generateImage.js "Hero banner" --model imagen4-ultra --aspect 16:9
```

**Available Models:**
- `nano-banana` - Fast, $0.039/image
- `nano-banana-pro` - Pro quality, $0.06/image
- `imagen4-ultra` - Premium quality
- `imagen4-standard` - Balanced
- `imagen4-fast` - Speed-optimized

### Generate Video

```bash
# Veo 3.1 Standard (8 seconds with audio)
node src/commands/generateVideo.js "Ocean waves crashing"

# Veo 3.1 Fast
node src/commands/generateVideo.js "City street timelapse" --fast
```

### Test Models

```bash
node src/commands/testModels.js
```

## Programmatic API

### Using Clients (Low-level)

```javascript
import { GeminiImageClient, VeoVideoClient, getApiKey } from './src/index.js';
import { MODELS } from './src/config.js';

const apiKey = getApiKey();

// Generate image
const imageClient = new GeminiImageClient(apiKey);
const image = await imageClient.generateImage(
  MODELS.NANO_BANANA.id,
  "Mountain landscape at sunset",
  { aspectRatio: '16:9', outputPath: './output.png' }
);

// Generate video
const videoClient = new VeoVideoClient(apiKey);
const video = await videoClient.generateVideo(
  MODELS.VEO_3_1_STANDARD.id,
  "Ocean waves animation",
  { aspectRatio: '16:9', outputPath: './video.mp4' }
);
```

### Using Services (High-level)

```javascript
import {
  ImageGenerationService,
  VideoGenerationService,
  ModelTestService,
  getApiKey,
  MODELS
} from './src/index.js';

const apiKey = getApiKey();

// Image service with batch, retry, comparison
const imageService = new ImageGenerationService(apiKey);

// Generate batch with rate limiting
const results = await imageService.generateBatch(
  MODELS.NANO_BANANA,
  ['prompt 1', 'prompt 2', 'prompt 3'],
  { delayMs: 2000 }
);

// Generate with automatic retry
const image = await imageService.generateWithRetry(
  MODELS.NANO_BANANA_PRO,
  'Product photograph',
  { maxRetries: 3 }
);

// Compare across models
const comparison = await imageService.generateComparison(
  [MODELS.NANO_BANANA, MODELS.NANO_BANANA_PRO],
  'Logo design concept'
);

// Video service with queue management
const videoService = new VideoGenerationService(apiKey);

// Generate with progress tracking
await videoService.generateWithProgress(
  MODELS.VEO_3_1_STANDARD,
  'Animation sequence',
  {
    onProgress: (status) => console.log(`${status.progress}%`),
    onComplete: (result) => console.log('Done!')
  }
);

// Queue multiple videos
await videoService.queueVideo(MODELS.VEO_3_1_FAST, 'Video 1');
await videoService.queueVideo(MODELS.VEO_3_1_FAST, 'Video 2');

// Test service
const testService = new ModelTestService(apiKey);
const report = await testService.testAllModels(Object.values(MODELS));
console.log(`${report.working}/${report.total} models working`);
```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration
```

## Project Structure

- **Clients** - Low-level API communication (BaseClient, GeminiImageClient, ImagenClient, VeoVideoClient)
- **Services** - High-level business logic (batch, retry, queue, comparison, testing)
- **Utils** - Pure reusable functions (env, download, poller)
- **Commands** - CLI entry points with argument parsing
- **Config** - Model configurations and constants
- **Tests** - Node.js native test runner

## Working Models

**Images (5 models):**
- ✅ Nano Banana - `gemini-2.5-flash-image`
- ✅ Nano Banana Pro - `gemini-3-pro-image-preview`
- ✅ Imagen 4 Ultra - `imagen-4.0-ultra-generate-001`
- ✅ Imagen 4 Standard - `imagen-4.0-generate-001`
- ✅ Imagen 4 Fast - `imagen-4.0-fast-generate-001`

**Videos (2 models):**
- ✅ Veo 3.1 Standard - `veo-3.1-generate-preview`
- ✅ Veo 3.1 Fast - `veo-3.1-fast-generate-preview`

## License

MIT
