/**
 * Progressive Memory Hook Handler
 *
 * Events:
 * - agent:bootstrap → Recall: load relevant memories before agent runs
 * - message:sent     → Retain: store agent conclusions after response
 * - message:received → Case:  log errors as immutable failure records
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Dynamically load the service to avoid path issues
// The progressive-memory project lives at:
//   ~/.openclaw/workspace/projects/progressive-memory/
// Hooks are discovered from: ~/.openclaw/hooks/progressive-memory/
// So we go up 2 dirs from hook location to reach workspace

function resolveService() {
  // hook dir:  ~/.openclaw/hooks/progressive-memory/
  // workspace: ~/.openclaw/workspace/
  const hookDir = import.meta.dirname ?? __dirname;
  const workspaceDir = join(hookDir, "..", "..", "workspace");
  const servicePath = join(workspaceDir, "projects", "progressive-memory", "dist", "service.js");
  return servicePath;
}

interface HookEvent {
  type: string;
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: Record<string, unknown>;
}

const handler = async (event: HookEvent) => {
  const { type, action } = event;

  // agent:bootstrap → Recall (load memories before agent runs)
  if (type === "agent" && action === "bootstrap") {
    await handleRecall(event);
    return;
  }

  // message:sent → Retain (store conclusions after response)
  if (type === "message" && action === "sent") {
    await handleRetain(event);
    return;
  }

  // message:received → Case (log errors)
  if (type === "message" && action === "received") {
    await handleCase(event);
    return;
  }
};

async function handleRecall(event: HookEvent) {
  try {
    const servicePath = resolveService();
    const { recall } = await import(servicePath);

    // Extract recent message context for recall
    const content = event.context?.content as string | undefined ?? "";
    const recentMessages = event.messages?.join("\n") ?? "";

    const query = recentMessages || content || "agent context";

    const memories = await recall(query, {}, 10);

    if (memories.length > 0) {
      const summary = memories
        .slice(0, 5)
        .map((m: Record<string, unknown>) => `[${m.statement_type}:${m.subject_type}] ${m.content}`)
        .join("\n");

      event.messages.push(
        `\n🧠 **Memory Context** (${memories.length} memories loaded)\n${summary}`
      );
    }
  } catch (err) {
    console.error("[progressive-memory] Recall failed:", err);
  }
}

async function handleRetain(event: HookEvent) {
  try {
    const servicePath = resolveService();
    const { retain } = await import(servicePath);

    const content = event.context?.content as string | undefined ?? "";
    const messages = event.messages ?? [];

    // Extract the actual response from messages array
    const response = messages[messages.length - 1] ?? content;

    if (!response || response.trim().length < 10) return;

    await retain(response, {
      source_session: event.sessionKey,
      layer: "active",
    });

    console.log(`[progressive-memory] Retained: ${response.slice(0, 80)}...`);
  } catch (err) {
    console.error("[progressive-memory] Retain failed:", err);
  }
}

async function handleCase(event: HookEvent) {
  try {
    const servicePath = resolveService();
    const { logCase } = await import(servicePath);

    const content = event.context?.content as string | undefined ?? "";

    // Detect error patterns
    const errorPatterns = [
      /error|exception|failed|timeout|crash/i,
      /Command failed|non-zero exit|signal SIGTERM/i,
    ];

    const isError = errorPatterns.some((p) => p.test(content));

    if (!isError) return;

    await logCase(event.sessionKey, content, {
      source: event.context?.channelId as string ?? "unknown",
    });

    event.messages.push(`\n📋 **Case logged**: ${content.slice(0, 100)}`);
  } catch (err) {
    console.error("[progressive-memory] Case logging failed:", err);
  }
}

export default handler;
