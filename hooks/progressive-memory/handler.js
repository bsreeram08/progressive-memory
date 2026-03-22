// @bun
// hooks/progressive-memory/handler.ts
import { join } from "path";
var __dirname = "/home/sreeram/.openclaw/workspace/projects/progressive-memory/hooks/progressive-memory";
function resolveService() {
  const hookDir = import.meta.dirname ?? __dirname;
  const workspaceDir = join(hookDir, "..", "..", "workspace");
  const servicePath = join(workspaceDir, "projects", "progressive-memory", "dist", "service.js");
  return servicePath;
}
var handler = async (event) => {
  const { type, action } = event;
  if (type === "agent" && action === "bootstrap") {
    await handleRecall(event);
    return;
  }
  if (type === "message" && action === "sent") {
    await handleRetain(event);
    return;
  }
  if (type === "message" && action === "received") {
    await handleCase(event);
    return;
  }
};
async function handleRecall(event) {
  try {
    const servicePath = resolveService();
    const { recall } = await import(servicePath);
    const content = event.context?.content ?? "";
    const recentMessages = event.messages?.join(`
`) ?? "";
    const query = recentMessages || content || "agent context";
    const memories = await recall(query, {}, 10);
    if (memories.length > 0) {
      const summary = memories.slice(0, 5).map((m) => `[${m.statement_type}:${m.subject_type}] ${m.content}`).join(`
`);
      event.messages.push(`
\uD83E\uDDE0 **Memory Context** (${memories.length} memories loaded)
${summary}`);
    }
  } catch (err) {
    console.error("[progressive-memory] Recall failed:", err);
  }
}
async function handleRetain(event) {
  try {
    const servicePath = resolveService();
    const { retain } = await import(servicePath);
    const content = event.context?.content ?? "";
    const messages = event.messages ?? [];
    const response = messages[messages.length - 1] ?? content;
    if (!response || response.trim().length < 10)
      return;
    await retain(response, {
      source_session: event.sessionKey,
      layer: "active"
    });
    console.log(`[progressive-memory] Retained: ${response.slice(0, 80)}...`);
  } catch (err) {
    console.error("[progressive-memory] Retain failed:", err);
  }
}
async function handleCase(event) {
  try {
    const servicePath = resolveService();
    const { logCase } = await import(servicePath);
    const content = event.context?.content ?? "";
    const errorPatterns = [
      /error|exception|failed|timeout|crash/i,
      /Command failed|non-zero exit|signal SIGTERM/i
    ];
    const isError = errorPatterns.some((p) => p.test(content));
    if (!isError)
      return;
    await logCase(event.sessionKey, content, {
      source: event.context?.channelId ?? "unknown"
    });
    event.messages.push(`
\uD83D\uDCCB **Case logged**: ${content.slice(0, 100)}`);
  } catch (err) {
    console.error("[progressive-memory] Case logging failed:", err);
  }
}
var handler_default = handler;
export {
  handler_default as default
};
