'use strict';

const {
  baseRespError,
  httpError,
  missingApiKeyError,
  networkError,
  redactSensitive,
} = require('./minimaxErrors.cjs');

function joinUrl(host, requestPath) {
  const base = String(host || '').trim().replace(/\/+$/, '');
  const suffix = String(requestPath || '').trim().replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

async function responseBody(response) {
  const text = typeof response.text === 'function' ? await response.text() : '';
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function createAbortSignal(timeoutMs) {
  if (!timeoutMs || !Number.isFinite(Number(timeoutMs))) return { signal: undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs)));
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

class MiniMaxHttpDriver {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger || null;
    this.timeoutMs = Number(options.timeoutMs || config.timeoutMs || 60000);
  }

  log(level, message, payload = {}) {
    const logger = this.logger;
    if (!logger || typeof logger[level] !== 'function') return;
    logger[level](message, redactSensitive(payload, [this.config.apiKey]));
  }

  async request(requestPath, body = {}, options = {}) {
    const apiKey = String(options.apiKey || this.config.apiKey || '').trim();
    if (!apiKey) return missingApiKeyError();
    if (typeof this.fetchImpl !== 'function') {
      return networkError(new Error('fetch is not available'));
    }
    const url = joinUrl(options.host || this.config.host, requestPath);
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const timeout = createAbortSignal(options.timeoutMs || this.timeoutMs);
    this.log('debug', 'MiniMax HTTP request', { url, headers, body });
    try {
      const response = await this.fetchImpl(url, {
        method: options.method || 'POST',
        headers,
        body: JSON.stringify(body || {}),
        signal: timeout.signal,
      });
      const raw = await responseBody(response);
      this.log('debug', 'MiniMax HTTP response', { url, status: response.status, raw });
      if (!response.ok) return httpError(response.status, raw, [apiKey]);
      const businessError = baseRespError(raw, [apiKey]);
      if (businessError) return businessError;
      return { ok: true, provider: 'minimax', driver: 'direct_http', rawStatus: response.status, raw };
    } catch (error) {
      return networkError(error, [apiKey]);
    } finally {
      timeout.clear();
    }
  }

  async download(url, options = {}) {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is not available');
    const timeout = createAbortSignal(options.timeoutMs || this.timeoutMs);
    this.log('debug', 'MiniMax output download', { url });
    try {
      const response = await this.fetchImpl(url, { method: 'GET', signal: timeout.signal });
      if (!response.ok) {
        const raw = await responseBody(response);
        const error = httpError(response.status, raw, [this.config.apiKey]);
        const thrown = new Error(error.message);
        thrown.details = error;
        throw thrown;
      }
      if (typeof response.arrayBuffer === 'function') {
        return Buffer.from(await response.arrayBuffer());
      }
      if (typeof response.buffer === 'function') return await response.buffer();
      return Buffer.from(await response.text(), 'binary');
    } finally {
      timeout.clear();
    }
  }
}

function createMiniMaxHttpDriver(config = {}, options = {}) {
  return new MiniMaxHttpDriver(config, options);
}

module.exports = {
  MiniMaxHttpDriver,
  createMiniMaxHttpDriver,
  joinUrl,
};
