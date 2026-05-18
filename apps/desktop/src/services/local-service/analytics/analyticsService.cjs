function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateKeyFromSeconds(seconds) {
  const date = new Date(Math.max(0, Number(seconds) || 0) * 1000);
  return date.toISOString().slice(0, 10);
}

class AnalyticsService {
  constructor({ host }) {
    if (!host) throw new Error("AnalyticsService requires a host service.");
    this.host = host;
  }

  getModelsAnalytics(days) {
    return this.host.runDashboardBridge("get_models_analytics", { days });
  }

  getUsageAnalytics(days = 7) {
    const safeDays = Math.max(1, Math.min(90, toInt(days) || 7));
    const now = new Date();
    const daily = [];
    const dailyMap = new Map();
    for (let index = safeDays - 1; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setUTCDate(now.getUTCDate() - index);
      const day = date.toISOString().slice(0, 10);
      const entry = {
        day,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        reasoning_tokens: 0,
        estimated_cost: 0,
        actual_cost: 0,
        sessions: 0,
        api_calls: 0,
        tool_calls: 0,
      };
      daily.push(entry);
      dailyMap.set(day, entry);
    }

    const cutoffSeconds = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - safeDays + 1,
      0,
      0,
      0,
    ) / 1000;
    const byModel = new Map();
    const totals = {
      total_input: 0,
      total_output: 0,
      total_cache_read: 0,
      total_reasoning: 0,
      total_estimated_cost: 0,
      total_actual_cost: 0,
      total_sessions: 0,
      total_api_calls: 0,
      total_tool_calls: 0,
    };

    for (const session of this.host.desktopSessionRecords()) {
      if (Number(session.last_active || 0) < cutoffSeconds) continue;
      const day = dateKeyFromSeconds(session.last_active);
      const dailyEntry = dailyMap.get(day);
      if (dailyEntry) {
        dailyEntry.input_tokens += toInt(session.input_tokens);
        dailyEntry.output_tokens += toInt(session.output_tokens);
        dailyEntry.cache_read_tokens += toInt(session.cache_read_tokens);
        dailyEntry.reasoning_tokens += toInt(session.reasoning_tokens);
        dailyEntry.estimated_cost += toNumber(session.estimated_cost);
        dailyEntry.sessions += 1;
        dailyEntry.api_calls += toInt(session.api_calls);
        dailyEntry.tool_calls += toInt(session.tool_call_count);
      }

      const modelKey = session.model || "redou-desktop/default";
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, {
          model: modelKey,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost: 0,
          actual_cost: 0,
          sessions: 0,
          api_calls: 0,
        });
      }
      const modelEntry = byModel.get(modelKey);
      modelEntry.input_tokens += toInt(session.input_tokens);
      modelEntry.output_tokens += toInt(session.output_tokens);
      modelEntry.estimated_cost += toNumber(session.estimated_cost);
      modelEntry.sessions += 1;
      modelEntry.api_calls += toInt(session.api_calls);

      totals.total_input += toInt(session.input_tokens);
      totals.total_output += toInt(session.output_tokens);
      totals.total_cache_read += toInt(session.cache_read_tokens);
      totals.total_reasoning += toInt(session.reasoning_tokens);
      totals.total_estimated_cost += toNumber(session.estimated_cost);
      totals.total_sessions += 1;
      totals.total_api_calls += toInt(session.api_calls);
      totals.total_tool_calls += toInt(session.tool_call_count);
    }

    return {
      daily,
      by_model: Array.from(byModel.values()).sort(
        (a, b) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens),
      ),
      totals,
      skills: {
        summary: {
          total_skill_loads: 0,
          total_skill_edits: 0,
          total_skill_actions: 0,
          distinct_skills_used: 0,
        },
        top_skills: [],
      },
    };
  }
}

module.exports = {
  AnalyticsService,
};
