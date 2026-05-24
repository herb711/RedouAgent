const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  chatCompletionsUrl,
  coalesceSystemMessages,
  createThinkBlockFilter,
  createResponsesChatProxyManager,
  responseBodyToChatRequest,
  shouldProxyProvider,
  stripThinkBlocks,
} = require('../src/core/models/responsesChatProxy.cjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

test('provider protocol detection leaves OpenAI Responses direct and proxies chat providers', () => {
  assert.equal(shouldProxyProvider({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiProtocol: 'responses' }), false);
  assert.equal(shouldProxyProvider({ provider: 'minimax', baseUrl: 'https://api.minimaxi.com/v1', apiProtocol: 'chat-completions' }), true);
  assert.equal(chatCompletionsUrl('https://api.minimaxi.com/v1'), 'https://api.minimaxi.com/v1/chat/completions');
});

test('Responses input is converted to a chat completions request', () => {
  const request = responseBodyToChatRequest({
    model: 'MiniMax-M2.7',
    instructions: 'Be brief.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ],
  });

  assert.equal(request.model, 'MiniMax-M2.7');
  assert.deepEqual(request.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(request.stream, true);
});

test('Responses tools are converted to chat completions tools', () => {
  const request = responseBodyToChatRequest({
    model: 'Qwen/Qwen3.6-27B-FP8',
    input: 'check my machine',
    tool_choice: 'auto',
    parallel_tool_calls: true,
    tools: [
      {
        type: 'function',
        name: 'shell_command',
        description: 'Runs a shell command.',
        strict: false,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ],
  });

  assert.deepEqual(request.tools, [
    {
      type: 'function',
      function: {
        name: 'shell_command',
        description: 'Runs a shell command.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    },
  ]);
  assert.equal(request.tool_choice, 'auto');
  assert.equal(request.parallel_tool_calls, true);
});

test('multiple Responses system inputs are coalesced for chat providers', () => {
  assert.deepEqual(coalesceSystemMessages([
    { role: 'system', content: 'one' },
    { role: 'user', content: 'hello' },
    { role: 'system', content: 'two' },
  ]), [
    { role: 'system', content: 'one\n\ntwo' },
    { role: 'user', content: 'hello' },
  ]);
});

test('visible output strips chat-model think blocks', () => {
  assert.equal(stripThinkBlocks('<think>hidden</think>\n\nanswer'), 'answer');

  const filter = createThinkBlockFilter();
  const chunks = [
    filter.push('<thi'),
    filter.push('nk>hidden'),
    filter.push('</thi'),
    filter.push('nk>\n\nanswer'),
    filter.flush(),
  ];
  assert.equal(chunks.join('').trim(), 'answer');
});

test('local proxy translates /responses streaming to /chat/completions SSE', async () => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  const upstreamPort = await listen(upstream);
  const manager = createResponsesChatProxyManager();

  try {
    const proxy = await manager.ensureProxy({
      id: 'minimax',
      runtimeProviderId: 'redou-minimax',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'secret-key',
      selectedModel: 'MiniMax-M2.7',
      apiProtocol: 'chat-completions',
    });

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].method, 'POST');
    assert.equal(upstreamRequests[0].url, '/v1/chat/completions');
    assert.equal(upstreamRequests[0].authorization, 'Bearer secret-key');
    assert.equal(upstreamRequests[0].body.messages.at(-1).content, 'hi');
    assert.match(text, /response\.created/);
    assert.match(text, /response\.output_item\.added/);
    assert.match(text, /response\.output_text\.delta/);
    assert.match(text, /response\.output_item\.done/);
    assert.match(text, /hello world/);
    assert.match(text, /response\.completed/);
  } finally {
    await manager.dispose();
    await close(upstream);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

test('local proxy translates chat tool call SSE to Responses function_call events', async () => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      body: JSON.parse(body),
    });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.write(sseData({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_config',
            type: 'function',
            function: { name: 'shell_command', arguments: '{"command":"sys' },
          }],
        },
      }],
    }));
    res.write(sseData({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: 'teminfo"}' },
          }],
        },
      }],
    }));
    res.end('data: [DONE]\n\n');
  });
  const upstreamPort = await listen(upstream);
  const manager = createResponsesChatProxyManager();

  try {
    const proxy = await manager.ensureProxy({
      id: 'qwen',
      runtimeProviderId: 'redou-qwen',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      selectedModel: 'Qwen/Qwen3.6-27B-FP8',
      apiProtocol: 'chat-completions',
    });

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3.6-27B-FP8',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '配置?' }] }],
        tools: [
          {
            type: 'function',
            name: 'shell_command',
            description: 'Runs a shell command.',
            parameters: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        ],
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].url, '/v1/chat/completions');
    assert.equal(upstreamRequests[0].body.tools[0].function.name, 'shell_command');
    assert.equal(upstreamRequests[0].body.tool_choice, 'auto');
    assert.doesNotMatch(text, /response\.output_text\.delta/);
    assert.match(text, /response\.output_item\.done/);
    assert.match(text, /"type":"function_call"/);
    assert.match(text, /"call_id":"call_config"/);
    assert.match(text, /"name":"shell_command"/);
    assert.match(text, /systeminfo/);
    assert.match(text, /response\.completed/);
  } finally {
    await manager.dispose();
    await close(upstream);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

test('local proxy retries optional no-key providers with an empty bearer token', async () => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    upstreamRequests.push({
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });

    if (!req.headers.authorization) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
  });
  const upstreamPort = await listen(upstream);
  const manager = createResponsesChatProxyManager();

  try {
    const proxy = await manager.ensureProxy({
      id: 'qwen',
      label: 'Qwen',
      runtimeProviderId: 'redou-qwen',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: '',
      apiKeyOptional: true,
      selectedModel: 'Qwen/Qwen3.6-27B-FP8',
      apiProtocol: 'chat-completions',
    });

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3.6-27B-FP8',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 2);
    assert.equal(upstreamRequests[0].authorization, undefined);
    assert.equal(upstreamRequests[1].authorization, 'Bearer EMPTY');
    assert.equal(upstreamRequests[1].body.messages.at(-1).content, 'hi');
    assert.match(text, /hello/);
  } finally {
    await manager.dispose();
    await close(upstream);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

test('local proxy explains upstream unauthorized failures with provider context', async () => {
  const upstream = http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  const upstreamPort = await listen(upstream);
  const manager = createResponsesChatProxyManager();

  try {
    const proxy = await manager.ensureProxy({
      id: 'qwen',
      label: 'Qwen',
      runtimeProviderId: 'redou-qwen',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: '',
      apiKeyOptional: true,
      selectedModel: 'Qwen/Qwen3.6-27B-FP8',
      apiProtocol: 'chat-completions',
    });

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3.6-27B-FP8',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.match(payload.error.message, /Qwen returned HTTP 401/);
    assert.match(payload.error.message, /\/v1\/chat\/completions/);
    assert.match(payload.error.message, /Add an API key in Settings/);
    assert.match(payload.error.message, /empty bearer token/);
    assert.match(payload.error.message, /Unauthorized/);
  } finally {
    await manager.dispose();
    await close(upstream);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});
