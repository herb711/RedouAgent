#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/chinese-agent-product-research.md"
SOURCES="/workspace/logs/chinese-agent-product-sources.md"
NOTES="/workspace/logs/chinese-agent-product-notes.md"
COMMANDS="/workspace/logs/chinese-agent-product-commands.log"

echo "[Task4 Phase 5] Checking delivery files..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'
  test -f '$SOURCES'
  test -f '$NOTES'
  test -f '$COMMANDS'
  test -s '$REPORT'
  test -s '$SOURCES'
  test -s '$NOTES'
  test -s '$COMMANDS'
"

echo "[Task4 Phase 5] Checking command log contains container verification..."

docker compose exec "$SERVICE" bash -lc "
  grep -q '/workspace/reports/chinese-agent-product-research.md' '$COMMANDS' || {
    echo 'Command log should mention final report path.'
    exit 1
  }

  grep -Eqi 'ls -lh|^-rw|chinese-agent-product-research.md' '$COMMANDS' || {
    echo 'Command log should contain ls -lh verification output.'
    exit 1
  }

  ls -lh '$REPORT'
"

echo "[Task4 Phase 5] PASS"
