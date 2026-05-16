#!/usr/bin/env python3
"""Redou source smoke test.

This suite intentionally avoids network installs and generated bundles. It checks
that the slim source layout is coherent, that Redou desktop code can load, and
that Hermes-owned prompt/runtime helpers still pass their focused regressions.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import signal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERMES = ROOT / "vendor" / "hermes"


def run(label: str, args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, timeout: int = 180) -> None:
    print(f"\n==> {label}", flush=True)
    print("$ " + " ".join(args), flush=True)
    merged_env = os.environ.copy()
    merged_env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    if env:
        merged_env.update(env)

    output_file = tempfile.NamedTemporaryFile("w+b", delete=False)
    output_path = Path(output_file.name)
    proc: subprocess.Popen[bytes] | None = None
    try:
        try:
            proc = subprocess.Popen(
                args,
                cwd=str(cwd or ROOT),
                env=merged_env,
                stdout=output_file,
                stderr=subprocess.STDOUT,
                start_new_session=(os.name != "nt"),
            )
            returncode = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            if proc is not None:
                _terminate_process_group(proc)
            raise SystemExit(f"{label} timed out after {timeout}s") from exc
        finally:
            if proc is not None:
                _terminate_process_group(proc)
            output_file.close()

        output = output_path.read_text(encoding="utf-8", errors="replace")
        if output.strip():
            print(output.rstrip(), flush=True)
        if returncode != 0:
            raise SystemExit(f"{label} failed with exit code {returncode}")
    finally:
        try:
            output_path.unlink()
        except OSError:
            pass


def _terminate_process_group(proc: subprocess.Popen[bytes]) -> None:
    if os.name == "nt":
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        return


def with_process_timeout(args: list[str], seconds: int) -> list[str]:
    timeout_bin = shutil.which("timeout")
    if timeout_bin:
        return [timeout_bin, str(seconds), *args]
    return args


def cleanup_test_debris() -> None:
    for path in ROOT.rglob("__pycache__"):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    for path in ROOT.rglob(".pytest_cache"):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    for path in ROOT.rglob("*.pyc"):
        try:
            path.unlink()
        except OSError:
            pass



def assert_path_contract() -> None:
    service = ROOT / "apps" / "desktop" / "src" / "services" / "redouLocalService.cjs"
    packager = HERMES / "hermes_cli" / "redou_task_skill_packager.py"
    docs = ROOT / "docs" / "architecture" / "source-and-generated-paths.md"
    readme = ROOT / "README.md"
    for required in [service, packager, docs, readme]:
        if not required.exists():
            raise SystemExit(f"required path contract file is missing: {required.relative_to(ROOT)}")

    service_text = service.read_text(encoding="utf-8")
    packager_text = packager.read_text(encoding="utf-8")
    docs_text = docs.read_text(encoding="utf-8")
    readme_text = readme.read_text(encoding="utf-8")

    required_snippets = [
        "projectHermesHome(project) {\n    return this.projectContextDir(project);",
        "projectSkillsDir(project)",
        "REDOU_PROJECT_SKILLS_DIR: this.projectSkillsDir(project)",
        "targetSkillsDir: this.projectSkillsDir(project)",
        "const promptDir = path.join(workspace, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, \"prompts\");",
    ]
    missing = [snippet for snippet in required_snippets if snippet not in service_text]
    if missing:
        raise SystemExit("path contract snippets are missing from redouLocalService.cjs:\n" + "\n".join(missing))

    if "targetSkillsDir" not in packager_text or "REDOU_PROJECT_SKILLS_DIR" not in packager_text:
        raise SystemExit("Hermes task skill packager must validate/use the project skill target path")
    if "<workspace>/.redou/skills/task-packages/" not in docs_text:
        raise SystemExit("source/generated path doc must describe project skill output paths")
    if "docs/architecture/source-and-generated-paths.md" not in readme_text:
        raise SystemExit("README must link to the runtime data path contract")

    scanned_files = [service, ROOT / "README.md"]
    for path in scanned_files:
        text = path.read_text(encoding="utf-8")
        if ".redou-analysis" in text:
            raise SystemExit(f"legacy .redou-analysis path remains in {path.relative_to(ROOT)}")
    print("path contract audit passed")


def assert_absent(paths: list[str]) -> None:
    missing = []
    for rel in paths:
        if (ROOT / rel).exists():
            missing.append(rel)
    if missing:
        raise SystemExit("Legacy compatibility files should be removed:\n" + "\n".join(f"  {item}" for item in missing))
    print("legacy root compatibility files are absent")


def main() -> int:
    cleanup_test_debris()
    assert_absent([
        "sitecustomize.py",
        "pyproject.toml",
        "hermes",
        "run_agent.py",
        "cli.py",
        "mcp_serve.py",
        "batch_runner.py",
        "rl_cli.py",
        "mini_swe_runner.py",
    ])
    assert_path_contract()

    py_files = [
        "apps/desktop/src/dashboard_bridge.py",
        "apps/desktop/src/hermes_adapter.py",
        "apps/desktop/src/redou_context_compactor.py",
        "vendor/hermes/hermes_cli/busy_input.py",
        "vendor/hermes/hermes_cli/redou_context.py",
        "vendor/hermes/hermes_cli/redou_task_skill_packager.py",
        "vendor/hermes/hermes_cli/skill_manage_bridge.py",
    ]
    compile_probe = """from pathlib import Path\nimport sys\nfor rel in sys.argv[1:]:\n    path = Path(rel)\n    compile(path.read_text(encoding='utf-8'), str(path), 'exec')\nprint(f'compiled {len(sys.argv) - 1} python files')\n"""
    run("Python syntax compile", [sys.executable, "-c", compile_probe, *py_files])

    node = shutil.which("node")
    if node:
        run("Desktop service syntax", [node, "--check", "apps/desktop/src/services/redouLocalService.cjs"])
        run("Desktop task skill client syntax", [node, "--check", "apps/desktop/src/services/redouTaskSkillClient.cjs"])
        run("Desktop main syntax", [node, "--check", "apps/desktop/src/main.cjs"])
        desktop_tests = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "apps" / "desktop" / "tests").glob("*.test.cjs"))
        run("Desktop unit tests", [node, "--test", "--test-force-exit", "--test-reporter=dot", *desktop_tests], timeout=120)
    else:
        print("node not found; skipped desktop JavaScript smoke tests")

    py_env = {"PYTHONPATH": str(HERMES) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    run(
        "Hermes Redou context contract tests",
        with_process_timeout([sys.executable, "-m", "pytest", "-q", "-o", "addopts=", "vendor/hermes/tests/hermes_cli/test_redou_context_contract.py"], 60),
        env=py_env,
        timeout=90,
    )
    run(
        "Hermes gateway restart-drain smoke tests",
        with_process_timeout([sys.executable, "-m", "pytest", "-q", "-o", "addopts=", "vendor/hermes/tests/gateway/test_restart_drain.py"], 90),
        env=py_env,
        timeout=120,
    )
    run(
        "Hermes TUI gateway selected smoke tests",
        with_process_timeout([
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-o",
            "addopts=",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_dispatch_rejects_non_object_request",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_prompt_submit_expands_context_refs",
            "vendor/hermes/tests/test_tui_gateway_server.py::test_startup_runtime_resolves_short_alias_without_network",
        ], 90),
        env=py_env,
        timeout=120,
    )
    run("Path contract check", [sys.executable, "scripts/check-path-contract.py"])
    cleanup_test_debris()
    run("Generated/debris check", [sys.executable, "scripts/check-generated-dirty.py"])
    print("\nSmoke test completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
