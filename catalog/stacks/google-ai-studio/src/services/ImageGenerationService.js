/**
 * Image Generation Service
 * Orchestrates image generation with batch support, retries, and rate limiting
 */

import { GeminiImageClient } from '../clients/GeminiImageClient.js';
import { ImagenClient } from '../clients/ImagenClient.js';
import { MODEL_TYPES } from '../config.js';

export class ImageGenerationService {
  constructor(apiKey) {
    this.geminiClient = new GeminiImageClient(apiKey);
    this.imagenClient = new ImagenClient(apiKey);
  }

  /**
   * Generate single image using appropriate client
   */
  async generateImage(model, prompt, options = {}) {
    const client = model.type === MODEL_TYPES.GEMINI_IMAGE
      ? this.geminiClient
      : this.imagenClient;

    return client.generateImage(model.id, prompt, options);
  }

  /**
   * Generate multiple images with rate limiting
   */
  async generateBatch(model, prompts, options = {}) {
    const { delayMs = 2000, onProgress } = options;
    const results = [];

    for (let i = 0; i < prompts.length; i++) {
      if (onProgress) {
        onProgress({ current: i + 1, total: prompts.length });
      }

      try {
        const result = await this.generateImage(model, prompts[i], options);
        results.push({ success: true, result, prompt: prompts[i] });
      } catch (err) {
        results.push({ success: false, error: err.message, prompt: prompts[i] });
      }

      // Rate limiting delay between requests
      if (i < prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Generate with automatic retry on failure
   */
  async generateWithRetry(model, prompt, options = {}) {
    const { maxRetries = 3, retryDelayMs = 5000 } = options;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.generateImage(model, prompt, options);
      } catch (err) {
        lastError = err;

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Generate comparison images across multiple models
   */
  async generateComparison(models, prompt, options = {}) {
    const results = [];

    for (const model of models) {
      try {
        const result = await this.generateImage(model, prompt, options);
        results.push({
          model: model.name,
          success: true,
          result
        });
      } catch (err) {
        results.push({
          model: model.name,
          success: false,
          error: err.message
        });
      }

      // Rate limiting between models
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }
}
