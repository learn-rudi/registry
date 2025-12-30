#!/usr/bin/env node
/**
 * Generate image using Google AI models
 * Usage: node src/commands/generateImage.js "prompt" [options]
 */

import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getApiKey } from '../utils/env.js';
import { GeminiImageClient } from '../clients/GeminiImageClient.js';
import { ImagenClient } from '../clients/ImagenClient.js';
import { MODELS } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Generate Image with Google AI

Usage:
  node src/commands/generateImage.js "<prompt>" [options]

Options:
  --model <name>     Model: nano-banana, nano-banana-pro, imagen4-ultra, imagen4-standard, imagen4-fast
  --aspect <ratio>   Aspect ratio: 1:1, 3:4, 4:3, 9:16, 16:9 (default: 16:9)
  --output <path>    Output file path (default: ./output/image.png)

Examples:
  node src/commands/generateImage.js "Modern community center"
  node src/commands/generateImage.js "Aerial view" --model nano-banana-pro --aspect 1:1
    `);
    process.exit(0);
  }

  try {
    // Parse arguments
    const prompt = args.find(a => !a.startsWith('--'));
    const modelIdx = args.indexOf('--model');
    const aspectIdx = args.indexOf('--aspect');
    const outputIdx = args.indexOf('--output');

    const modelArg = modelIdx !== -1 ? args[modelIdx + 1] : 'nano-banana';
    const aspectRatio = aspectIdx !== -1 ? args[aspectIdx + 1] : '16:9';
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : join(__dirname, '..', '..', 'output', 'image.png');

    // Map model names
    const modelMap = {
      'nano-banana': MODELS.NANO_BANANA,
      'nano-banana-pro': MODELS.NANO_BANANA_PRO,
      'imagen4-ultra': MODELS.IMAGEN_4_ULTRA,
      'imagen4-standard': MODELS.IMAGEN_4_STANDARD,
      'imagen4-fast': MODELS.IMAGEN_4_FAST
    };

    const model = modelMap[modelArg];
    if (!model) {
      throw new Error(`Unknown model: ${modelArg}`);
    }

    console.log(`\n🎨 Generating image with ${model.name}...`);
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`📐 Aspect: ${aspectRatio}\n`);

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Get API key and create client
    const apiKey = getApiKey();
    const isGemini = model.id.startsWith('gemini');
    const client = isGemini ? new GeminiImageClient(apiKey) : new ImagenClient(apiKey);

    // Generate image
    const startTime = Date.now();
    const result = await client.generateImage(model.id, prompt, { aspectRatio, outputPath });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Complete in ${duration}s`);
    console.log(`📁 Saved: ${result.path}`);
    console.log(`📦 Size: ${result.sizeMB}MB\n`);

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
