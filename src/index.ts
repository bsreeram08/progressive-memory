import { retain, recall, classify, decay, getAwareness, logCase, initCollections, count, dedupeBrain } from "./service.js";

const cmd = process.argv[2]?.trim();
const args = process.argv.slice(3);

// Init collections on first run
let initialized = false;
async function ensureInit() {
  if (!initialized) {
    await initCollections();
    initialized = true;
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  switch (cmd) {
    case "init": {
      await initCollections();
      console.log("Collections initialized");
      break;
    }

    case "retain": {
      const text = args.join(" ") || await readStdin();
      if (!text.trim()) { console.error("Usage: index.ts retain <text>"); process.exit(1); }
      const id = await retain(text);
      console.log(id);
      break;
    }

    case "recall": {
      const query = args.join(" ");
      const entries = await recall(query);
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case "classify": {
      const text = args.join(" ") || await readStdin();
      const result = await classify(text);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "decay": {
      const rate = parseFloat(process.env.DECAY_RATE ?? "0.05");
      const result = await decay(rate);
      console.log(JSON.stringify(result));
      break;
    }

    case "awareness": {
      const limit = parseInt(args[0] ?? "20");
      const text = await getAwareness(limit);
      console.log(text);
      break;
    }

    case "case": {
      const sessionId = process.env.SESSION_ID ?? "unknown";
      const error = args.join(" ") || await readStdin();
      const id = await logCase(sessionId, error);
      console.log(id);
      break;
    }

    case "count": {
      const n = await count();
      console.log(n);
      break;
    }

    case "dedupe": {
      const result = await dedupeBrain();
      console.log(JSON.stringify(result));
      break;
    }

    default:
      console.error(`Commands: init, retain, recall, classify, decay, awareness, case, count, dedupe`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
