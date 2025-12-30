/**
 * Environment variable utilities
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class EnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnvError';
  }
}

export function loadEnv(envPath = null) {
  const filePath = envPath || join(__dirname, '..', '..', '.env');

  if (!existsSync(filePath)) {
    throw new EnvError(`.env file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf8');
  const env = {};

  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const [key, ...valueParts] = trimmed.split('=');
    if (!key) {
      throw new EnvError(`Invalid .env format at line ${index + 1}`);
    }

    env[key.trim()] = valueParts.join('=').trim();
  });

  return env;
}

export function getApiKey(env = null) {
  // First check process.env (set by Prompt Stack runtime)
  if (process.env.GOOGLE_AI_API_KEY) {
    return process.env.GOOGLE_AI_API_KEY;
  }

  // Fall back to .env file (for local development)
  const environment = env || loadEnv();
  const apiKey = environment.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    throw new EnvError(
      'GOOGLE_AI_API_KEY not found.\n' +
      'For Prompt Stack: Add in Settings → Cloud & Secrets → Google AI → Connect\n' +
      'For local dev: Add to .env file\n' +
      'Get your key: https://makersuite.google.com/app/apikey'
    );
  }

  return apiKey;
}
