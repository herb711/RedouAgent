'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

function cleanString(value) {
  return String(value || '').trim();
}

function trimTrailingSlash(value) {
  return cleanString(value).replace(/\/+$/, '');
}

function chatCompletionsUrl(baseUrl) {
  const trimmed = trimTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/responses$/i.test(trimmed)) return `${trimmed.replace(/\/responses$/i, '')}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function modelsUrl(baseUrl) {
  const trimmed = trimTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (/\/models$/i.test(trimmed)) return trimmed;
  if (/\/chat\/completions$/i.test(trimmed)) return `${trimmed.replace(/\/chat\/completions$/i, '')}/models`;
  if (/\/responses$/i.test(trimmed)) return `${trimmed.replace(/\/responses$/i, '')}/models`;
  return `${trimmed}/models`;
}

function providerLabel(provider = {}) {
  return cleanString(provider.label || provider.name || provider.provider || provider.id || provider.runtimeProviderId) || 'Provider';
}

function providerApiKey(provider = {}) {
  return cleanString(provider.apiKey);
}

function authHeadersForProvider(provider = {}, fallbackToken = '') {
  const apiKey = providerApiKey(provider);
  if (apiKey) return { authorization: `Bearer ${apiKey}` };
  const token = cleanString(fallbackToken);
  return token ? { authorization: `Bearer ${token}` } : {};
}

function shouldRetryWithEmptyBearer(response, provider = {}) {
  if (!response || (response.status !== 401 && response.status !== 403)) return false;
  return !providerApiKey(provider) && provider.apiKeyOptional === true;
}

async function fetchProviderRequest(upstream, options, provider = {}) {
  const baseHeaders = { ...(options.headers || {}) };
  let response = await fetch(upstream, {
    ...options,
    headers: { ...baseHeaders, ...authHeadersForProvider(provider) },
  });
  let fallbackAuthTried = false;

  if (shouldRetryWithEmptyBearer(response, provider)) {
    fallbackAuthTried = true;
    await response.arrayBuffer().catch(() => null);
    response = await fetch(upstream, {
      ...options,
      headers: { ...baseHeaders, ...authHeadersForProvider(provider, 'EMPTY') },
    });
  }

  return { response, fallbackAuthTried };
}

function upstreamErrorMessage(provider, upstream, status, text, fallbackAuthTried) {
  const label = providerLabel(provider);
  const body = cleanString(text);
  const authHint = providerApiKey(provider)
    ? 'Check the provider API key and permissions.'
    : 'Add an API key in Settings, or configure the upstream provider to allow unauthenticated requests.';
  const retryHint = fallbackAuthTried
    ? ' The proxy also retried once with an empty bearer token, but the upstream still rejected it.'
    : '';
  const upstreamText = body ? ` Upstream response: ${body}` : '';
  return `${label} returned HTTP ${status} from ${upstream}. ${authHint}${retryHint}${upstreamText}`;
}

function writeUpstreamErrorResponse(res, response, provider, upstream, text, fallbackAuthTried) {
  res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    error: {
      message: upstreamErrorMessage(provider, upstream, response.status, text, fallbackAuthTried),
      provider: providerLabel(provider),
      upstream,
      upstreamStatus: response.status,
      upstreamBody: cleanString(text) || null,
    },
  }));
}

function shouldProxyProvider(provider = {}) {
  const protocol = cleanString(provider.apiProtocol || provider.wireApi || provider.wire_api).toLowerCase();
  if (protocol === 'responses') return false;
  if (protocol === 'chat' || protocol === 'chat-completions' || protocol === 'chat_completions') return true;
  const providerId = cleanString(provider.provider || provider.id).toLowerCase();
  if (providerId === 'openai' && /api\.openai\.com/i.test(cleanString(provider.baseUrl))) return false;
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
          return cleanString(part.text);
        }
        if (part.text) return cleanString(part.text);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && content.text) return cleanString(content.text);
  return '';
}

function normalizeRole(role) {
  const value = cleanString(role).toLowerCase();
  if (value === 'assistant') return 'assistant';
  if (value === 'system' || value === 'developer') return 'system';
  if (value === 'tool') return 'tool';
  return 'user';
}

function chatNameForResponseTool(namespace, name) {
  const cleanName = cleanString(name);
  const cleanNamespace = cleanString(namespace);
  if (!cleanNamespace) return cleanName;
  return cleanNamespace.endsWith('__') ? `${cleanNamespace}${cleanName}` : `${cleanNamespace}__${cleanName}`;
}

function chatToolFromResponseFunction(tool, namespace = '') {
  if (!tool || typeof tool !== 'object') return null;
  const name = cleanString(tool.name || (tool.function && tool.function.name));
  if (!name) return null;
  const description = cleanString(tool.description || (tool.function && tool.function.description));
  const parameters = tool.parameters || (tool.function && tool.function.parameters) || { type: 'object', properties: {} };
  const functionSpec = {
    name: chatNameForResponseTool(namespace, name),
    description,
    parameters,
  };
  const strict = tool.strict ?? (tool.function && tool.function.strict);
  if (strict === true) functionSpec.strict = true;
  return {
    chatTool: { type: 'function', function: functionSpec },
    responseTool: {
      name,
      namespace: cleanString(namespace) || null,
      chatName: functionSpec.name,
    },
  };
}

function responsesToolsToChatTools(tools) {
  const chatTools = [];
  const responseToolsByChatName = new Map();
  const items = Array.isArray(tools) ? tools : [];

  for (const tool of items) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.type === 'function' || tool.function) {
      const converted = chatToolFromResponseFunction(tool);
      if (!converted) continue;
      chatTools.push(converted.chatTool);
      responseToolsByChatName.set(converted.responseTool.chatName, converted.responseTool);
      continue;
    }
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
      const namespace = cleanString(tool.name);
      for (const child of tool.tools) {
        if (!child || child.type !== 'function') continue;
        const converted = chatToolFromResponseFunction(child, namespace);
        if (!converted) continue;
        chatTools.push(converted.chatTool);
        responseToolsByChatName.set(converted.responseTool.chatName, converted.responseTool);
      }
    }
  }

  return { chatTools, responseToolsByChatName };
}

function normalizeToolChoiceForChat(toolChoice, responseToolsByChatName = new Map()) {
  if (typeof toolChoice === 'string') {
    const value = cleanString(toolChoice).toLowerCase();
    if (value === 'none' || value === 'auto' || value === 'required') return value;
    return undefined;
  }
  if (!toolChoice || typeof toolChoice !== 'object') return undefined;
  const name = cleanString(toolChoice.name || (toolChoice.function && toolChoice.function.name));
  if (!name) return undefined;
  const namespace = cleanString(toolChoice.namespace);
  const chatName = chatNameForResponseTool(namespace, name);
  const mappedName = responseToolsByChatName.has(chatName) ? chatName : name;
  return { type: 'function', function: { name: mappedName } };
}

function responseInputToMessages(input) {
  if (!input) return [];
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  const items = Array.isArray(input) ? input : [input];
  const messages = [];

  for (const item of items) {
    if (typeof item === 'string') {
      messages.push({ role: 'user', content: item });
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'function_call_output') {
      const content = textFromContent(item.output || item.content);
      const callId = cleanString(item.call_id || item.callId);
      if (content && callId) {
        messages.push({ role: 'tool', tool_call_id: callId, content });
      } else if (content) {
        messages.push({ role: 'user', content: `Tool result:\n${content}` });
      }
      continue;
    }

    if (item.type === 'function_call') {
      const callId = cleanString(item.call_id || item.callId);
      const name = chatNameForResponseTool(item.namespace, item.name);
      if (callId && name) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: callId,
            type: 'function',
            function: {
              name,
              arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
            },
          }],
        });
      }
      continue;
    }

    const content = textFromContent(item.content || item.text || item.input);
    if (!content) continue;
    messages.push({
      role: normalizeRole(item.role),
      content,
    });
  }

  return messages;
}

function coalesceSystemMessages(messages) {
  const systemMessages = messages.filter((message) => message.role === 'system' && message.content);
  if (systemMessages.length <= 1) return messages;
  const combinedSystem = {
    role: 'system',
    content: systemMessages.map((message) => message.content).join('\n\n'),
  };
  const output = [];
  let inserted = false;
  for (const message of messages) {
    if (message.role === 'system') {
      if (!inserted) {
        output.push(combinedSystem);
        inserted = true;
      }
      continue;
    }
    output.push(message);
  }
  return output;
}

function responseBodyToChatRequest(body = {}, provider = {}, previousMessages = []) {
  let messages = [...previousMessages];
  const instructions = cleanString(body.instructions);
  if (instructions && !messages.some((message) => message.role === 'system' && message.content === instructions)) {
    messages.push({ role: 'system', content: instructions });
  }
  messages.push(...responseInputToMessages(body.input));
  messages = coalesceSystemMessages(messages);
  const { chatTools, responseToolsByChatName } = responsesToolsToChatTools(body.tools);
  const toolChoice = normalizeToolChoiceForChat(body.tool_choice || body.toolChoice, responseToolsByChatName);

  const request = {
    model: cleanString(body.model || provider.selectedModel || provider.defaultModel || (provider.models && provider.models[0])),
    messages,
    stream: true,
  };
  if (chatTools.length) {
    request.tools = chatTools;
    request.tool_choice = toolChoice || 'auto';
    if (typeof body.parallel_tool_calls === 'boolean') request.parallel_tool_calls = body.parallel_tool_calls;
  }
  return request;
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function completedResponse(responseId, output) {
  return {
    id: responseId,
    object: 'response',
    status: 'completed',
    output,
  };
}

function completionResponse(responseId, outputText) {
  return completedResponse(responseId, [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: outputText }],
    },
  ]);
}

function assistantMessageItem(responseId, outputText) {
  return {
    type: 'message',
    role: 'assistant',
    id: `msg_${responseId}`,
    content: [{ type: 'output_text', text: outputText }],
  };
}

function responseFunctionCallItem(call, responseToolsByChatName = new Map()) {
  const mapped = responseToolsByChatName.get(call.name);
  const item = {
    type: 'function_call',
    call_id: call.call_id,
    name: mapped ? mapped.name : call.name,
    arguments: call.arguments || '{}',
  };
  if (mapped && mapped.namespace) item.namespace = mapped.namespace;
  return item;
}

function chatToolCallFromCall(call) {
  return {
    id: call.call_id,
    type: 'function',
    function: {
      name: call.name,
      arguments: call.arguments || '{}',
    },
  };
}

function createToolCallAccumulator() {
  const calls = [];
  const byIndex = new Map();

  function getCall(index) {
    const key = Number.isInteger(index) ? index : 0;
    if (!byIndex.has(key)) {
      const call = { index: key, id: '', name: '', arguments: '' };
      byIndex.set(key, call);
      calls.push(call);
    }
    return byIndex.get(key);
  }

  function merge(parts) {
    const items = Array.isArray(parts) ? parts : [];
    items.forEach((part, ordinal) => {
      if (!part || typeof part !== 'object') return;
      const index = Number.isInteger(part.index) ? part.index : (items.length === 1 ? 0 : ordinal);
      const call = getCall(index);
      if (part.id) call.id = cleanString(part.id);
      const fn = part.function || {};
      if (typeof fn.name === 'string') {
        if (!call.name || call.name === fn.name) {
          call.name = fn.name;
        } else if (!call.name.endsWith(fn.name)) {
          call.name += fn.name;
        }
      }
      if (typeof fn.arguments === 'string') {
        call.arguments += fn.arguments;
      } else if (fn.arguments && typeof fn.arguments === 'object') {
        call.arguments += JSON.stringify(fn.arguments);
      }
    });
  }

  function values(responseId) {
    return calls
      .filter((call) => call.name)
      .map((call) => ({
        call_id: call.id || `call_${responseId.replace(/^resp_/, '').replace(/-/g, '').slice(0, 16)}_${call.index}`,
        name: call.name,
        arguments: call.arguments || '{}',
      }));
  }

  return { merge, values };
}

function chatToolCallsFromDelta(delta) {
  if (!delta || typeof delta !== 'object') return [];
  if (Array.isArray(delta.tool_calls)) return delta.tool_calls;
  if (delta.function_call && typeof delta.function_call === 'object') {
    return [{ index: 0, type: 'function', function: delta.function_call }];
  }
  return [];
}

function parseSseBlocks(buffer) {
  const blocks = [];
  let rest = buffer;
  let index = rest.indexOf('\n\n');
  while (index !== -1) {
    blocks.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
    index = rest.indexOf('\n\n');
  }
  return { blocks, rest };
}

function dataPayloadFromSseBlock(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

function chatDeltaFromChunk(payload) {
  if (!payload || payload === '[DONE]') return { content: '', toolCalls: [] };
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { content: '', toolCalls: [] };
  }
  const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
  if (!delta) return { content: '', toolCalls: [] };
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    toolCalls: chatToolCallsFromDelta(delta),
  };
}

function contentFromChatChunk(payload) {
  return chatDeltaFromChunk(payload).content;
}

function toolCallsFromChatResponse(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const message = payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) return [];
  if (Array.isArray(message.tool_calls)) return message.tool_calls;
  if (message.function_call && typeof message.function_call === 'object') {
    return [{ index: 0, type: 'function', id: message.function_call.id, function: message.function_call }];
  }
  return [];
}

function contentFromChatResponse(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const message = payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return textFromContent(message.content);
  return '';
}

function stripThinkBlocks(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s+/, '');
}

function createThinkBlockFilter() {
  const openTag = '<think>';
  const closeTag = '</think>';
  let carry = '';
  let insideThink = false;

  function push(chunk) {
    let text = carry + String(chunk || '');
    carry = '';
    let output = '';

    while (text) {
      const lower = text.toLowerCase();
      if (insideThink) {
        const end = lower.indexOf(closeTag);
        if (end === -1) {
          carry = text.slice(-Math.max(closeTag.length - 1, 0));
          return output;
        }
        text = text.slice(end + closeTag.length);
        insideThink = false;
        continue;
      }

      const start = lower.indexOf(openTag);
      if (start === -1) {
        const keep = Math.min(openTag.length - 1, text.length);
        output += text.slice(0, text.length - keep);
        carry = text.slice(text.length - keep);
        return output;
      }

      output += text.slice(0, start);
      text = text.slice(start + openTag.length);
      insideThink = true;
    }

    return output;
  }

  function flush() {
    const tail = insideThink ? '' : carry;
    carry = '';
    return tail;
  }

  return { push, flush };
}

async function proxyModelsRequest(req, res, provider) {
  const upstream = modelsUrl(provider.baseUrl);
  if (!upstream) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Provider baseUrl is empty.' } }));
    return;
  }
  const { response, fallbackAuthTried } = await fetchProviderRequest(upstream, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }, provider);
  const body = await response.arrayBuffer();
  if (!response.ok) {
    writeUpstreamErrorResponse(res, response, provider, upstream, Buffer.from(body).toString('utf8'), fallbackAuthTried);
    return;
  }
  res.writeHead(response.status, {
    'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
  });
  res.end(Buffer.from(body));
}

async function proxyResponsesRequest(req, res, provider, conversations, options = {}) {
  const rawBody = await readRequestBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON request body.' } }));
    return;
  }

  const upstream = chatCompletionsUrl(provider.baseUrl);
  if (!upstream) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Provider baseUrl is empty.' } }));
    return;
  }

  const previousMessages = body.previous_response_id && conversations.has(body.previous_response_id)
    ? conversations.get(body.previous_response_id)
    : [];
  const { responseToolsByChatName } = responsesToolsToChatTools(body.tools);
  const chatRequest = responseBodyToChatRequest(body, provider, previousMessages);
  if (typeof options.onChatRequest === 'function') {
    options.onChatRequest({
      upstream,
      responsesRequest: body,
      chatRequest,
      provider: {
        id: provider.id,
        runtimeProviderId: provider.runtimeProviderId,
        baseUrl: provider.baseUrl,
        selectedModel: provider.selectedModel,
      },
    });
  }
  if (!chatRequest.model) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'Model is required.' } }));
    return;
  }

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  let upstreamResponse;
  let fallbackAuthTried = false;
  try {
    const result = await fetchProviderRequest(upstream, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream, application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(chatRequest),
      signal: controller.signal,
    }, provider);
    upstreamResponse = result.response;
    fallbackAuthTried = result.fallbackAuthTried;
  } catch (error) {
    if (controller.signal.aborted) return;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: error && error.message ? error.message : String(error) } }));
    return;
  }

  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text().catch(() => '');
    writeUpstreamErrorResponse(res, upstreamResponse, provider, upstream, text, fallbackAuthTried);
    return;
  }

  const responseId = `resp_${randomUUID()}`;
  let outputText = '';
  let textItemStarted = false;
  const outputItems = [];
  const toolCallAccumulator = createToolCallAccumulator();
  const thinkFilter = createThinkBlockFilter();
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  writeSse(res, 'response.created', {
    type: 'response.created',
    response: { id: responseId, status: 'in_progress' },
  });

  function ensureTextItemStarted() {
    if (textItemStarted) return;
    textItemStarted = true;
    writeSse(res, 'response.output_item.added', {
      type: 'response.output_item.added',
      item: assistantMessageItem(responseId, ''),
    });
  }

  function writeTextDelta(delta) {
    if (!delta) return;
    ensureTextItemStarted();
    outputText += delta;
    writeSse(res, 'response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: `msg_${responseId}`,
      output_index: 0,
      content_index: 0,
      delta,
    });
  }

  const contentType = upstreamResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const payload = await upstreamResponse.json().catch(() => null);
    const text = stripThinkBlocks(contentFromChatResponse(payload));
    toolCallAccumulator.merge(toolCallsFromChatResponse(payload));
    if (text) {
      writeTextDelta(text);
    }
  } else {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of upstreamResponse.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      const parsed = parseSseBlocks(buffer);
      buffer = parsed.rest;
      for (const block of parsed.blocks) {
        const payload = dataPayloadFromSseBlock(block);
        const chatDelta = chatDeltaFromChunk(payload);
        toolCallAccumulator.merge(chatDelta.toolCalls);
        const visibleDelta = thinkFilter.push(chatDelta.content);
        if (!visibleDelta) continue;
        writeTextDelta(visibleDelta);
      }
    }
    const rawTail = thinkFilter.flush();
    const tail = outputText ? rawTail : rawTail.replace(/^\s+/, '');
    if (tail) {
      writeTextDelta(tail);
    }
  }

  if (textItemStarted) {
    const messageItem = assistantMessageItem(responseId, outputText);
    outputItems.push(messageItem);
    writeSse(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      item: messageItem,
    });
  }
  const toolCalls = toolCallAccumulator.values(responseId);
  for (const call of toolCalls) {
    const item = responseFunctionCallItem(call, responseToolsByChatName);
    outputItems.push(item);
    writeSse(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      item,
    });
  }
  if (!outputItems.length) {
    const emptyMessageItem = assistantMessageItem(responseId, '');
    outputItems.push(emptyMessageItem);
    writeSse(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      item: emptyMessageItem,
    });
  }
  const completed = completedResponse(responseId, outputItems);
  const assistantMessage = toolCalls.length
    ? { role: 'assistant', content: outputText || null, tool_calls: toolCalls.map(chatToolCallFromCall) }
    : { role: 'assistant', content: outputText };
  conversations.set(responseId, [...chatRequest.messages, assistantMessage]);
  writeSse(res, 'response.completed', {
    type: 'response.completed',
    response: completed,
  });
  res.end();
}

function createResponsesChatProxyManager(options = {}) {
  const proxies = new Map();

  async function ensureProxy(provider = {}) {
    if (!shouldProxyProvider(provider)) {
      return { proxied: false, baseUrl: provider.baseUrl };
    }
    const key = JSON.stringify([
      provider.runtimeProviderId || provider.id,
      provider.baseUrl,
      provider.apiKey || '',
      provider.selectedModel || provider.defaultModel || '',
    ]);
    if (proxies.has(key)) return proxies.get(key).descriptor;

    const conversations = new Map();
    const server = http.createServer((req, res) => {
      Promise.resolve()
        .then(async () => {
          const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
          if (req.method === 'GET' && pathname.endsWith('/models')) {
            await proxyModelsRequest(req, res, provider);
            return;
          }
          if (req.method === 'POST' && pathname.endsWith('/responses')) {
            await proxyResponsesRequest(req, res, provider, conversations, options);
            return;
          }
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: 'Not found.' } }));
        })
        .catch((error) => {
          if (res.headersSent) {
            res.end();
            return;
          }
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: error && error.message ? error.message : String(error) } }));
        });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const descriptor = {
      proxied: true,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      upstreamBaseUrl: provider.baseUrl,
    };
    proxies.set(key, { server, descriptor });
    return descriptor;
  }

  async function dispose() {
    const entries = [...proxies.values()];
    proxies.clear();
    await Promise.all(entries.map(({ server }) => new Promise((resolve) => {
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(resolve);
    })));
  }

  return {
    ensureProxy,
    dispose,
    shouldProxyProvider,
  };
}

module.exports = {
  chatCompletionsUrl,
  coalesceSystemMessages,
  createThinkBlockFilter,
  createResponsesChatProxyManager,
  responseBodyToChatRequest,
  shouldProxyProvider,
  stripThinkBlocks,
};
