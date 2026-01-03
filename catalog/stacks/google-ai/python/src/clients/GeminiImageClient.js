/**
 * Gemini Image Generation Client (Nano Banana)
 */

import { BaseClient } from './BaseClient.js';
import { RESPONSE_MODALITIES } from '../constants.js';
import { saveBase64Image } from '../utils/download.js';

export class GeminiImageClient extends BaseClient {
  async generateImage(modelId, prompt, options = {}) {
    const { aspectRatio, imageSize, outputPath } = options;

    const url = this.buildUrl(modelId, 'generateContent');

    const body = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: [RESPONSE_MODALITIES.TEXT, RESPONSE_MODALITIES.IMAGE]
      }
    };

    // Add imageConfig only if needed
    if (aspectRatio || imageSize) {
      body.generationConfig.imageConfig = {};
      if (aspectRatio) body.generationConfig.imageConfig.aspectRatio = aspectRatio;
      if (imageSize) body.generationConfig.imageConfig.imageSize = imageSize;
    }

    const result = await this.makeRequest(url, body);

    // Extract image data
    const imagePart = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (!imagePart) {
      throw new Error('No image data in response');
    }

    // Save if output path provided
    if (outputPath) {
      return saveBase64Image(imagePart.inlineData.data, outputPath);
    }

    return {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType
    };
  }
}
