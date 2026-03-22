#!/usr/bin/env bash
# decay.sh — OpenClaw daily cron hook for confidence decay
# Run via cron: 0 3 * * * bash /path/to/decay.sh >> /var/log/memory-decay.log 2>&1
#
# Wire in openclaw.json or system cron:
#   "cron": { "decay": "0 3 * * *" }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$PROJECT_DIR/node_modules/.bin/bun"

DECAY_RATE="${DECAY_RATE:-0.05}"

echo "[$(date -Iseconds)] Running decay (rate=$DECAY_RATE)..."
"$BIN" run "$PROJECT_DIR/src/decay.ts" "$DECAY_RATE"
echo "[$(date -Iseconds)] Decay complete."
