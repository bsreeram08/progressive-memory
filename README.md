# Progressive Memory v1

OpenClaw global agent memory hooks. TypeScript/Bun + Qdrant.

**Storage:** Qdrant (vector DB, self-hosted)
**Embeddings:** Ollama `nomic-embed-text` (local/free) or Gemini `text-embedding-004`
**Taxonomy:** Gemini 2.0 Flash (free tier) or rule-based fallback

## Install Qdrant

```bash
# Download Qdrant binary (no Docker required)
curl -sL https://github.com/qdrant/qdrant/releases/download/v1.17.0/qdrant-x86_64-unknown-linux-gnu.tar.gz | tar -xz
mv qdrant ~/.local/bin/qdrant
chmod +x ~/.local/bin/qdrant

# Start Qdrant (runs on port 6333, data stored in ./storage)
~/.local/bin/qdrant

# Or with custom storage path:
~/.local/bin/qdrant --config-path config.yaml
```

## Quick Start

```bash
cd projects/progressive-memory
bun install

# Init collections (run once)
bun run index.ts init

# Store a memory
bun run index.ts retain "Sree prefers concise, bullet-point answers"

# Retrieve memories
bun run index.ts recall "preferences"

# Classify text
bun run index.ts classify "I want dark mode by default"

# Get awareness layer (~200w summary)
bun run index.ts awareness

# Run decay (confidence decay + archive)
bun run index.ts decay

# Count memories
bun run index.ts count
```

## Architecture

```
Qdrant collections:
  active_memory   ← retain() / recall() (vector + payload search)
  archive_memory  ← decayed entries + logCase() (immutable failure records)
```

**Tiered retrieval:** Tier 1 uses exact payload filters (sub-10ms); Tier 2 falls back to vector similarity.

## Hooks (Global — apply to all agents)

| Hook | Script | Trigger |
|------|--------|---------|
| `preAgent` | `hooks/recall.sh` | Before agent responds — injects relevant memories |
| `postAgent` | `hooks/retain.sh` | After agent completes — stores conclusions |
| `onError` | `hooks/case.sh` | On agent error — logs immutable failure case |
| `cron:decay` | `hooks/decay.sh` | Daily 3 AM — confidence decay + archive/eviction |

## Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| `QDRANT_HOST` | `http://localhost:6333` | Qdrant server |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server (embeddings) |
| `GEMINI_API_KEY` | — | Gemini API key (fallback if Ollama unavailable) |
| `SESSION_ID` | `unknown` | Current session ID |
| `DECAY_RATE` | `0.05` | Confidence decay per cycle |

## OpenClaw Config

Add to `openclaw.json` hooks section:

```json
{
  "hooks": {
    "preAgent": ["bash /home/sreeram/.openclaw/workspace/projects/progressive-memory/hooks/recall.sh"],
    "postAgent": ["bash /home/sreeram/.openclaw/workspace/projects/progressive-memory/hooks/retain.sh"],
    "onError": ["bash /home/sreeram/.openclaw/workspace/projects/progressive-memory/hooks/case.sh"]
  }
}
```

## Cron Setup (decay + archive)

```bash
crontab -e
# Add:
0 3 * * * bash /home/sreeram/.openclaw/workspace/projects/progressive-memory/hooks/decay.sh >> /var/log/memory-decay.log 2>&1
```

## Memory Entry Schema

```typescript
{
  id: string;
  content: string;
  statement_type: 'fact' | 'belief' | 'preference' | 'intent' | 'rule' | 'pattern' | 'question' | 'unknown';
  subject_type: 'self' | 'human' | 'codebase' | 'system' | 'external';
  scope: 'session' | 'project' | 'global';
  layer: 'awareness' | 'active' | 'archive';
  confidence: number;         // 0.0 – 1.0
  created_at: string;         // ISO 8601
  source_session: string;
  tags: string[];
}
```

## Confidence Decay

- **≥ 0.5**: Active layer, decay applied each cycle
- **0.3–0.5**: Archived (layer=archive)
- **< 0.3**: Evicted (moved to archive, deleted from active)

Decay rate: `confidence -= DECAY_RATE` per cycle (default 0.05/day).
