"""Local Redou-to-Hermes adapter.

The Electron Main Process starts this script as a short-lived child process for
one Task Chat turn. It reads a JSON payload from stdin and writes structured
AgentEvent JSON lines to stdout. Any ordinary Hermes/runtime noise is redirected
to stderr so the Renderer never becomes a terminal relay.
"""

from __future__ import annotations

import contextlib
import asyncio
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Source checkout layout: apps/desktop/src -> repo root -> vendor/hermes.
_REDOU_PROJECT_ROOT = Path(os.environ.get("REDOU_PROJECT_ROOT", Path(__file__).resolve().parents[3]))
_HERMES_VENDOR_ROOT = Path(os.environ.get("HERMES_VENDOR_ROOT", _REDOU_PROJECT_ROOT / "vendor" / "hermes"))
if _HERMES_VENDOR_ROOT.is_dir():
    value = str(_HERMES_VENDOR_ROOT)
    if value not in sys.path:
        sys.path.insert(0, value)
from typing import Any, Dict


EVENT_OUT = sys.stdout
RISK_CONFIRMED = False
EVENT_LOCK = threading.Lock()
RUN_STAGE_STAGES = {
    "understanding",
    "inspecting",
    "planning",
    "editing",
    "testing",
    "packaging",
    "summarizing",
    "blocked",
    "done",
    "failed",
}
RUN_STAGE_STATUSES = {
    "started",
    "running",
    "completed",
    "skipped",
    "blocked",
    "failed",
}


def _project_root() -> Path:
    return _REDOU_PROJECT_ROOT


def _emit(event: Dict[str, Any]) -> None:
    with EVENT_LOCK:
        EVENT_OUT.write(json.dumps(event, ensure_ascii=False) + "\n")
        EVENT_OUT.flush()


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _turn_timing_metadata(started_at: str, started_monotonic: float) -> Dict[str, Any]:
    duration_ms = max(0, int(round((time.monotonic() - started_monotonic) * 1000)))
    return {
        "startedAt": started_at,
        "completedAt": _utc_iso(),
        "durationMs": duration_ms,
        "durationSeconds": round(duration_ms / 1000, 1),
    }


def _safe_json(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)


def _run_stage_object(value: Any) -> Dict[str, Any] | None:
    if isinstance(value, str):
        raw = value.strip()
        if not raw or not raw.startswith("{"):
            return None
        try:
            value = json.loads(raw)
        except Exception:
            return None
    if not isinstance(value, dict) or value.get("type") != "run_stage":
        return None
    stage = str(value.get("stage") or "").strip()
    if stage not in RUN_STAGE_STAGES:
        return None
    status = str(value.get("status") or "running").strip()
    if status not in RUN_STAGE_STATUSES:
        status = "running"
    return {
        **value,
        "type": "run_stage",
        "stage": stage,
        "status": status,
        "source": "hermes",
        "timestamp": str(value.get("timestamp") or _utc_iso()),
    }


def _strip_run_stage_json_lines(text: str) -> str:
    if _run_stage_object(text) is not None:
        return ""
    lines = str(text or "").splitlines()
    if not lines:
        return ""
    kept: list[str] = []
    for line in lines:
        if _run_stage_object(line) is not None:
            continue
        kept.append(line)
    return "\n".join(kept).strip()


def _is_image_attachment(attachment: Dict[str, Any]) -> bool:
    mime = str(attachment.get("mimeType") or "").lower()
    if mime.startswith("image/"):
        return True
    suffix = Path(str(attachment.get("storedPath") or attachment.get("name") or "")).suffix.lower()
    return suffix in {".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"}


def _attachment_image_paths(payload: Dict[str, Any]) -> list[str]:
    attachments = payload.get("attachments")
    if not isinstance(attachments, list):
        return []
    paths: list[str] = []
    for item in attachments:
        if not isinstance(item, dict) or not _is_image_attachment(item):
            continue
        stored_path = str(item.get("storedPath") or "").strip()
        if stored_path:
            paths.append(stored_path)
    return paths


def _enrich_with_attached_images(user_text: str, image_paths: list[str]) -> str:
    try:
        from tools.vision_tools import vision_analyze_tool
    except Exception as exc:
        hints = "\n\n".join(
            f"[The user attached an image. It is available at: {path}]"
            for path in image_paths
        )
        return f"{hints}\n\n{user_text}".strip() if hints else user_text

    prompt = (
        "Describe everything visible in this image in thorough detail. "
        "Include any text, code, data, objects, people, layout, colors, "
        "and any other notable visual information."
    )
    parts: list[str] = []
    for raw_path in image_paths:
        path = Path(raw_path)
        if not path.exists() or not path.is_file():
            continue
        hint = f"[If needed, examine it again with vision_analyze using image_url: {path}]"
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result_json = asyncio.run(
                    vision_analyze_tool(image_url=str(path), user_prompt=prompt)
                )
            result = json.loads(result_json)
            description = result.get("analysis", "") if result.get("success") else ""
            if description:
                parts.append(f"[The user attached an image:\n{description}]\n{hint}")
            else:
                parts.append(f"[The user attached an image but analysis failed.]\n{hint}")
        except Exception as exc:
            parts.append(f"[The user attached an image but analysis failed ({exc}).]\n{hint}")

    prefix = "\n\n".join(parts)
    if prefix:
        return f"{prefix}\n\n{user_text}".strip() if user_text else prefix
    return user_text


def _build_run_message(
    payload: Dict[str, Any],
    user_context: str,
    provider: str,
    model: str,
) -> Any:
    image_paths = _attachment_image_paths(payload)
    if not image_paths:
        return user_context

    try:
        from agent.image_routing import build_native_content_parts, decide_image_input_mode
        from hermes_cli.config import load_config

        mode = decide_image_input_mode(provider, model, load_config())
    except Exception as exc:
        _emit(
            {
                "type": "raw_log",
                "content": f"Image routing decision failed; using text fallback: {exc}",
                "metadata": {"folded": True},
            }
        )
        mode = "text"

    if mode == "native":
        try:
            parts, skipped = build_native_content_parts(user_context, image_paths)
            if skipped:
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Skipped {len(skipped)} unreadable attached image(s).",
                        "metadata": {"folded": True, "skippedImages": skipped},
                    }
                )
            if any(isinstance(part, dict) and part.get("type") == "image_url" for part in parts):
                _emit(
                    {
                        "type": "raw_log",
                        "content": f"Attached {len(image_paths) - len(skipped)} image(s) natively for the model.",
                        "metadata": {"folded": True, "imageInputMode": "native"},
                    }
                )
                return parts
        except Exception as exc:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Native image attachment failed; using text fallback: {exc}",
                    "metadata": {"folded": True},
                }
            )

    return _enrich_with_attached_images(user_context, image_paths)


def _tool_name(name: Any) -> str:
    text = str(name or "").strip()
    return text or "tool"


def _compact_text(value: Any, limit: int = 2000) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _merge_system_context(system_context: str, content: Any) -> str:
    text = str(content or "").strip()
    current = str(system_context or "").strip()
    if not text:
        return current
    if not current:
        return text
    if text == current:
        return current
    return f"{current}\n\n{text}"


def _context_messages_to_history(
    raw_context_messages: Any,
    system_context: str = "",
    user_context: str = "",
) -> tuple[str, str, list[Dict[str, Any]]]:
    context_messages = raw_context_messages if isinstance(raw_context_messages, list) else []
    conversation_history: list[Dict[str, Any]] = []
    if not context_messages:
        return system_context, user_context, conversation_history

    last_user_index = None
    for idx, message in enumerate(context_messages):
        if isinstance(message, dict) and message.get("role") == "user":
            last_user_index = idx
    if last_user_index is None:
        return system_context, user_context, conversation_history

    current_user = context_messages[last_user_index]
    user_context = str(current_user.get("content") or "")
    for idx, message in enumerate(context_messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        content = message.get("content")
        if role == "system":
            system_context = _merge_system_context(system_context, content)
            continue
        if idx == last_user_index:
            continue
        if role == "developer":
            system_context = _merge_system_context(system_context, content)
            continue
        if role in {"user", "assistant", "tool"}:
            entry = {"role": role, "content": content if content is not None else ""}
            if role == "tool" and message.get("tool_call_id"):
                entry["tool_call_id"] = str(message.get("tool_call_id"))
            if message.get("name"):
                entry["name"] = str(message.get("name"))
            conversation_history.append(entry)

    return system_context, user_context, conversation_history


def _approval_callback(command: str, description: str, **_kwargs: Any) -> str:
    if RISK_CONFIRMED:
        _emit(
            {
                "type": "raw_log",
                "content": "High-risk command approved by the user before this run.",
                "metadata": {
                    "approvalRequired": True,
                    "approvalGranted": True,
                    "command": command,
                    "description": description,
                    "folded": True,
                },
            }
        )
        return "once"
    _emit(
        {
            "type": "error",
            "message": "High-risk command requires explicit UI confirmation and was blocked.",
            "details": f"{description}\n\n{command}",
            "metadata": {
                "approvalRequired": True,
                "command": command,
                "description": description,
            },
        }
    )
    return "deny"


def _configure_approval_environment() -> None:
    # Redou uses a direct approval callback. The gateway HERMES_EXEC_ASK queue
    # requires a separate notify callback and would bypass the callback above.
    os.environ["HERMES_INTERACTIVE"] = "1"
    os.environ.pop("HERMES_EXEC_ASK", None)
    os.environ.pop("HERMES_GATEWAY_SESSION", None)
    os.environ.pop("HERMES_SESSION_PLATFORM", None)
    if RISK_CONFIRMED:
        os.environ["HERMES_YOLO_MODE"] = "1"


def main() -> int:
    global RISK_CONFIRMED
    turn_started_at = _utc_iso()
    turn_started_monotonic = time.monotonic()
    first_line = sys.stdin.readline()
    payload = json.loads(first_line or "{}")
    RISK_CONFIRMED = payload.get("riskConfirmed") is True
    _configure_approval_environment()
    root = _project_root()
    sys.path.insert(0, str(root))
    workspace = str(payload.get("workspacePath") or root)

    try:
        os.chdir(workspace)
    except OSError:
        os.chdir(root)

    try:
        from run_agent import AIAgent
        from hermes_cli.redou_runtime import redou_disabled_tools, redou_disabled_toolsets
        from tools.terminal_tool import set_approval_callback
    except Exception as exc:
        _emit(
            {
                "type": "error",
                "message": "Hermes runtime could not be imported.",
                "details": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
            }
        )
        _emit({"type": "done"})
        return 1

    set_approval_callback(_approval_callback)

    system_context = str(payload.get("systemContext") or "")
    user_context = str(payload.get("userContext") or "")
    system_context, user_context, conversation_history = _context_messages_to_history(
        payload.get("contextMessages"),
        system_context,
        user_context,
    )
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    session_id = str(payload.get("hermesSessionId") or "").strip() or None
    model = str(payload.get("model") or "")
    provider = str(payload.get("provider") or "")
    max_iterations = int(payload.get("maxIterations") or 40)
    direct_api_key = str(payload.get("apiKey") or payload.get("api_key") or "").strip() or None
    direct_base_url = str(payload.get("baseUrl") or payload.get("base_url") or "").strip() or None
    direct_api_mode = str(payload.get("apiMode") or payload.get("api_mode") or "").strip() or None
    api_key = direct_api_key
    base_url = direct_base_url
    api_mode = direct_api_mode
    credential_pool = None
    session_db = None
    agent_holder: Dict[str, Any] = {}
    pending_steers: list[str] = []
    pending_lock = threading.Lock()

    def control_loop() -> None:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except Exception:
                _emit(
                    {
                        "type": "raw_log",
                        "content": "Ignored malformed Redou control message.",
                        "metadata": {"folded": True, **metadata},
                    }
                )
                continue
            if not isinstance(command, dict) or command.get("type") != "steer":
                continue
            text = str(command.get("text") or "").strip()
            if not text:
                continue
            with pending_lock:
                agent = agent_holder.get("agent")
                if agent is None:
                    pending_steers.append(text)
                    accepted = True
                else:
                    accepted = bool(agent.steer(text))
            _emit(
                {
                    "type": "raw_log",
                    "content": "User guidance accepted for the active run."
                    if accepted
                    else "User guidance was empty and was ignored.",
                    "metadata": {
                        "folded": True,
                        "guided": accepted,
                        "guideId": command.get("guideId"),
                        **metadata,
                    },
                }
            )

    if provider in {"minimax", "minimax-cn"} and not model:
        model = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7").strip() or "MiniMax-M2.7"

    if provider:
        try:
            from hermes_cli.runtime_provider import resolve_runtime_provider

            runtime = resolve_runtime_provider(
                requested=provider,
                explicit_api_key=direct_api_key,
                explicit_base_url=direct_base_url,
                target_model=model or None,
            )
            provider = str(runtime.get("provider") or provider)
            api_key = direct_api_key or str(runtime.get("api_key") or "") or None
            base_url = direct_base_url or str(runtime.get("base_url") or "") or None
            api_mode = direct_api_mode or str(runtime.get("api_mode") or "") or None
            credential_pool = runtime.get("credential_pool")
            if direct_api_key or direct_base_url:
                credential_pool = None
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Resolved provider {provider} using {api_mode or 'default'} at {base_url or 'default endpoint'}.",
                    "metadata": {"folded": True, **metadata},
                }
            )
        except Exception as exc:
            _emit(
                {
                    "type": "raw_log",
                    "content": f"Provider runtime resolution fell back to direct settings: {exc}",
                    "metadata": {"folded": True, **metadata},
                }
            )

    def stream_delta(delta: str) -> None:
        if delta:
            _emit({"type": "assistant_delta", "content": delta, "metadata": metadata})

    def status_update(kind: str, value: Any = None) -> None:
        if str(kind or "") != "run_stage":
            return
        event = _run_stage_object(value)
        if event is None:
            return
        event.setdefault("taskId", str(payload.get("taskId") or ""))
        if os.getenv("REDOU_RUN_ID"):
            event.setdefault("runId", os.getenv("REDOU_RUN_ID"))
        if payload.get("projectId"):
            event.setdefault("projectId", str(payload.get("projectId")))
        if metadata.get("currentTurnId"):
            event.setdefault("turnId", str(metadata.get("currentTurnId")))
        event["metadata"] = {
            **metadata,
            **(event.get("metadata") if isinstance(event.get("metadata"), dict) else {}),
        }
        _emit(event)

    def tool_started(tool_call_id: str, name: str, args: Any) -> None:
        _emit(
            {
                "type": "tool_start",
                "name": _tool_name(name),
                "input": _safe_json(args),
                "metadata": {"toolCallId": tool_call_id, **metadata},
            }
        )

    def tool_completed(tool_call_id: str, name: str, args: Any, result: Any) -> None:
        _emit(
            {
                "type": "tool_output",
                "name": _tool_name(name),
                "output": _safe_json(result),
                "metadata": {"toolCallId": tool_call_id, "input": _safe_json(args), **metadata},
            }
        )
        _emit(
            {
                "type": "tool_end",
                "name": _tool_name(name),
                "success": True,
                "metadata": {"toolCallId": tool_call_id, **metadata},
            }
        )

    last_reasoning_preview = ""

    def tool_progress(event_type: str, name: Any = None, preview: Any = None, args: Any = None, **kwargs: Any) -> None:
        nonlocal last_reasoning_preview
        if event_type in {"_thinking", "reasoning.available"} or _tool_name(name) == "_thinking":
            text = preview if preview is not None else name if event_type == "_thinking" else ""
            if text:
                last_reasoning_preview = _compact_text(text)
            return
        if event_type == "tool.started":
            _emit(
                {
                    "type": "tool_start",
                    "name": _tool_name(name),
                    "input": _safe_json(args),
                    "metadata": {"preview": str(preview or ""), **metadata},
                }
            )
            return
        if preview:
            _emit(
                {
                    "type": "tool_output",
                    "name": _tool_name(name),
                    "output": str(preview),
                    "metadata": {"eventType": event_type, **metadata, **kwargs},
                }
            )

    try:
        from hermes_state import SessionDB

        session_db = SessionDB()
    except Exception as exc:
        _emit(
            {
                "type": "raw_log",
                "content": f"Session usage persistence is unavailable; analytics will use Redou logs for this run: {exc}",
                "metadata": {"folded": True, **metadata},
            }
        )

    def close_session_db() -> None:
        if session_db is None:
            return
        try:
            session_db.close()
        except Exception:
            pass

    try:
        agent = AIAgent(
            api_key=api_key,
            base_url=base_url,
            provider=provider or None,
            api_mode=api_mode,
            model=model,
            max_iterations=max_iterations,
            quiet_mode=True,
            disabled_toolsets=redou_disabled_toolsets(),
            disabled_tools=redou_disabled_tools(),
            skip_context_files=True,
            skip_memory=True,
            credential_pool=credential_pool,
            ephemeral_system_prompt=system_context,
            platform="redou",
            session_id=session_id,
            session_db=session_db,
            tool_progress_callback=tool_progress,
            tool_start_callback=tool_started,
            tool_complete_callback=tool_completed,
            status_callback=status_update,
            pass_session_id=True,
        )
        with pending_lock:
            agent_holder["agent"] = agent
            early_steers = list(pending_steers)
            pending_steers.clear()
        for steer_text in early_steers:
            agent.steer(steer_text)
        threading.Thread(target=control_loop, daemon=True).start()
        run_message = _build_run_message(payload, user_context, provider, model)
        with contextlib.redirect_stdout(sys.stderr):
            result = agent.run_conversation(
                run_message,
                conversation_history=conversation_history or None,
                stream_callback=stream_delta,
                persist_user_message=user_context if not isinstance(run_message, str) else None,
            )
        final_response = _strip_run_stage_json_lines(
            str((result or {}).get("final_response") or "").strip()
        )
        if not final_response and last_reasoning_preview:
            final_response = last_reasoning_preview
        if final_response:
            _emit(
                {
                    "type": "assistant_message",
                    "content": final_response,
                    "metadata": {
                        **metadata,
                        **_turn_timing_metadata(turn_started_at, turn_started_monotonic),
                        "hermesSessionId": getattr(agent, "session_id", session_id),
                        "apiCalls": (result or {}).get("api_calls"),
                        "inputTokens": (result or {}).get("input_tokens"),
                        "outputTokens": (result or {}).get("output_tokens"),
                        "cacheReadTokens": (result or {}).get("cache_read_tokens"),
                        "cacheWriteTokens": (result or {}).get("cache_write_tokens"),
                        "reasoningTokens": (result or {}).get("reasoning_tokens"),
                        "estimatedCostUsd": (result or {}).get("estimated_cost_usd"),
                        "costStatus": (result or {}).get("cost_status"),
                        "costSource": (result or {}).get("cost_source"),
                    },
                }
            )
        elif (result or {}).get("failed") or (result or {}).get("error"):
            _emit(
                {
                    "type": "run_stage",
                    "stage": "failed",
                    "label": "失败",
                    "status": "failed",
                    "source": "hermes",
                    "timestamp": _utc_iso(),
                    "details": _compact_text((result or {}).get("error") or "Hermes runtime failed."),
                    "metadata": metadata,
                }
            )
            _emit(
                {
                    "type": "error",
                    "message": _compact_text((result or {}).get("error") or "Hermes runtime failed."),
                    "metadata": {
                        **metadata,
                        "hermesSessionId": getattr(agent, "session_id", session_id),
                        "apiCalls": (result or {}).get("api_calls"),
                        "provider": provider,
                        "model": model,
                    },
                }
            )
        _emit(
            {
                "type": "done",
                "metadata": {
                    **metadata,
                    **_turn_timing_metadata(turn_started_at, turn_started_monotonic),
                    "hermesSessionId": getattr(agent, "session_id", session_id),
                    "completed": (result or {}).get("completed"),
                    "apiCalls": (result or {}).get("api_calls"),
                    "inputTokens": (result or {}).get("input_tokens"),
                    "outputTokens": (result or {}).get("output_tokens"),
                    "cacheReadTokens": (result or {}).get("cache_read_tokens"),
                    "cacheWriteTokens": (result or {}).get("cache_write_tokens"),
                    "reasoningTokens": (result or {}).get("reasoning_tokens"),
                    "estimatedCostUsd": (result or {}).get("estimated_cost_usd"),
                    "costStatus": (result or {}).get("cost_status"),
                    "costSource": (result or {}).get("cost_source"),
                    **(
                        {"pendingSteer": (result or {}).get("pending_steer")}
                        if (result or {}).get("pending_steer")
                        else {}
                    ),
                },
            }
        )
        close_session_db()
        return 0
    except Exception as exc:
        _emit(
            {
                "type": "run_stage",
                "stage": "failed",
                "label": "失败",
                "status": "failed",
                "source": "hermes",
                "timestamp": _utc_iso(),
                "details": str(exc),
                "metadata": metadata,
            }
        )
        _emit(
            {
                "type": "error",
                "message": str(exc),
                "details": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:],
                "metadata": metadata,
            }
        )
        _emit(
            {
                "type": "done",
                "metadata": {
                    **metadata,
                    **_turn_timing_metadata(turn_started_at, turn_started_monotonic),
                },
            }
        )
        close_session_db()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
