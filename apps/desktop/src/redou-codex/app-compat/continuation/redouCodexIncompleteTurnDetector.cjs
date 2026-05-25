'use strict';

const PROMISE_PATTERNS = [
  /(?:我(?:先|来|会|继续|接着|马上|现在)?(?:查看|检查|看看|确认|执行|运行|读取|打开|分析|处理|修改|排查|调查|同步|测试|继续))/,
  /(?:接下来|下一步).{0,16}(?:查看|检查|执行|运行|分析|处理|修改|同步|测试)/,
  /\b(?:I(?:'ll| will| am going to)|let me|next I will|I'm going to)\b.{0,80}\b(?:check|inspect|run|execute|read|open|analyze|update|change|continue|verify|test)\b/i,
];

const BLOCKER_PATTERNS = [
  /(?:需要你|请你|等你|无法继续|不能继续|权限|批准|授权|blocked|need(?:s)? (?:your )?(?:input|permission|approval))/i,
];

const TOOL_EVENT_TYPES = new Set([
  'command_update',
  'file_change',
  'approval_required',
]);

function eventTurnId(event = {}) {
  if (!event) return null;
  return (event.metadata && event.metadata.turnId)
    || (event.payload && event.payload.turnId)
    || (event.payload && event.payload.turn && event.payload.turn.id)
    || null;
}

function eventItemKind(event = {}) {
  return (event.metadata && event.metadata.itemKind)
    || (event.payload && event.payload.item && event.payload.item.type)
    || '';
}

function eventTime(event = {}) {
  return String(event.timestamp || '');
}

function isAfter(left, right) {
  if (!left || !right) return false;
  return eventTime(left).localeCompare(eventTime(right)) > 0;
}

function isCompletedTurnEvent(event = {}) {
  if (event.type !== 'turn_update') return false;
  const method = event.metadata && event.metadata.redouCodexMethod;
  const turn = event.payload && event.payload.turn ? event.payload.turn : {};
  const status = String(turn.status || event.payload?.status || event.message || '').toLowerCase();
  return method === 'turn/completed' && (status === '' || status === 'completed');
}

function isAssistantMessageCompleted(event = {}) {
  return event.type === 'message_completed' && String(event.message || '').trim();
}

function isWorkAfterMessage(event = {}) {
  if (TOOL_EVENT_TYPES.has(event.type)) return true;
  if (event.type !== 'item_update') return false;
  const kind = eventItemKind(event);
  return Boolean(kind && kind !== 'agentMessage' && kind !== 'userMessage');
}

function hasContinuationPromise(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (BLOCKER_PATTERNS.some((pattern) => pattern.test(value))) return false;
  return PROMISE_PATTERNS.some((pattern) => pattern.test(value));
}

function latestForTurn(events, turnId, predicate) {
  return [...events].reverse().find((event) => {
    if (turnId && eventTurnId(event) !== turnId) return false;
    return predicate(event);
  }) || null;
}

function detectIncompleteTurn(events = []) {
  const ordered = [...events].sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
  const completedTurn = [...ordered].reverse().find(isCompletedTurnEvent) || null;
  if (!completedTurn) return { incomplete: false, status: 'not_completed' };

  const turnId = eventTurnId(completedTurn);
  const assistantMessage = latestForTurn(ordered, turnId, isAssistantMessageCompleted);
  if (!assistantMessage) return { incomplete: false, status: 'no_final_message', turnId };

  const text = assistantMessage.message || assistantMessage.payload?.item?.text || '';
  if (!hasContinuationPromise(text)) return { incomplete: false, status: 'no_promise', turnId };

  const laterWork = ordered.find((event) => (
    (!turnId || eventTurnId(event) === turnId)
    && isAfter(event, assistantMessage)
    && isWorkAfterMessage(event)
  ));
  if (laterWork) {
    return { incomplete: false, status: 'work_followed_promise', turnId, laterWorkEventId: laterWork.id };
  }

  return {
    incomplete: true,
    status: 'incomplete',
    turnId,
    assistantMessage: text,
    messageEventId: assistantMessage.id,
    completedEventId: completedTurn.id,
    reason: 'assistant_promised_followup_without_tool_call',
    message: 'The assistant said it would continue with more work, but the turn completed without a following tool call.',
  };
}

module.exports = {
  detectIncompleteTurn,
  eventTurnId,
  hasContinuationPromise,
};
