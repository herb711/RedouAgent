"""Redou project/task context and app-data helpers.

This module stays independent from ``hermes_cli.web_server`` so the dashboard
server and the TUI gateway child can share the same Project/Task context rules.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from hermes_constants import get_hermes_home

LOGGER = logging.getLogger(__name__)

REDOU_APP_DATA_ENV = "REDOU_APP_DATA_ROOT"
REDOU_CHAT_PROJECTS_FILE_ENV = "REDOU_CHAT_PROJECTS_FILE"

GLOBAL_USER_FILE = "USER.md"
GLOBAL_RULES_FILE = "GLOBAL_RULES.md"
GLOBAL_MEMORY_FILE = "GLOBAL_MEMORY.md"
PROJECT_RULES_FILE = "PROJECT_RULES.md"
PROJECT_MEMORY_FILE = "PROJECT_MEMORY.md"
TASK_RULES_FILE = "TASK_RULES.md"
TASK_SUMMARY_FILE = "SUMMARY.md"
TASK_MESSAGES_FILE = "messages.jsonl"

RECENT_MESSAGE_LIMIT = 20
RECENT_MESSAGE_CONTENT_LIMIT = 4000
VALID_MESSAGE_ROLES = frozenset({"user", "assistant", "system", "tool"})

_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._-]+")
_SECRETISH_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization)=([^ \r\n\t]+)"
)


@dataclass
class BuiltTaskContext:
    text: str
    files: List[str]
    recent_messages_count: int
    context_length: int
    hermes_profile: str


def _now() -> float:
    return time.time()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_segment(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    clean = _SAFE_SEGMENT_RE.sub("-", raw).strip(".-_")
    return (clean[:96] or fallback).lower()


def _compact(value: Any, max_len: int = 300) -> str:
    text = " ".join(str(value or "").split())
    return text[:max_len]


def _redact_preview(text: str, max_len: int = 400) -> str:
    redacted = _SECRETISH_RE.sub(r"\1=***", text or "")
    redacted = redacted.replace("\r", " ").replace("\n", " ")
    return redacted[:max_len]


def get_redou_app_data_root() -> Path:
    raw = os.environ.get(REDOU_APP_DATA_ENV)
    if raw:
        return Path(raw).expanduser().resolve(strict=False)
    return Path(get_hermes_home()) / "app-data"


def get_redou_chat_projects_file() -> Path:
    raw = os.environ.get(REDOU_CHAT_PROJECTS_FILE_ENV)
    if raw:
        return Path(raw).expanduser().resolve(strict=False)
    return Path(get_hermes_home()) / "chat-projects.json"


def get_global_app_data_dir() -> Path:
    return get_redou_app_data_root() / "global"


def get_project_app_data_dir(project_id: str) -> Path:
    return get_redou_app_data_root() / "projects" / _safe_segment(project_id, "project")


def get_task_app_data_dir(project_id: str, task_id: str) -> Path:
    return get_project_app_data_dir(project_id) / "tasks" / _safe_segment(task_id, "task")


def _ensure_text_file(path: Path, default_text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(default_text, encoding="utf-8")


def _ensure_empty_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    except Exception as exc:
        LOGGER.warning("redou context: failed to read %s: %s", path, exc)
        return ""


def ensure_global_app_data() -> Dict[str, str]:
    root = get_global_app_data_dir()
    paths = {
        "userPath": root / GLOBAL_USER_FILE,
        "globalRulesPath": root / GLOBAL_RULES_FILE,
        "globalMemoryPath": root / GLOBAL_MEMORY_FILE,
    }
    _ensure_text_file(paths["userPath"], "# User Preferences\n\n")
    _ensure_text_file(paths["globalRulesPath"], "# Global Rules\n\n")
    _ensure_text_file(paths["globalMemoryPath"], "# Global Memory\n\n")
    return {key: str(value) for key, value in paths.items()}


def ensure_project_app_data(project: Dict[str, Any]) -> Dict[str, str]:
    ensure_global_app_data()
    project_id = str(project.get("id") or "")
    root = get_project_app_data_dir(project_id)
    rules_path = root / PROJECT_RULES_FILE
    memory_path = root / PROJECT_MEMORY_FILE
    _ensure_text_file(rules_path, "# Project Rules\n\n")
    _ensure_text_file(memory_path, "# Project Memory\n\n")
    project["appDataPath"] = str(root)
    project["rulesPath"] = str(rules_path)
    project["memoryPath"] = str(memory_path)
    return {
        "appDataPath": str(root),
        "rulesPath": str(rules_path),
        "memoryPath": str(memory_path),
    }


def ensure_task_app_data(project: Dict[str, Any], task: Dict[str, Any]) -> Dict[str, str]:
    project_id = str(project.get("id") or "")
    task_id = str(task.get("id") or "")
    root = get_task_app_data_dir(project_id, task_id)
    rules_path = root / TASK_RULES_FILE
    summary_path = root / TASK_SUMMARY_FILE
    messages_path = root / TASK_MESSAGES_FILE
    _ensure_text_file(rules_path, "# Task Rules\n\n")
    _ensure_text_file(summary_path, "# Task Summary\n\n")
    _ensure_empty_file(messages_path)
    task["appDataPath"] = str(root)
    task["rulesPath"] = str(rules_path)
    task["summaryPath"] = str(summary_path)
    task["messagesPath"] = str(messages_path)
    session_id = _compact(task.get("hermesSessionId") or task.get("session_id"), 160)
    task["hermesSessionId"] = session_id or None
    task["session_id"] = session_id or None
    return {
        "appDataPath": str(root),
        "rulesPath": str(rules_path),
        "summaryPath": str(summary_path),
        "messagesPath": str(messages_path),
    }


def desired_project_profile_name(project: Dict[str, Any]) -> str:
    project_id = _safe_segment(project.get("id"), "project")
    name = f"redou-{project_id}".replace(".", "-")
    if not re.match(r"^[a-z0-9]", name):
        name = f"redou-{name}"
    return name[:64].rstrip("_-") or "redou-project"


def _profile_exists(name: str) -> bool:
    try:
        from hermes_cli.profiles import profile_exists

        return bool(profile_exists(name))
    except Exception:
        return False


def resolve_hermes_profile_home(name: str) -> Optional[Path]:
    try:
        from hermes_cli.profiles import resolve_profile_env

        return Path(resolve_profile_env(name)).resolve(strict=False)
    except Exception as exc:
        LOGGER.warning("redou profile: cannot resolve profile %s: %s", name, exc)
        return None


def _run_profile_create_cli(name: str) -> Optional[str]:
    cmd = [
        sys.executable,
        "-m",
        "hermes_cli.main",
        "profile",
        "create",
        name,
        "--no-alias",
        "--no-skills",
    ]
    env = os.environ.copy()
    env["HERMES_HOME"] = str(Path(get_hermes_home()).resolve(strict=False))
    try:
        result = subprocess.run(
            cmd,
            cwd=str(Path(__file__).resolve().parent.parent),
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except Exception as exc:
        return f"{type(exc).__name__}: {_redact_preview(str(exc))}"
    if result.returncode == 0:
        return None
    combined = "\n".join(part for part in (result.stdout, result.stderr) if part)
    return f"exit {result.returncode}: {_redact_preview(combined)}"


def _create_profile_internal(name: str) -> Optional[str]:
    try:
        from hermes_cli.profiles import create_profile

        create_profile(name, no_alias=True, no_skills=True)
        return None
    except FileExistsError:
        return None
    except Exception as exc:
        return f"{type(exc).__name__}: {_redact_preview(str(exc))}"


def ensure_project_hermes_profile(project: Dict[str, Any]) -> str:
    existing = _compact(project.get("hermesProfile"), 80)
    if existing and _profile_exists(existing):
        project["hermesProfile"] = existing
        project.pop("hermesProfileWarning", None)
        return existing

    desired = existing if existing and existing != "default" else desired_project_profile_name(project)
    if _profile_exists(desired):
        project["hermesProfile"] = desired
        project.pop("hermesProfileWarning", None)
        return desired

    cli_error = _run_profile_create_cli(desired)
    if cli_error is None and _profile_exists(desired):
        project["hermesProfile"] = desired
        project.pop("hermesProfileWarning", None)
        return desired

    if cli_error:
        LOGGER.warning(
            "redou profile: Hermes CLI failed for projectId=%s profile=%s: %s",
            project.get("id"),
            desired,
            cli_error,
        )

    internal_error = _create_profile_internal(desired)
    if internal_error is None and _profile_exists(desired):
        project["hermesProfile"] = desired
        project["hermesProfileWarning"] = (
            "Hermes CLI profile creation failed; used internal fallback."
        )
        return desired

    warning = (
        "Hermes profile creation failed; using default profile fallback."
        if not internal_error
        else f"Hermes profile creation failed; using default fallback: {internal_error}"
    )
    LOGGER.warning(
        "redou profile: fallback to default for projectId=%s desired=%s: %s",
        project.get("id"),
        desired,
        _redact_preview(warning),
    )
    project["hermesProfile"] = "default"
    project["hermesProfileWarning"] = warning
    return "default"


def _load_projects_store() -> Dict[str, Any]:
    path = get_redou_chat_projects_file()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {"projects": []}
    except FileNotFoundError:
        return {"projects": []}
    except Exception as exc:
        LOGGER.warning("redou context: failed to read projects store %s: %s", path, exc)
        return {"projects": []}


def _write_projects_store(store: Dict[str, Any]) -> bool:
    path = get_redou_chat_projects_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        return True
    except Exception as exc:
        LOGGER.warning("redou context: failed to write projects store %s: %s", path, exc)
        return False


def _find_project_and_task(
    project_id: str,
    task_id: str,
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    store = _load_projects_store()
    for project in store.get("projects", []) or []:
        if not isinstance(project, dict) or project.get("id") != project_id:
            continue
        for task in project.get("tasks", []) or []:
            if isinstance(task, dict) and task.get("id") == task_id:
                ensure_project_app_data(project)
                ensure_task_app_data(project, task)
                return project, task
        ensure_project_app_data(project)
        return project, None
    return None, None


def set_task_hermes_session_id(
    project_id: str,
    task_id: str,
    hermes_session_id: Optional[str],
) -> bool:
    session_id = _compact(hermes_session_id, 160)
    if not project_id or not task_id or not session_id:
        return False
    store = _load_projects_store()
    changed = False
    for project in store.get("projects", []) or []:
        if not isinstance(project, dict) or project.get("id") != project_id:
            continue
        for task in project.get("tasks", []) or []:
            if not isinstance(task, dict) or task.get("id") != task_id:
                continue
            if task.get("hermesSessionId") == session_id and task.get("session_id") == session_id:
                return True
            task["hermesSessionId"] = session_id
            task["session_id"] = session_id
            now = _now()
            task["updated_at"] = now
            project["updated_at"] = now
            changed = True
            break
        break
    if not changed:
        LOGGER.warning(
            "redou messages: cannot persist hermes session projectId=%s taskId=%s",
            project_id,
            task_id,
        )
        return False
    ok = _write_projects_store(store)
    if ok:
        LOGGER.debug(
            "redou task session persisted projectId=%s taskId=%s hermesSessionId=%s",
            project_id,
            task_id,
            session_id,
        )
    return ok


def _created_at_from_value(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    except Exception:
        pass
    return _iso_now()


def _normalise_message_record(
    raw: Dict[str, Any],
    *,
    project_id: str = "",
    task_id: str = "",
) -> Dict[str, Any]:
    role = _compact(raw.get("role"), 32).lower()
    if role not in VALID_MESSAGE_ROLES:
        role = "system"
    metadata = raw.get("metadata")
    metadata = dict(metadata) if isinstance(metadata, dict) else {}
    if project_id:
        metadata.setdefault("projectId", project_id)
    if task_id:
        metadata.setdefault("taskId", task_id)
    for legacy_key in (
        "projectId",
        "taskId",
        "hermesSessionId",
        "status",
        "name",
        "context",
        "toolCallId",
    ):
        if legacy_key in raw and raw.get(legacy_key) is not None:
            metadata.setdefault(legacy_key, raw.get(legacy_key))
    content = raw.get("content")
    if content is None:
        content = raw.get("text")
    return {
        "role": role,
        "content": "" if content is None else str(content),
        "createdAt": _created_at_from_value(raw.get("createdAt") or raw.get("timestamp")),
        "metadata": metadata,
    }


def load_messages_file(
    path: Path,
    *,
    project_id: str = "",
    task_id: str = "",
) -> tuple[List[Dict[str, Any]], List[str]]:
    rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
        return rows, warnings
    try:
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                warning = f"invalid JSONL line {line_no}: {exc.msg}"
                warnings.append(warning)
                LOGGER.warning("redou messages: %s in %s", warning, path)
                continue
            if not isinstance(item, dict):
                warning = f"skipped non-object JSONL line {line_no}"
                warnings.append(warning)
                LOGGER.warning("redou messages: %s in %s", warning, path)
                continue
            rows.append(
                _normalise_message_record(
                    item,
                    project_id=project_id,
                    task_id=task_id,
                )
            )
    except Exception as exc:
        warning = f"failed to read messages: {type(exc).__name__}"
        warnings.append(warning)
        LOGGER.warning("redou messages: failed to read %s: %s", path, exc)
    return rows, warnings


def load_task_messages(project_id: str, task_id: str) -> Dict[str, Any]:
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        LOGGER.warning(
            "redou task open: missing project/task projectId=%s taskId=%s",
            project_id,
            task_id,
        )
        return {
            "projectId": project_id,
            "taskId": task_id,
            "messagesPath": "",
            "hermesSessionId": "",
            "messages": [],
            "warnings": ["Project or task metadata was not found."],
        }
    ensure_project_app_data(project)
    ensure_task_app_data(project, task)
    messages_path = Path(str(task.get("messagesPath") or ""))
    messages, warnings = load_messages_file(
        messages_path,
        project_id=project_id,
        task_id=task_id,
    )
    hermes_session_id = str(task.get("hermesSessionId") or task.get("session_id") or "")
    LOGGER.debug(
        "redou task open projectId=%s taskId=%s messagesPath=%s loadedMessages=%s hermesSessionId=%s",
        project_id,
        task_id,
        messages_path,
        len(messages),
        hermes_session_id,
    )
    return {
        "projectId": project_id,
        "taskId": task_id,
        "messagesPath": str(messages_path),
        "hermesSessionId": hermes_session_id,
        "messages": messages,
        "warnings": warnings,
    }


def task_messages_to_transcript_rows(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in messages:
        role = _compact(item.get("role"), 32).lower()
        if role not in VALID_MESSAGE_ROLES:
            continue
        content = str(item.get("content") or "")
        if not content.strip() and role != "tool":
            continue
        row: Dict[str, Any] = {"role": role, "text": content}
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            if metadata.get("name"):
                row["name"] = str(metadata.get("name"))
            if metadata.get("context"):
                row["context"] = str(metadata.get("context"))
        rows.append(row)
    return rows


def _load_recent_messages(path: Path, limit: int = RECENT_MESSAGE_LIMIT) -> List[Dict[str, Any]]:
    rows, _warnings = load_messages_file(path)
    return rows[-limit:]


def _render_recent_messages(messages: List[Dict[str, Any]]) -> str:
    rendered: List[str] = []
    for item in messages:
        role = _compact(item.get("role"), 32) or "message"
        content = str(item.get("content") or "")
        if len(content) > RECENT_MESSAGE_CONTENT_LIMIT:
            content = content[:RECENT_MESSAGE_CONTENT_LIMIT] + "\n[truncated]"
        rendered.append(f"{role}: {content}".rstrip())
    return "\n\n".join(rendered)


def _section(title: str, content: str) -> str:
    body = content.strip()
    if not body:
        body = "(empty)"
    return f"## {title}\n\n{body}"


def build_task_context(project_id: str, task_id: str, user_input: str) -> BuiltTaskContext:
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        text = "\n\n".join(
            [
                "# Redou Task Context",
                _section("Context Warning", "Project or task metadata was not found."),
                _section("Current User Request", user_input),
            ]
        )
        LOGGER.warning(
            "redou context: missing project/task projectId=%s taskId=%s contextLength=%s",
            project_id,
            task_id,
            len(text),
        )
        return BuiltTaskContext(text, [], 0, len(text), "")

    global_paths = ensure_global_app_data()
    ensure_project_app_data(project)
    ensure_task_app_data(project, task)

    files = [
        global_paths["globalRulesPath"],
        global_paths["userPath"],
        global_paths["globalMemoryPath"],
        str(project.get("rulesPath") or ""),
        str(project.get("memoryPath") or ""),
        str(task.get("rulesPath") or ""),
        str(task.get("summaryPath") or ""),
        str(task.get("messagesPath") or ""),
    ]
    messages = _load_recent_messages(Path(str(task.get("messagesPath") or "")))
    sections = [
        "# Redou Task Context",
        _section("Global Rules", _read_text(Path(global_paths["globalRulesPath"]))),
        _section("User Preferences", _read_text(Path(global_paths["userPath"]))),
        _section("Global Memory", _read_text(Path(global_paths["globalMemoryPath"]))),
        _section("Project Rules", _read_text(Path(str(project.get("rulesPath"))))),
        _section("Project Memory", _read_text(Path(str(project.get("memoryPath"))))),
        _section("Task Rules", _read_text(Path(str(task.get("rulesPath"))))),
        _section("Task Summary", _read_text(Path(str(task.get("summaryPath"))))),
        _section("Recent Task Messages", _render_recent_messages(messages)),
        _section("Current User Request", user_input),
    ]
    text = "\n\n".join(sections)
    hermes_profile = str(project.get("hermesProfile") or os.environ.get("REDOU_HERMES_PROFILE") or "")
    included_files = [path for path in files if path]
    LOGGER.debug(
        "redou context built projectId=%s taskId=%s hermesProfile=%s files=%s recentMessages=%s contextLength=%s",
        project_id,
        task_id,
        hermes_profile,
        included_files,
        len(messages),
        len(text),
    )
    return BuiltTaskContext(text, included_files, len(messages), len(text), hermes_profile)


def append_task_message(
    project_id: str,
    task_id: str,
    role: str,
    content: Any,
    *,
    hermes_session_id: Optional[str] = None,
    status: Optional[str] = None,
) -> bool:
    project, task = _find_project_and_task(project_id, task_id)
    if project is None or task is None:
        LOGGER.warning(
            "redou messages: missing project/task projectId=%s taskId=%s role=%s",
            project_id,
            task_id,
            role,
        )
        return False
    path = Path(str(task.get("messagesPath") or ""))
    if not path:
        return False
    role_name = _compact(role, 32).lower()
    if role_name not in VALID_MESSAGE_ROLES:
        role_name = "system"
    session_id = (
        _compact(hermes_session_id, 160)
        or _compact(task.get("hermesSessionId") or task.get("session_id"), 160)
        or ""
    )
    metadata: Dict[str, Any] = {
        "projectId": project_id,
        "taskId": task_id,
    }
    if session_id:
        metadata["hermesSessionId"] = session_id
    if status:
        metadata["status"] = _compact(status, 64)
    payload: Dict[str, Any] = {
        "role": role_name,
        "content": str(content or ""),
        "createdAt": _iso_now(),
        "metadata": metadata,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        if session_id:
            set_task_hermes_session_id(project_id, task_id, session_id)
        LOGGER.debug(
            "redou messages appended projectId=%s taskId=%s messagesPath=%s role=%s contentLength=%s hermesSessionId=%s",
            project_id,
            task_id,
            path,
            role_name,
            len(payload["content"]),
            session_id,
        )
        return True
    except Exception as exc:
        LOGGER.warning("redou messages: failed to append %s: %s", path, exc)
        return False
