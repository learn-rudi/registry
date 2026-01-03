/**
 * Base client for Google AI APIs
 */

import { API_BASE_URL } from '../constants.js';

export class ApiError extends Error {
  constructor(message, statusCode = null, response = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

export class BaseClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = API_BASE_URL;
  }

  buildUrl(modelId, endpoint) {
    return `${this.baseUrl}/models/${modelId}:${endpoint}`;
  }

  async makeRequest(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.error?.message || `HTTP ${response.statusCode}`,
        response.statusCode,
        error
      );
    }

    return response.json();
  }
}
