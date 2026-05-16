import importlib.util
import os
from pathlib import Path


def load_adapter():
    adapter_path = Path(__file__).resolve().parents[1] / "src" / "hermes_adapter.py"
    spec = importlib.util.spec_from_file_location("redou_hermes_adapter_for_test", adapter_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_redou_approval_callback_returns_hermes_choices(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)

    adapter.RISK_CONFIRMED = True
    assert adapter._approval_callback("bash -lc 'npm test'", "shell wrapper") == "once"
    assert emitted[-1]["metadata"]["approvalGranted"] is True

    adapter.RISK_CONFIRMED = False
    assert adapter._approval_callback("bash -lc 'npm test'", "shell wrapper") == "deny"
    assert emitted[-1]["type"] == "error"


def test_redou_approval_environment_uses_interactive_callback_path(monkeypatch):
    adapter = load_adapter()
    monkeypatch.setenv("HERMES_EXEC_ASK", "1")
    monkeypatch.delenv("HERMES_INTERACTIVE", raising=False)

    adapter._configure_approval_environment()

    assert "HERMES_EXEC_ASK" not in os.environ
    assert os.environ["HERMES_INTERACTIVE"] == "1"


def test_redou_developer_context_is_merged_into_system_prompt():
    adapter = load_adapter()

    system_context, user_context, history = adapter._context_messages_to_history(
        [
            {"role": "system", "content": "base system"},
            {"role": "developer", "content": "project rules"},
            {"role": "developer", "content": "task state"},
            {"role": "user", "content": "old request"},
            {"role": "assistant", "content": "old answer"},
            {"role": "tool", "content": "tool output", "tool_call_id": "call_1"},
            {"role": "user", "content": "current request"},
        ],
        "base system",
        "fallback user context",
    )

    assert system_context.count("base system") == 1
    assert "project rules" in system_context
    assert "task state" in system_context
    assert user_context == "current request"
    assert [message["role"] for message in history] == ["user", "assistant", "tool"]
    assert all(message["role"] != "developer" for message in history)
    assert history[-1]["tool_call_id"] == "call_1"
