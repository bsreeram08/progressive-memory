import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  MemoryEntry,
  MemoryMetadata,
  RecallFilters,
  ClassificationResult,
} from "./types.js";
import { classifyText } from "./classify.js";
import { getEmbedding } from "./embed.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const QDRANT_HOST = process.env.QDRANT_HOST ?? "http://localhost:6333";
const COLLECTION_ACTIVE = "active_memory";
const COLLECTION_ARCHIVE = "archive_memory";
const EMBEDDING_DIM = 768; // nomic-embed-text / Gemini embedding-004

// ─── Client ──────────────────────────────────────────────────────────────────

const client = new QdrantClient({ url: QDRANT_HOST });

// ─── Init ────────────────────────────────────────────────────────────────────

export async function initCollections(): Promise<void> {
  if (!(await collectionExists(COLLECTION_ACTIVE))) {
    await client.createCollection(COLLECTION_ACTIVE, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "statement_type",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "subject_type",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "scope",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "layer",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "confidence",
      field_schema: "float",
    });
    await client.createPayloadIndex(COLLECTION_ACTIVE, {
      field_name: "tags",
      field_schema: "keyword",
    });
  }

  if (!(await collectionExists(COLLECTION_ARCHIVE))) {
    await client.createCollection(COLLECTION_ARCHIVE, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
    });
    await client.createPayloadIndex(COLLECTION_ARCHIVE, {
      field_name: "statement_type",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_ARCHIVE, {
      field_name: "source_session",
      field_schema: "keyword",
    });
  }
}

async function collectionExists(name: string): Promise<boolean> {
  try {
    const result = await client.collectionExists(name);
    return result.exists;
  } catch {
    return false;
  }
}

// ─── Retain ───────────────────────────────────────────────────────────────────

function normalizeContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function retain(
  content: string,
  metadata: MemoryMetadata = {}
): Promise<string> {
  const classification = await classifyText(content);
  const normalized = normalizeContent(content);
  const contentHash = await hashContent(normalized);
  const embedding = await getEmbedding(content).catch(() => null);
  const now = new Date().toISOString();

  const existing = await client.retrieve(COLLECTION_ACTIVE, {
    ids: [contentHash],
    with_payload: true,
    with_vector: false,
  }).catch(() => []);

  const existingPayload = (existing[0]?.payload ?? {}) as Record<string, unknown>;
  const repeatCount = typeof existingPayload.repeat_count === "number" ? existingPayload.repeat_count + 1 : 1;
  const firstSeenAt = typeof existingPayload.first_seen_at === "string" ? existingPayload.first_seen_at : now;
  const lastSeenAt = now;

  const entry: Record<string, unknown> = {
    content,
    content_hash: contentHash,
    statement_type: metadata.statement_type ?? classification.statement_type,
    subject_type: metadata.subject_type ?? classification.subject_type,
    scope: metadata.scope ?? classification.scope,
    layer: metadata.layer ?? "active",
    confidence: metadata.confidence ?? classification.confidence,
    created_at: typeof existingPayload.created_at === "string" ? existingPayload.created_at : now,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    repeat_count: repeatCount,
    source_session: metadata.source_session ?? existingPayload.source_session ?? "unknown",
    tags: Array.from(new Set([...(metadata.tags ?? []), ...((existingPayload.tags as string[] | undefined) ?? [])])),
  };

  await client.upsert(COLLECTION_ACTIVE, {
    wait: true,
    points: [
      {
        id: contentHash,
        vector: embedding?.embedding ?? new Array(EMBEDDING_DIM).fill(0),
        payload: entry,
      },
    ],
  });

  return contentHash;
}

// ─── Recall ───────────────────────────────────────────────────────────────────

function buildFilter(filters: RecallFilters) {
  const must: Record<string, unknown>[] = [];
  if (filters.statement_type) must.push({ key: "statement_type", match: { value: filters.statement_type } });
  if (filters.subject_type) must.push({ key: "subject_type", match: { value: filters.subject_type } });
  if (filters.scope) must.push({ key: "scope", match: { value: filters.scope } });
  if (filters.layer) must.push({ key: "layer", match: { value: filters.layer } });
  if (filters.min_confidence !== undefined) must.push({ key: "confidence", range: { gte: filters.min_confidence } });
  if (filters.tags?.length) must.push({ key: "tags", match: { any: filters.tags } });
  if (filters.since) must.push({ key: "created_at", range: { gte: filters.since } });
  return must.length > 0 ? { must } : undefined;
}

export async function recall(
  query: string,
  filters: RecallFilters = {},
  limit = 10
): Promise<MemoryEntry[]> {
  const filter = buildFilter(filters);

  // Tier 1: payload filters first
  if (filter) {
    const tier1 = await client.search(COLLECTION_ACTIVE, {
      vector: (await getEmbedding(query).catch(() => null))?.embedding ?? new Array(EMBEDDING_DIM).fill(0),
      limit,
      filter,
      with_payload: true,
    });
    if (tier1.length > 0) {
      return tier1.map((r) => r.payload as unknown as MemoryEntry);
    }
  }

  // Tier 2: vector search
  const tier2 = await client.search(COLLECTION_ACTIVE, {
    vector: (await getEmbedding(query).catch(() => null))?.embedding ?? new Array(EMBEDDING_DIM).fill(0),
    limit,
    filter,
    with_payload: true,
  });

  return tier2.map((r) => r.payload as unknown as MemoryEntry);
}

// ─── Classify ─────────────────────────────────────────────────────────────────

export async function classify(text: string): Promise<ClassificationResult> {
  return classifyText(text);
}

// ─── Decay ────────────────────────────────────────────────────────────────────

export async function decay(decayRate = 0.05): Promise<{
  decayed: number;
  archived: number;
  evicted: number;
}> {
  const ARCHIVE_THRESHOLD = 0.5;
  const EVICT_THRESHOLD = 0.3;

  let offset: string | undefined;
  const toUpdate: Array<{ id: string; payload: Record<string, unknown>; newConfidence: number }> = [];

  do {
    const result = await client.scroll(COLLECTION_ACTIVE, {
      filter: { must: [{ key: "layer", match: { value: "active" } }] },
      with_payload: true,
      limit: 100,
      offset,
    });

    for (const point of result.points ?? []) {
      const confidence = (point.payload?.confidence as number) ?? 1.0;
      const newConfidence = +(confidence - decayRate).toFixed(4);
      toUpdate.push({ id: point.id as string, payload: point.payload as Record<string, unknown>, newConfidence });
    }

    offset = result.next_page_offset as string | undefined;
  } while (offset);

  let archived = 0;
  let evicted = 0;

  for (const { id, payload, newConfidence } of toUpdate) {
    if (newConfidence < EVICT_THRESHOLD) {
      await client.upsert(COLLECTION_ARCHIVE, {
        wait: true,
        points: [{ id, vector: [], payload: { ...payload, layer: "archive" } }],
      });
      await client.delete(COLLECTION_ACTIVE, { wait: true, points: [id] });
      evicted++;
    } else if (newConfidence < ARCHIVE_THRESHOLD) {
      await client.setPayload(COLLECTION_ACTIVE, {
        wait: true,
        points: [id],
        payload: { ...payload, layer: "archive", confidence: newConfidence },
      });
      archived++;
    } else {
      await client.setPayload(COLLECTION_ACTIVE, {
        wait: true,
        points: [id],
        payload: { ...payload, confidence: newConfidence },
      });
    }
  }

  return { decayed: toUpdate.length - archived - evicted, archived, evicted };
}

// ─── Awareness ────────────────────────────────────────────────────────────────

export async function getAwareness(limit = 50): Promise<string> {
  const entries = await recall("", { layer: "active", min_confidence: 0.6 }, limit);

  const chunks = entries
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20)
    .map((e) => `[${e.statement_type}:${e.subject_type}] ${e.content}`)
    .join("\n");

  const words = chunks.split(/\s+/);
  if (words.length <= 200) return chunks;
  return words.slice(0, 200).join(" ") + "...";
}

// ─── Case ─────────────────────────────────────────────────────────────────────

export async function logCase(
  sessionId: string,
  error: string,
  context: Record<string, unknown> = {}
): Promise<string> {
  const id = crypto.randomUUID();
  const entry: Record<string, unknown> = {
    content: `CASE: ${error}`,
    statement_type: "fact",
    subject_type: "system",
    scope: "session",
    layer: "archive",
    confidence: 1.0,
    created_at: new Date().toISOString(),
    source_session: sessionId,
    tags: ["case", "error", ...Object.keys(context)],
  };

  await client.upsert(COLLECTION_ARCHIVE, {
    wait: true,
    points: [{ id, vector: new Array(EMBEDDING_DIM).fill(0), payload: entry }],
  });

  return id;
}

// ─── Dedupe ───────────────────────────────────────────────────────────────────

function parseCreatedAt(createdAt: unknown): number {
  const ts = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

async function dedupeCollection(collection: string): Promise<{
  scanned: number;
  groups: number;
  deleted: number;
}> {
  let offset: string | undefined;
  const groups = new Map<string, Array<{ id: string; confidence: number; createdAt: number }>>();
  let scanned = 0;

  do {
    const result = await client.scroll(collection, {
      with_payload: true,
      limit: 256,
      offset,
    });

    for (const point of result.points ?? []) {
      scanned++;
      const payload = point.payload as Record<string, unknown> | undefined;
      const content = typeof payload?.content === "string" ? payload.content : "";
      if (!content.trim()) continue;
      const key = normalizeContent(content);
      const confidence = typeof payload?.confidence === "number" ? payload.confidence : 0;
      const createdAt = parseCreatedAt(payload?.created_at);
      const bucket = groups.get(key) ?? [];
      bucket.push({ id: point.id as string, confidence, createdAt });
      groups.set(key, bucket);
    }

    offset = result.next_page_offset as string | undefined;
  } while (offset);

  const toDelete: string[] = [];
  for (const bucket of Array.from(groups.values())) {
    if (bucket.length <= 1) continue;
    bucket.sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt);
    toDelete.push(...bucket.slice(1).map((x) => x.id));
  }

  for (let i = 0; i < toDelete.length; i += 128) {
    const chunk = toDelete.slice(i, i + 128);
    await client.delete(collection, { wait: true, points: chunk });
  }

  return { scanned, groups: Array.from(groups.values()).filter((bucket) => bucket.length > 1).length, deleted: toDelete.length };
}

export async function dedupeBrain(): Promise<{
  active: { scanned: number; groups: number; deleted: number };
  archive: { scanned: number; groups: number; deleted: number };
}> {
  return {
    active: await dedupeCollection(COLLECTION_ACTIVE),
    archive: await dedupeCollection(COLLECTION_ARCHIVE),
  };
}

// ─── Count ────────────────────────────────────────────────────────────────────

export async function count(layer?: string): Promise<number> {
  try {
    const result = await client.getCollection(COLLECTION_ACTIVE);
    return result.points_count ?? 0;
  } catch {
    return 0;
  }
}
