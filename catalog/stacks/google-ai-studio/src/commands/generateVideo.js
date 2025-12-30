#!/usr/bin/env node
/**
 * Generate video using Veo 3.1
 * Usage: node src/commands/generateVideo.js "prompt" [options]
 */

import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getApiKey } from '../utils/env.js';
import { VeoVideoClient } from '../clients/VeoVideoClient.js';
import { MODELS } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Generate Video with Veo 3.1

Usage:
  node src/commands/generateVideo.js "<prompt>" [options]

Options:
  --fast             Use Veo 3.1 Fast (default: standard)
  --aspect <ratio>   Aspect ratio: 1:1, 9:16, 16:9 (default: 16:9)
  --output <path>    Output file path (default: ./output/videos/video.mp4)

Examples:
  node src/commands/generateVideo.js "Aerial view of community center"
  node src/commands/generateVideo.js "Property walkthrough" --fast --aspect 9:16

Note: Video generation takes 2-5 minutes
    `);
    process.exit(0);
  }

  try {
    // Parse arguments
    const prompt = args.find(a => !a.startsWith('--'));
    const useFast = args.includes('--fast');
    const aspectIdx = args.indexOf('--aspect');
    const outputIdx = args.indexOf('--output');

    const aspectRatio = aspectIdx !== -1 ? args[aspectIdx + 1] : '16:9';
    const timestamp = Date.now();
    const defaultPath = join(__dirname, '..', '..', 'output', 'videos', `video-${timestamp}.mp4`);
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : defaultPath;

    const model = useFast ? MODELS.VEO_3_1_FAST : MODELS.VEO_3_1_STANDARD;

    console.log(`\n🎬 Generating video with ${model.name}...`);
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`📐 Aspect: ${aspectRatio}`);
    console.log(`⏳ This will take 2-5 minutes...\n`);

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Get API key and create client
    const apiKey = getApiKey();
    const client = new VeoVideoClient(apiKey);

    // Progress callback
    const onProgress = ({ attempts, elapsedSeconds, progress }) => {
      process.stdout.write(`\r⏳ Generating... ${Math.round(progress)}% (${elapsedSeconds}s elapsed)`);
    };

    // Generate video
    const startTime = Date.now();
    const result = await client.generateVideo(model.id, prompt, { aspectRatio, outputPath, onProgress });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n\n✅ Complete in ${duration}s`);
    console.log(`📁 Saved: ${result.path}`);
    console.log(`📦 Size: ${result.sizeMB}MB\n`);

  } catch (err) {
    console.error(`\n\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
