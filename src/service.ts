import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  MemoryEntry,
  MemoryMetadata,
  RecallFilters,
  ClassificationResult,
  MemoryLink,
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

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function asMemoryLinks(value: unknown): MemoryLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Partial<MemoryLink>)
    .filter((item): item is MemoryLink =>
      typeof item?.id === "string" &&
      typeof item?.kind === "string" &&
      typeof item?.reason === "string" &&
      typeof item?.score === "number"
    );
}

function mergeLinks(existing: MemoryLink[] | undefined, next: MemoryLink[]): MemoryLink[] {
  const map = new Map<string, MemoryLink>();
  for (const link of existing ?? []) {
    map.set(`${link.id}:${link.kind}`, link);
  }
  for (const link of next) {
    const key = `${link.id}:${link.kind}`;
    const current = map.get(key);
    if (!current || link.score > current.score) map.set(key, link);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 8);
}

function pointToMemoryEntry(point: { id: string | number; payload?: Record<string, unknown> | null }): MemoryEntry {
  const payload = point.payload ?? {};
  return {
    id: String(point.id),
    content: typeof payload.content === "string" ? payload.content : "",
    content_hash: typeof payload.content_hash === "string" ? payload.content_hash : undefined,
    statement_type: (payload.statement_type as MemoryEntry["statement_type"]) ?? "unknown",
    subject_type: (payload.subject_type as MemoryEntry["subject_type"]) ?? "external",
    scope: (payload.scope as MemoryEntry["scope"]) ?? "session",
    layer: (payload.layer as MemoryEntry["layer"]) ?? "active",
    confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
    created_at: typeof payload.created_at === "string" ? payload.created_at : new Date().toISOString(),
    first_seen_at: typeof payload.first_seen_at === "string" ? payload.first_seen_at : undefined,
    last_seen_at: typeof payload.last_seen_at === "string" ? payload.last_seen_at : undefined,
    repeat_count: typeof payload.repeat_count === "number" ? payload.repeat_count : undefined,
    source_session: typeof payload.source_session === "string" ? payload.source_session : "unknown",
    tags: toStringArray(payload.tags),
    links: asMemoryLinks(payload.links),
    link_count: typeof payload.link_count === "number" ? payload.link_count : asMemoryLinks(payload.links).length,
  };
}

async function buildMemoryLinks(params: {
  contentHash: string;
  content: string;
  metadata: MemoryMetadata;
  embedding: number[] | null;
}): Promise<MemoryLink[]> {
  const { contentHash, metadata, embedding } = params;
  if (!embedding || embedding.every((n) => n === 0)) return [];

  const response = await client.search(COLLECTION_ACTIVE, {
    vector: embedding,
    limit: 8,
    with_payload: true,
  }).catch(() => [] as any[]);

  const links: MemoryLink[] = [];
  const sourceTags = new Set(metadata.tags ?? []);
  for (const point of response as any[]) {
    const id = String(point.id ?? "");
    if (!id || id === contentHash) continue;
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    const score = typeof point.score === "number" ? point.score : 0;
    const candidateTags = toStringArray(payload.tags);
    const sharedTags = candidateTags.filter((t) => sourceTags.has(t));
    const sameSession = typeof payload.source_session === "string" && payload.source_session === metadata.source_session;
    const sameSubject = typeof payload.subject_type === "string" && payload.subject_type === metadata.subject_type;
    const sameScope = typeof payload.scope === "string" && payload.scope === metadata.scope;

    let kind: MemoryLink["kind"] | null = null;
    let reason = "";

    if (sameSession) {
      kind = "session";
      reason = "same source session";
    } else if (sharedTags.length > 0) {
      kind = "topic";
      reason = `shared tags: ${sharedTags.slice(0, 3).join(", ")}`;
    } else if (sameSubject && score >= 0.82) {
      kind = "same_subject";
      reason = `same subject_type (${metadata.subject_type})`;
    } else if (sameScope && score >= 0.84) {
      kind = "same_scope";
      reason = `same scope (${metadata.scope})`;
    } else if (score >= 0.87) {
      kind = "semantic";
      reason = `semantic similarity ${score.toFixed(2)}`;
    }

    if (!kind) continue;
    links.push({ id, kind, score, reason });
    if (links.length >= 5) break;
  }

  return links;
}

export async function retain(
  content: string,
  metadata: MemoryMetadata = {}
): Promise<string> {
  const classification = await classifyText(content);
  const normalized = normalizeContent(content);
  const contentHash = await hashContent(normalized);
  const embeddingResult = await getEmbedding(content).catch(() => null);
  const embedding = embeddingResult?.embedding ?? null;
  const now = new Date().toISOString();

  const existing = await client.retrieve(COLLECTION_ACTIVE, {
    ids: [contentHash],
    with_payload: true,
    with_vector: false,
  }).catch(() => [] as any[]);

  const existingPayload = ((existing[0] as any)?.payload ?? {}) as Record<string, unknown>;
  const repeatCount = typeof existingPayload.repeat_count === "number" ? existingPayload.repeat_count + 1 : 1;
  const firstSeenAt = typeof existingPayload.first_seen_at === "string" ? existingPayload.first_seen_at : now;
  const lastSeenAt = now;
  const newLinks = await buildMemoryLinks({ contentHash, content, metadata, embedding });
  const mergedLinks = mergeLinks(asMemoryLinks(existingPayload.links), newLinks);

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
    tags: Array.from(new Set([...(metadata.tags ?? []), ...toStringArray(existingPayload.tags)])),
    links: mergedLinks,
    link_count: mergedLinks.length,
  };

  await client.upsert(COLLECTION_ACTIVE, {
    wait: true,
    points: [
      {
        id: contentHash,
        vector: embedding ?? new Array(EMBEDDING_DIM).fill(0),
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

async function expandWithLinkedMemories(entries: MemoryEntry[], limit: number): Promise<MemoryEntry[]> {
  const seen = new Set(entries.map((e) => e.id));
  const output = [...entries];
  const linkedIds = new Set<string>();

  for (const entry of entries) {
    for (const link of entry.links ?? []) {
      if (!seen.has(link.id)) linkedIds.add(link.id);
    }
  }

  if (linkedIds.size === 0 || output.length >= limit) return output.slice(0, limit);

  const related = await client.retrieve(COLLECTION_ACTIVE, {
    ids: Array.from(linkedIds).slice(0, Math.max(limit - output.length, 0) * 2 || limit),
    with_payload: true,
    with_vector: false,
  }).catch(() => [] as any[]);

  for (const point of related as any[]) {
    const entry = pointToMemoryEntry(point);
    if (seen.has(entry.id) || !entry.content.trim()) continue;
    seen.add(entry.id);
    output.push(entry);
    if (output.length >= limit) break;
  }

  return output.slice(0, limit);
}

export async function recall(
  query: string,
  filters: RecallFilters = {},
  limit = 10
): Promise<MemoryEntry[]> {
  const filter = buildFilter(filters);
  const queryEmbedding = (await getEmbedding(query).catch(() => null))?.embedding ?? new Array(EMBEDDING_DIM).fill(0);

  let base: MemoryEntry[] = [];

  // Tier 1: payload filters first
  if (filter) {
    const tier1 = await client.search(COLLECTION_ACTIVE, {
      vector: queryEmbedding,
      limit,
      filter,
      with_payload: true,
    });
    if (tier1.length > 0) {
      base = tier1.map((r) => pointToMemoryEntry(r as any));
      return expandWithLinkedMemories(base, limit);
    }
  }

  // Tier 2: vector search
  const tier2 = await client.search(COLLECTION_ACTIVE, {
    vector: queryEmbedding,
    limit,
    filter,
    with_payload: true,
  });

  base = tier2.map((r) => pointToMemoryEntry(r as any));
  return expandWithLinkedMemories(base, limit);
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
