import type { ClassificationResult } from "./types.js";

const GEMINI_FLASH_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const PROMPT = `You are a taxonomy classifier for agent memory entries. Classify the input text and return a JSON object.

Output format (no markdown, no code blocks, just clean JSON):
{"statement_type":"fact|belief|preference|intent|rule|pattern|question|unknown","subject_type":"self|human|codebase|system|external","scope":"session|project|global","confidence":0.0-1.0}

Rules:
- statement_type: What kind of memory is this?
  - fact: verifiable information, factual statements
  - belief: opinion, assumption, perspective
  - belief: opinion, assumption, perspective
  - preference: likes, dislikes, choices
  - intent: plans, goals, wishes
  - rule: policies, constraints, guidelines
  - pattern: observed trends, recurring behavior
  - question: inquiries, unknowns to resolve
  - unknown: uncategorizable
- subject_type: What is this about?
  - self: the agent itself
  - human: the user/person
  - codebase: code, files, architecture
  - system: infrastructure, tools, services
  - external: third parties, world knowledge
- scope: How long-lasting is this?
  - session: temporary, single conversation
  - project: lasts the lifetime of a project
  - global: permanent, cross-project knowledge
- confidence: How certain is the classification? (0.5-1.0)

Input text:
`;

export async function classifyText(text: string): Promise<ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT + text }] }],
          generationConfig: {
            responseMimeType: "text/plain",
            temperature: 0.2,
            maxOutputTokens: 256,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            statement_type: parsed.statement_type ?? "unknown",
            subject_type: parsed.subject_type ?? "external",
            scope: parsed.scope ?? "session",
            confidence: parsed.confidence ?? 0.7,
          };
        }
      }
      // Non-ok or no match → fall through to rule-based
    } catch {
      // Timeout, network error, etc. → fall through
    }
  }

  // Rule-based fallback — no LLM call needed
  return classifyByRules(text);
}

function classifyByRules(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Statement type heuristics
  let statement_type: ClassificationResult["statement_type"] = "unknown";
  let confidence = 0.6;

  if (/\b(prefers?|likes?|dislikes?|wants?|hates?)\b/.test(lower)) {
    statement_type = "preference";
  } else if (/\b(plan|intend|going to|will|should|must|need to)\b/.test(lower)) {
    statement_type = "intent";
  } else if (/\b(should|must|rule|policy|constraint|never|always)\b/.test(lower)) {
    statement_type = "rule";
  } else if (/\?(?:\s*$)/.test(text)) {
    statement_type = "question";
  } else if (/\b(usually|often|always|never|repeated|pattern|recurring)\b/.test(lower)) {
    statement_type = "pattern";
  } else if (/\b(think|believe|feel|probably|maybe|assume)\b/.test(lower)) {
    statement_type = "belief";
  } else if (/^fact:|^case:|\bverified|\bconfirmed|\bdocumented\b/i.test(text)) {
    statement_type = "fact";
  } else {
    statement_type = "fact"; // default to fact for observational statements
    confidence = 0.5;
  }

  // Subject type heuristics
  let subject_type: ClassificationResult["subject_type"] = "external";

  if (/\b(i'm|i am|my|me myself)\b/.test(lower)) {
    subject_type = "self";
  } else if (/\b(sree|user|he|him|human|person|client|customer)\b/.test(lower)) {
    subject_type = "human";
  } else if (/\b(code|file|function|class|api|endpoint|module|import|export)\b/.test(lower)) {
    subject_type = "codebase";
  } else if (/\b(server|database|docker|kubernetes|linux|api|server|infra)\b/.test(lower)) {
    subject_type = "system";
  }

  // Scope heuristics
  let scope: ClassificationResult["scope"] = "session";
  if (/\b(always|never|global|permanent|default)\b/.test(lower)) {
    scope = "global";
  } else if (/\b(project|codebase|repo|app|build|deploy)\b/.test(lower)) {
    scope = "project";
  }

  return { statement_type, subject_type, scope, confidence };
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv.slice(2).join(" ");
  if (!input) {
    console.error("Usage: bun run classify.ts <text>");
    process.exit(1);
  }
  const result = await classifyText(input);
  console.log(JSON.stringify(result, null, 2));
}
