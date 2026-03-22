// Embedding provider abstraction
// Tries Ollama first (local/free), falls back to Gemini embeddings

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

export async function getEmbedding(text: string): Promise<EmbeddingResult> {
  // Try Ollama first (local, free)
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return { embedding: data.embedding, model: "nomic-embed-text" };
    }
  } catch {
    // Ollama not available, fall through
  }

  // Fall back to Gemini embeddings
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("No embedding provider available. Set OLLAMA_URL or GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text }] } }),
    }
  );
  if (!res.ok) throw new Error(`Gemini embeddings failed: ${res.statusText}`);
  const data = await res.json();
  return { embedding: data.embedding.values, model: "gemini-text-embedding-004" };
}
