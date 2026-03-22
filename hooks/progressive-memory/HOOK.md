---
name: progressive-memory
description: "Institutional memory for agents — Retain, Recall, Reflect across sessions"
homepage: https://github.com/bsreeram08/progressive-memory
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "events": ["agent:bootstrap", "message:sent", "message:received"],
      "requires": {},
      "always": true
    }
  }
---

# Progressive Memory Hook

Institutional memory system for OpenClaw agents. Implements Abe's Progressive Memory architecture.

## What It Does

- **Recall** (agent:bootstrap): Loads relevant memories before agent bootstraps
- **Retain** (message:sent): Stores agent conclusions after each response
- **Case** (message:received): Logs errors as immutable failure records

## Architecture

- **Storage**: Qdrant vector DB (http://localhost:6333)
- **Taxonomy**: Statement Type × Subject Type × Scope
- **Confidence**: Decays over time, archived below threshold

## Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| `QDRANT_HOST` | `http://localhost:6333` | Qdrant server |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama (embeddings) |
| `GEMINI_API_KEY` | — | Gemini API key |

## Events

- `agent:bootstrap` → Recall: inject relevant memories into context
- `message:sent` → Retain: store agent conclusions
- `message:received` → Case: log errors as immutable records
