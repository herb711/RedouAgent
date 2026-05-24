'use strict';

const REDOU_MODEL_ENV_KEYS = Object.freeze({
  provider: 'REDOU_MODEL_PROVIDER',
  baseUrl: 'REDOU_MODEL_BASE_URL',
  apiKey: 'REDOU_MODEL_API_KEY',
  modelName: 'REDOU_MODEL_NAME',
});

function readRedouModelConfig(env = process.env) {
  const config = {
    provider: env.REDOU_MODEL_PROVIDER || '',
    baseUrl: env.REDOU_MODEL_BASE_URL || '',
    apiKey: env.REDOU_MODEL_API_KEY || '',
    modelName: env.REDOU_MODEL_NAME || '',
  };
  const missing = Object.entries(REDOU_MODEL_ENV_KEYS)
    .filter(([field, envKey]) => !String(config[field] || env[envKey] || '').trim())
    .map(([, envKey]) => envKey);
  return { ...config, missing, complete: missing.length === 0 };
}

function buildRedouModelChildEnv(config = readRedouModelConfig()) {
  const env = {};
  if (config.provider) env.REDOU_MODEL_PROVIDER = config.provider;
  if (config.baseUrl) env.REDOU_MODEL_BASE_URL = config.baseUrl;
  if (config.apiKey) env.REDOU_MODEL_API_KEY = config.apiKey;
  if (config.modelName) env.REDOU_MODEL_NAME = config.modelName;
  return env;
}

function assertRedouModelConfig(config = readRedouModelConfig()) {
  if (config.complete) return config;
  const error = new Error(`REDOU_MODEL_CONFIG_MISSING: missing ${config.missing.join(', ')}`);
  error.code = 'REDOU_MODEL_CONFIG_MISSING';
  error.details = { missing: config.missing };
  throw error;
}

function redactRedouModelConfig(config = readRedouModelConfig()) {
  return {
    provider: config.provider || null,
    baseUrl: config.baseUrl || null,
    modelName: config.modelName || null,
    apiKeyPresent: Boolean(config.apiKey),
    complete: config.complete,
    missing: config.missing,
  };
}

module.exports = {
  REDOU_MODEL_ENV_KEYS,
  readRedouModelConfig,
  buildRedouModelChildEnv,
  assertRedouModelConfig,
  redactRedouModelConfig,
};
