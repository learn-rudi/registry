#!/usr/bin/env node
/**
 * Test all Google AI models
 * Usage: node src/commands/testModels.js
 */

import { getApiKey } from '../utils/env.js';
import { GeminiImageClient } from '../clients/GeminiImageClient.js';
import { ImagenClient } from '../clients/ImagenClient.js';
import { MODELS, MODEL_TYPES, getModelsByType } from '../config.js';

async function testImageModel(client, model) {
  try {
    const result = await client.generateImage(model.id, 'A simple test image', {});
    return { success: true, hasImage: !!result.base64 };
  } catch (err) {
    return { success: false, error: err.message, statusCode: err.statusCode };
  }
}

async function main() {
  console.log('🧪 Testing Google AI Models\n');
  console.log('═'.repeat(80));

  try {
    const apiKey = getApiKey();
    const geminiClient = new GeminiImageClient(apiKey);
    const imagenClient = new ImagenClient(apiKey);

    const imageModels = getModelsByType(MODEL_TYPES.GEMINI_IMAGE).concat(
      getModelsByType(MODEL_TYPES.IMAGEN)
    );

    const results = { working: [], notWorking: [] };

    console.log('\n📸 TESTING IMAGE GENERATION MODELS\n');
    console.log('─'.repeat(80));

    for (const model of imageModels) {
      process.stdout.write(`Testing ${model.name}... `);

      const client = model.type === MODEL_TYPES.GEMINI_IMAGE ? geminiClient : imagenClient;
      const result = await testImageModel(client, model);

      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit

      if (result.success) {
        console.log('✅ Working');
        results.working.push(model.name);
      } else {
        console.log(`❌ ${result.error}`);
        results.notWorking.push({ name: model.name, error: result.error });
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log(`\n✨ ${results.working.length} of ${imageModels.length} models working\n`);

    if (results.working.length > 0) {
      console.log('✅ Working:');
      results.working.forEach(name => console.log(`   • ${name}`));
    }

    if (results.notWorking.length > 0) {
      console.log('\n❌ Not Working:');
      results.notWorking.forEach(m => console.log(`   • ${m.name}: ${m.error}`));
    }

    console.log();

  } catch (err) {
    console.error(`\n❌ Fatal error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
