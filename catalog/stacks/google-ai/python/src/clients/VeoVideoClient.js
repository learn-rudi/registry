/**
 * Veo 3.1 Video Generation Client
 */

import { BaseClient } from './BaseClient.js';
import { API_BASE_URL } from '../constants.js';
import { pollOperation, extractVideoUri } from '../utils/poller.js';
import { downloadFile } from '../utils/download.js';

export class VeoVideoClient extends BaseClient {
  async generateVideo(modelId, prompt, options = {}) {
    const { aspectRatio = '16:9', outputPath, onProgress } = options;

    const url = this.buildUrl(modelId, 'predictLongRunning');

    const body = {
      instances: [{ prompt }],
      parameters: { aspectRatio }
    };

    // Start video generation
    const startResult = await this.makeRequest(url, body);

    if (!startResult.name) {
      throw new Error('No operation name in response');
    }

    // Poll for completion
    const operationUrl = `${API_BASE_URL}/${startResult.name}`;
    const pollResult = await pollOperation(operationUrl, this.apiKey, onProgress);

    // Extract video URI
    const videoUri = extractVideoUri(pollResult);
    if (!videoUri) {
      throw new Error('No video URI in completed operation');
    }

    // Download if output path provided
    if (outputPath) {
      return downloadFile(videoUri, outputPath, { apiKey: this.apiKey });
    }

    return {
      uri: videoUri,
      operation: pollResult
    };
  }
}
