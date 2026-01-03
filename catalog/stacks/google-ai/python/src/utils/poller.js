/**
 * Operation polling utilities for async video generation
 */

import { POLLING_CONFIG } from '../constants.js';

export class PollingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PollingError';
  }
}

export async function pollOperation(operationUrl, apiKey, onProgress = null) {
  const { INTERVAL_MS, MAX_ATTEMPTS } = POLLING_CONFIG;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;

    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));

    const response = await fetch(operationUrl, {
      headers: { 'x-goog-api-key': apiKey }
    });

    if (!response.ok) {
      continue; // Retry on error
    }

    const result = await response.json();

    if (onProgress) {
      onProgress({
        attempts,
        maxAttempts: MAX_ATTEMPTS,
        elapsedSeconds: attempts * (INTERVAL_MS / 1000),
        progress: Math.min((attempts / MAX_ATTEMPTS) * 100, 99)
      });
    }

    if (result.done === true) {
      return result;
    }
  }

  throw new PollingError(`Operation timed out after ${MAX_ATTEMPTS * (INTERVAL_MS / 1000)}s`);
}

export function extractVideoUri(pollResult) {
  if (pollResult.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
    return pollResult.response.generateVideoResponse.generatedSamples[0].video.uri;
  }
  return null;
}
