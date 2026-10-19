import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { interpretThought } from "../lib/ai-server";

if (process.env.LEADLOOP_LIVE_AI_TEST !== "1") {
  throw new Error(
    "This paid check is disabled. Run LEADLOOP_LIVE_AI_TEST=1 npm run test:live-ai to opt in.",
  );
}

if (!process.env.OPENAI_API_KEY) {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(
      /^OPENAI_API_KEY\s*=\s*[\"']?([^\s\"']+)[\"']?\s*$/m,
    );
    if (match) process.env.OPENAI_API_KEY = match[1];
  }
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY was not found in the environment or .env.local. Nothing was sent.",
  );
}

const result = await interpretThought(
  "Remind me to review the test contract tomorrow at 9 AM.",
  "America/Chicago",
  { history: [], tasks: [], pending: [] },
);

if (
  result.intent.kind !== "new_task" ||
  !result.intent.fields.date ||
  !result.intent.fields.time
) {
  throw new Error(
    "The live response did not satisfy the task-intent contract.",
  );
}

console.log("Live AI task-intent contract succeeded.");
