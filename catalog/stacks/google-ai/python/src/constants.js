/**
 * Constants for Google AI API
 */

export const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const API_ENDPOINTS = {
  GENERATE_CONTENT: 'generateContent',
  PREDICT: 'predict',
  PREDICT_LONG_RUNNING: 'predictLongRunning'
};

export const IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
export const IMAGE_SIZES = ['1K', '2K', '4K'];
export const VIDEO_ASPECT_RATIOS = ['1:1', '9:16', '16:9'];
export const VIDEO_DURATION_SECONDS = 8;

export const RESPONSE_MODALITIES = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO'
};

export const HTTP_STATUS = {
  OK: 200,
  REDIRECT_TEMP: 302,
  REDIRECT_PERM: 301,
  NOT_FOUND: 404,
  QUOTA_EXCEEDED: 429
};

export const POLLING_CONFIG = {
  INTERVAL_MS: 5000,
  MAX_ATTEMPTS: 60,
  TIMEOUT_MS: 300000
};

export const FILE_EXTENSIONS = {
  IMAGE: '.png',
  VIDEO: '.mp4'
};
