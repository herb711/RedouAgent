'use strict';

const PROVIDER = 'minimax';
const DRIVER = 'direct_http';

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '****';
  const suffix = text.slice(-4);
  if (text.startsWith('sk-')) return `sk-****${suffix}`;
  return `****${suffix}`;
}

function redactSensitive(value, secrets = []) {
  const secretValues = secrets
    .map((item) => String(item || ''))
    .filter((item) => item.length >= 4);
  function redactString(input) {
    let output = String(input || '');
    for (const secret of secretValues) {
      output = output.split(secret).join(maskSecret(secret));
    }
    output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]');
    output = output.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, (match) => maskSecret(match));
    return output;
  }
  function walk(input, key = '') {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') return redactString(input);
    if (typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map((item) => walk(item));
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(input)) {
      if (/(authorization|api[_-]?key|minimax_api_key|token|secret|password)/i.test(entryKey)) {
        result[entryKey] = entryValue ? '[redacted]' : entryValue;
      } else {
        result[entryKey] = walk(entryValue, entryKey || key);
      }
    }
    return result;
  }
  return walk(value);
}

function minimaxError(input = {}) {
  const secrets = input.secrets || [];
  return {
    ok: false,
    provider: PROVIDER,
    driver: DRIVER,
    code: String(input.code || 'MINIMAX_ERROR'),
    message: redactSensitive(String(input.message || 'MiniMax request failed.'), secrets),
    hint: redactSensitive(String(input.hint || ''), secrets),
    rawStatus: input.rawStatus === undefined ? null : input.rawStatus,
    raw: redactSensitive(input.raw || {}, secrets),
  };
}

function missingApiKeyError() {
  return minimaxError({
    code: 'MINIMAX_API_KEY_MISSING',
    message: 'MiniMax API Key is missing.',
    hint: '请在 MiniMax 插件设置中填写 API Key。',
  });
}

function networkError(error, secrets = []) {
  const message = error && error.name === 'AbortError'
    ? 'MiniMax request timed out.'
    : 'MiniMax network request failed.';
  return minimaxError({
    code: error && error.name === 'AbortError' ? 'MINIMAX_TIMEOUT' : 'MINIMAX_NETWORK_ERROR',
    message,
    hint: '网络连接失败，请检查代理、防火墙或 MiniMax 服务地址。',
    raw: { message: error && error.message ? error.message : String(error) },
    secrets,
  });
}

function outputError(error) {
  return minimaxError({
    code: 'MINIMAX_OUTPUT_ERROR',
    message: 'MiniMax generated output could not be saved.',
    hint: '生成成功但文件保存失败，请检查输出目录权限。',
    raw: { message: error && error.message ? error.message : String(error) },
  });
}

function baseRespFrom(raw = {}) {
  if (raw && raw.base_resp && typeof raw.base_resp === 'object') return raw.base_resp;
  if (raw && raw.baseResp && typeof raw.baseResp === 'object') return raw.baseResp;
  return null;
}

function statusCodeFromBaseResp(baseResp) {
  const value = baseResp?.status_code ?? baseResp?.statusCode ?? baseResp?.code;
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function messageFromBaseResp(baseResp) {
  return String(baseResp?.status_msg || baseResp?.statusMessage || baseResp?.message || '');
}

function isAuthCode(code, message = '') {
  return Number(code) === 1004 || /auth|unauthori[sz]ed|invalid.*key|api\s*key|鉴权|认证|密钥/i.test(message);
}

function isQuotaCode(code, message = '') {
  return [1008, 1013, 1027, 2013, 2038, 2049].includes(Number(code))
    || /quota|balance|credit|billing|insufficient|token plan|额度|余额|套餐|欠费/i.test(message);
}

function httpError(status, raw = {}, secrets = []) {
  const message = typeof raw === 'object'
    ? String(raw.message || raw.error || raw.status_msg || raw.statusText || `HTTP ${status}`)
    : String(raw || `HTTP ${status}`);
  if (status === 401 || status === 403) {
    return minimaxError({
      code: 'MINIMAX_AUTH_FAILED',
      message: 'MiniMax authentication failed.',
      hint: 'API Key 未通过鉴权，请检查 Key 是否有效、region/host 是否匹配、Token Plan 是否开通。',
      rawStatus: status,
      raw,
      secrets,
    });
  }
  if (status === 402 || status === 429 || isQuotaCode(0, message)) {
    return minimaxError({
      code: 'MINIMAX_QUOTA_EXCEEDED',
      message: 'MiniMax quota is not available.',
      hint: '额度不足或当前套餐不支持该模型，请检查 MiniMax Token Plan 额度。',
      rawStatus: status,
      raw,
      secrets,
    });
  }
  return minimaxError({
    code: `MINIMAX_HTTP_${status}`,
    message,
    hint: 'MiniMax HTTP 请求失败，请检查服务地址、网络和请求参数。',
    rawStatus: status,
    raw,
    secrets,
  });
}

function baseRespError(raw = {}, secrets = []) {
  const baseResp = baseRespFrom(raw);
  if (!baseResp) return null;
  const statusCode = statusCodeFromBaseResp(baseResp);
  if (!statusCode || Number(statusCode) === 0) return null;
  const statusMessage = messageFromBaseResp(baseResp);
  if (isAuthCode(statusCode, statusMessage)) {
    return minimaxError({
      code: 'MINIMAX_AUTH_FAILED',
      message: statusMessage || 'MiniMax authentication failed.',
      hint: 'API Key 未通过鉴权，请检查 Key 是否有效、region/host 是否匹配、Token Plan 是否开通。',
      rawStatus: null,
      raw: { base_resp: baseResp },
      secrets,
    });
  }
  if (isQuotaCode(statusCode, statusMessage)) {
    return minimaxError({
      code: 'MINIMAX_QUOTA_EXCEEDED',
      message: statusMessage || 'MiniMax quota is not available.',
      hint: '额度不足或当前套餐不支持该模型，请检查 MiniMax Token Plan 额度。',
      rawStatus: null,
      raw: { base_resp: baseResp },
      secrets,
    });
  }
  return minimaxError({
    code: `MINIMAX_BASE_RESP_${statusCode}`,
    message: statusMessage || 'MiniMax API returned an error.',
    hint: 'MiniMax 返回了业务错误，请检查请求参数、模型权限和账户状态。',
    rawStatus: null,
    raw: { base_resp: baseResp },
    secrets,
  });
}

module.exports = {
  DRIVER,
  PROVIDER,
  baseRespError,
  baseRespFrom,
  httpError,
  maskSecret,
  minimaxError,
  missingApiKeyError,
  networkError,
  outputError,
  redactSensitive,
};
