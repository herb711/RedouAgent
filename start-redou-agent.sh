#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$ROOT/apps/desktop"
BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      BUILD=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash start-redou-agent.sh [--build]

Starts Redou Agent from source on Linux. Use --build to create Linux desktop packages.
For the friendly shortcut, run: bash "Launch Redou Agent.sh"
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

command_path() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    command -v "$command_name"
  fi
}

python_supported() {
  local python_path="$1"
  "$python_path" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1
}

resolve_python() {
  local candidates=()
  if [[ -n "${REDOU_PYTHON:-}" ]]; then
    candidates+=("$REDOU_PYTHON")
  fi
  candidates+=("python3.12" "python3.11" "python3" "python")

  local candidate resolved
  for candidate in "${candidates[@]}"; do
    if [[ "$candidate" == */* ]]; then
      [[ -x "$candidate" ]] || continue
      resolved="$candidate"
    else
      resolved="$(command_path "$candidate" || true)"
      [[ -n "$resolved" ]] || continue
    fi
    if python_supported "$resolved"; then
      printf '%s\n' "$resolved"
      return 0
    fi
  done

  echo "Python 3.11 or newer was not found. Run bash install-redou-agent.sh --check-only for details." >&2
  exit 1
}

configure_linux_desktop_session() {
  if [[ "$(uname -s)" != "Linux" || -n "${DISPLAY:-}" ]]; then
    return 0
  fi

  local display_number uid x_socket xauth_path
  for x_socket in /tmp/.X11-unix/X*; do
    [[ -S "$x_socket" ]] || continue
    display_number="${x_socket##*/X}"
    export DISPLAY=":$display_number"
    break
  done

  [[ -n "${DISPLAY:-}" ]] || return 0
  if [[ -n "${XAUTHORITY:-}" && -r "$XAUTHORITY" ]]; then
    return 0
  fi

  uid="$(id -u)"
  for xauth_path in \
    "${XDG_RUNTIME_DIR:-}/gdm/Xauthority" \
    "/run/user/$uid/gdm/Xauthority" \
    "$HOME/.Xauthority"; do
    [[ -r "$xauth_path" ]] || continue
    export XAUTHORITY="$xauth_path"
    return 0
  done
}

electron_start_args() {
  if [[ "$(uname -s)" == "Linux" && -z "${REDOU_ENABLE_GPU:-}" ]]; then
    printf '%s\n' "--disable-gpu"
  fi
  if [[ "$(uname -s)" == "Linux" && -z "${REDOU_ENABLE_SANDBOX:-}" ]]; then
    printf '%s\n' "--no-sandbox"
  fi
}

NPM="$(command_path npm || true)"
if [[ -z "$NPM" ]]; then
  echo "npm was not found. Run bash install-redou-agent.sh first." >&2
  exit 1
fi

PYTHON="$(resolve_python)"
export REDOU_PYTHON="$PYTHON"

if [[ "$BUILD" -eq 1 ]]; then
  exec "$NPM" --prefix "$DESKTOP_DIR" run build:linux
fi

if [[ ! -x "$DESKTOP_DIR/node_modules/electron/dist/electron" ]]; then
  echo "Desktop dependencies are not installed. Run bash install-redou-agent.sh first." >&2
  exit 1
fi

configure_linux_desktop_session

mapfile -t ELECTRON_ARGS < <(electron_start_args)
if [[ "${#ELECTRON_ARGS[@]}" -gt 0 ]]; then
  exec "$NPM" --prefix "$DESKTOP_DIR" start -- "${ELECTRON_ARGS[@]}"
fi

exec "$NPM" --prefix "$DESKTOP_DIR" start
