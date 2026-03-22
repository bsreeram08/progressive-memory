#!/usr/bin/env bash
# recall.sh — OpenClaw pre-agent hook
# Reads session context from stdin (or env vars), calls retain(), 
# outputs context injection for the agent prompt via stdout.
#
# Wire in openclaw.json hooks:
#   "hooks": { "preAgent": ["bash /path/to/recall.sh"] }
#
# The script reads:
#   - SESSION_ID  (env)
#   - RECALL_QUERY (env, optional — what to retrieve)
#   - STDIN       (session transcript)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$PROJECT_DIR/node_modules/.bin/bun"

SESSION_ID="${SESSION_ID:-$(uuidgen 2>/dev/null || echo "unknown")}"
QUERY="${RECALL_QUERY:-}"

# Read stdin if available (session context)
CONTEXT=""
if [ ! -t 0 ]; then
  CONTEXT=$(cat)
fi

# Fallback query to last few lines of context
if [ -z "$QUERY" ] && [ -n "$CONTEXT" ]; then
  QUERY=$(echo "$CONTEXT" | tail -c 500)
fi

# If we have a query, retrieve relevant memories
if [ -n "$QUERY" ]; then
  RESULTS=$(
    SESSION_ID="$SESSION_ID" "$BIN" run "$PROJECT_DIR/src/index.ts" \
      recall "$QUERY" 2>/dev/null || echo "[]"
  )

  # Inject into prompt via stdout
  if [ "$RESULTS" != "[]" ] && [ -n "$RESULTS" ]; then
    echo "--- RELEVANT MEMORY ---"
    echo "$RESULTS" | "$BIN" xargs -0 -I{} "$BIN" run "$PROJECT_DIR/src/index.ts" classify "{}" 2>/dev/null || true
    echo "$RESULTS"
    echo "--- END MEMORY ---"
  fi
fi
