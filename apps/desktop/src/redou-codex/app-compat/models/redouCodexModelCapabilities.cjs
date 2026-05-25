'use strict';

const DEFAULT_CONTEXT_WINDOW = 32768;

const PROVIDER_DEFAULTS = Object.freeze({
  openai: { known: true, contextWindow: 262144, toolReliability: 'high', parallelTools: true, reasoning: true, wireApi: 'responses' },
  qwen: { known: true, contextWindow: 131072, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  minimax: { known: true, contextWindow: 262144, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  moonshot: { known: true, contextWindow: 131072, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  deepseek: { known: true, contextWindow: 128000, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  doubao: { known: true, contextWindow: 128000, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  zhipu: { known: true, contextWindow: 128000, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  siliconflow: { known: true, contextWindow: 128000, toolReliability: 'variable', parallelTools: false, reasoning: true, wireApi: 'responses' },
  qianfan: { known: true, contextWindow: 128000, toolReliability: 'medium', parallelTools: false, reasoning: true, wireApi: 'responses' },
  mimo: { known: true, contextWindow: 128000, toolReliability: 'medium', parallelTools: false, reasoning: false, wireApi: 'responses' },
  openrouter: { known: true, contextWindow: 128000, toolReliability: 'variable', parallelTools: false, reasoning: false, wireApi: 'responses' },
  'local-vllm': { known: true, contextWindow: 32768, toolReliability: 'variable', parallelTools: false, reasoning: false, wireApi: 'responses' },
});

const MODEL_OVERRIDES = Object.freeze([
  { pattern: /qwen3\.6|qwen3-?coder|qwen.*coder/i, contextWindow: 262144, reasoning: true, toolReliability: 'medium' },
  { pattern: /MiniMax-M2\.7/i, contextWindow: 262144, reasoning: true, toolReliability: 'medium' },
  { pattern: /kimi-k2|moonshot/i, contextWindow: 131072, reasoning: true, toolReliability: 'medium' },
  { pattern: /deepseek-(reasoner|v4|coder)/i, contextWindow: 128000, reasoning: true, toolReliability: 'medium' },
  { pattern: /ernie|qianfan/i, contextWindow: 128000, reasoning: true, toolReliability: 'medium' },
  { pattern: /gpt-5|gpt-4\.1/i, contextWindow: 262144, reasoning: true, toolReliability: 'high', parallelTools: true },
]);

function normalizeProviderId(value) {
  return String(value || '')
    .replace(/^redou-/, '')
    .trim()
    .toLowerCase();
}

function inferProviderId(input = {}) {
  return normalizeProviderId(input.providerId || input.provider || input.runtimeProviderId || input.modelProvider || input.id);
}

function inferRedouCodexModelCapability(input = {}) {
  const providerId = inferProviderId(input);
  const model = String(input.model || input.modelId || input.selectedModel || input.defaultModel || '').trim();
  const base = PROVIDER_DEFAULTS[providerId] || null;
  const override = MODEL_OVERRIDES.find((entry) => entry.pattern.test(model)) || null;
  const known = Boolean(base || override);
  const capability = {
    providerId: providerId || null,
    model: model || null,
    known,
    degraded: !known,
    contextWindow: (override && override.contextWindow) || (base && base.contextWindow) || DEFAULT_CONTEXT_WINDOW,
    toolReliability: (override && override.toolReliability) || (base && base.toolReliability) || 'unknown',
    parallelTools: Boolean((override && override.parallelTools !== undefined ? override.parallelTools : base && base.parallelTools) || false),
    reasoning: Boolean((override && override.reasoning !== undefined ? override.reasoning : base && base.reasoning) || false),
    wireApi: (base && base.wireApi) || 'responses',
    warnings: [],
  };

  if (!known) {
    capability.warnings.push(`Model metadata for ${model || 'the selected model'} is not registered; Redou will use conservative redou-codex defaults.`);
  }
  if (capability.toolReliability === 'unknown' || capability.toolReliability === 'variable') {
    capability.warnings.push('Tool-call behavior may differ from the official Codex App model path.');
  }
  if (!capability.parallelTools) {
    capability.warnings.push('Parallel tool calls are treated as unsupported for this model.');
  }

  return capability;
}

module.exports = {
  DEFAULT_CONTEXT_WINDOW,
  inferProviderId,
  inferRedouCodexModelCapability,
};
