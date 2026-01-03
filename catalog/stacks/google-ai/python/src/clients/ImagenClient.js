/**
 * Imagen 4 Image Generation Client
 */

import { BaseClient } from './BaseClient.js';
import { saveBase64Image } from '../utils/download.js';

export class ImagenClient extends BaseClient {
  async generateImage(modelId, prompt, options = {}) {
    const { aspectRatio, sampleCount = 1, outputPath } = options;

    const url = this.buildUrl(modelId, 'predict');

    const body = {
      instances: [{ prompt }],
      parameters: { sampleCount }
    };

    if (aspectRatio) {
      body.parameters.aspectRatio = aspectRatio;
    }

    const result = await this.makeRequest(url, body);

    if (!result.predictions || result.predictions.length === 0) {
      throw new Error('No predictions in response');
    }

    const imageData = result.predictions[0].bytesBase64Encoded;

    // Save if output path provided
    if (outputPath) {
      return saveBase64Image(imageData, outputPath);
    }

    return {
      base64: imageData,
      predictions: result.predictions
    };
  }
}
