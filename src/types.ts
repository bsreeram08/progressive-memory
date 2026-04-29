export interface MemoryEntry {
  id: string;
  content: string;
  content_hash?: string;
  statement_type: "fact" | "belief" | "preference" | "intent" | "rule" | "pattern" | "question" | "unknown";
  subject_type: "self" | "human" | "codebase" | "system" | "external";
  scope: "session" | "project" | "global";
  layer: "awareness" | "active" | "archive";
  confidence: number;
  created_at: string;
  first_seen_at?: string;
  last_seen_at?: string;
  repeat_count?: number;
  source_session: string;
  tags: string[];
}

export interface MemoryMetadata {
  statement_type?: MemoryEntry["statement_type"];
  subject_type?: MemoryEntry["subject_type"];
  scope?: MemoryEntry["scope"];
  layer?: MemoryEntry["layer"];
  confidence?: number;
  tags?: string[];
  source_session?: string;
}

export interface RecallFilters {
  statement_type?: MemoryEntry["statement_type"];
  subject_type?: MemoryEntry["subject_type"];
  scope?: MemoryEntry["scope"];
  layer?: MemoryEntry["layer"];
  tags?: string[];
  min_confidence?: number;
  since?: string;
}

export interface ClassificationResult {
  statement_type: MemoryEntry["statement_type"];
  subject_type: MemoryEntry["subject_type"];
  scope: MemoryEntry["scope"];
  confidence: number;
  reasoning?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}
