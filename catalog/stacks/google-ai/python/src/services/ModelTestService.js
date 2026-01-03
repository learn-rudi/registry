/**
 * Model Testing Service
 * Orchestrates testing and validation of all models
 */

import { GeminiImageClient } from '../clients/GeminiImageClient.js';
import { ImagenClient } from '../clients/ImagenClient.js';
import { VeoVideoClient } from '../clients/VeoVideoClient.js';
import { MODEL_TYPES } from '../config.js';

export class ModelTestService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.geminiClient = new GeminiImageClient(apiKey);
    this.imagenClient = new ImagenClient(apiKey);
    this.veoClient = new VeoVideoClient(apiKey);
  }

  /**
   * Test single image model
   */
  async testImageModel(model) {
    const client = model.type === MODEL_TYPES.GEMINI_IMAGE
      ? this.geminiClient
      : this.imagenClient;

    const startTime = Date.now();

    try {
      const result = await client.generateImage(model.id, 'Test image', {});
      const duration = Date.now() - startTime;

      return {
        model: model.name,
        modelId: model.id,
        success: true,
        durationMs: duration,
        hasOutput: !!(result.base64 || result.path)
      };
    } catch (err) {
      return {
        model: model.name,
        modelId: model.id,
        success: false,
        error: err.message,
        statusCode: err.statusCode
      };
    }
  }

  /**
   * Test single video model
   */
  async testVideoModel(model) {
    const startTime = Date.now();

    try {
      // Just test API availability, don't wait for full video
      const result = await this.veoClient.generateVideo(model.id, 'Test video', {});
      const duration = Date.now() - startTime;

      return {
        model: model.name,
        modelId: model.id,
        success: true,
        durationMs: duration,
        hasOutput: !!(result.uri || result.path)
      };
    } catch (err) {
      return {
        model: model.name,
        modelId: model.id,
        success: false,
        error: err.message,
        statusCode: err.statusCode
      };
    }
  }

  /**
   * Test all models of specific type
   */
  async testModelsByType(models, type) {
    const results = [];

    for (const model of models) {
      if (model.type !== type) continue;

      const result = type === MODEL_TYPES.VEO_VIDEO
        ? await this.testVideoModel(model)
        : await this.testImageModel(model);

      results.push(result);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }

  /**
   * Test all models and generate report
   */
  async testAllModels(models) {
    const imageModels = models.filter(m =>
      m.type === MODEL_TYPES.GEMINI_IMAGE || m.type === MODEL_TYPES.IMAGEN
    );
    const videoModels = models.filter(m => m.type === MODEL_TYPES.VEO_VIDEO);

    const imageResults = await this.testModelsByType(imageModels, MODEL_TYPES.GEMINI_IMAGE);
    const videoResults = await this.testModelsByType(videoModels, MODEL_TYPES.VEO_VIDEO);

    const working = [...imageResults, ...videoResults].filter(r => r.success);
    const failing = [...imageResults, ...videoResults].filter(r => !r.success);

    return {
      total: models.length,
      working: working.length,
      failing: failing.length,
      results: {
        images: imageResults,
        videos: videoResults
      },
      summary: {
        working: working.map(r => ({ model: r.model, duration: `${r.durationMs}ms` })),
        failing: failing.map(r => ({ model: r.model, error: r.error }))
      }
    };
  }

  /**
   * Check rate limit compliance
   */
  checkRateLimits(model, requestsInWindow) {
    const { rateLimits } = model;

    return {
      model: model.name,
      rpm: {
        used: requestsInWindow.rpm || 0,
        limit: rateLimits.rpm,
        available: rateLimits.rpm - (requestsInWindow.rpm || 0),
        compliant: (requestsInWindow.rpm || 0) <= rateLimits.rpm
      },
      rpd: {
        used: requestsInWindow.rpd || 0,
        limit: rateLimits.rpd,
        available: rateLimits.rpd - (requestsInWindow.rpd || 0),
        compliant: (requestsInWindow.rpd || 0) <= rateLimits.rpd
      }
    };
  }
}
