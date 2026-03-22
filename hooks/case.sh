#!/usr/bin/env bash
# case.sh — OpenClaw error hook (on agent:error)
# Logs the failure as an immutable Case in archive_memory.
#
# Wire in openclaw.json:
#   "hooks": { "onError": ["bash /path/to/case.sh"] }
#
# Input: error message via stdin or CASE_ERROR env var

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$PROJECT_DIR/node_modules/.bin/bun"

SESSION_ID="${SESSION_ID:-unknown}"
ERROR_MSG="${CASE_ERROR:-}"

# Read from stdin if available
if [ -z "$ERROR_MSG" ] && [ ! -t 0 ]; then
  ERROR_MSG=$(cat)
fi

if [ -z "$ERROR_MSG" ]; then
  ERROR_MSG="Unknown error"
fi

"$BIN" run "$PROJECT_DIR/src/index.ts" case "$ERROR_MSG"
echo "Case logged: $ERROR_MSG"
