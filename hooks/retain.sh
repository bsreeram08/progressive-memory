#!/usr/bin/env bash
# retain.sh — OpenClaw post-agent hook (on agent:complete)
# Extracts conclusions/key learnings from the agent response and stores them.
#
# Wire in openclaw.json:
#   "hooks": { "postAgent": ["bash /path/to/retain.sh"] }
#
# Input: agent output via stdin or RETAIN_TEXT env var

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$PROJECT_DIR/node_modules/.bin/bun"

SESSION_ID="${SESSION_ID:-unknown}"
RETAIN_TEXT="${RETAIN_TEXT:-}"

# Read from stdin if available
if [ -z "$RETAIN_TEXT" ] && [ ! -t 0 ]; then
  RETAIN_TEXT=$(cat)
fi

if [ -z "$RETAIN_TEXT" ]; then
  exit 0
fi

# Retain the conclusion
"$BIN" run "$PROJECT_DIR/src/index.ts" retain "$RETAIN_TEXT" --scope global
echo "Retained: ${RETAIN_TEXT:0:100}..."
