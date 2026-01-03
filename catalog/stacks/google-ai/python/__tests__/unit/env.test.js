/**
 * Unit tests for env loader
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadEnv, getApiKey, EnvError } from '../../src/utils/env.js';

test('loadEnv should parse .env file correctly', () => {
  const env = loadEnv();
  assert.ok(env);
  assert.ok(typeof env === 'object');
});

test('loadEnv should throw if .env file not found', () => {
  assert.throws(
    () => loadEnv('/nonexistent/.env'),
    EnvError
  );
});

test('getApiKey should return API key from env', () => {
  const env = loadEnv();
  const apiKey = getApiKey(env);
  assert.ok(apiKey);
  assert.ok(typeof apiKey === 'string');
});

test('getApiKey should throw if API key missing', () => {
  assert.throws(
    () => getApiKey({}),
    EnvError
  );
});
