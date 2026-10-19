import type { AssistantIntent, IntentFields } from "./conversation-machine";
import { isMeaningfulReminderTitle } from "./reminder-details";

function localDate(timeZone: string, now: Date, offsetDays: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === name)?.value ?? "";
  const start = Date.UTC(
    Number(part("year")),
    Number(part("month")) - 1,
    Number(part("day")),
  );
  return new Date(start + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function parsedTime(text: string) {
  const match = text.match(
    /\b(?:at\s*)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i,
  );
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (match[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
}

/**
 * A deliberately narrow recovery path for a clear initial reminder request.
 * It is used only if the model omitted all task fields, never for follow-ups.
 */
export function inferClearReminderRequest(
  text: string,
  timeZone: string,
  now = new Date(),
): IntentFields | null {
  const spoken = text.trim();
  if (
    /^(?:yes|yeah|yep|no|nope|cancel|never mind|that'?s all|nothing else|bye)\b/i.test(
      spoken,
    )
  )
    return null;
  const explicit = spoken.match(
    /^(?:please\s+)?(?:remind me|remember|i need)\s+to\s+(.+)$/i,
  );
  // An initial imperative is also a task when the model omitted its fields.
  // Time-only and date-only utterances clean down to an empty title below.
  const candidate = explicit?.[1] ?? spoken;
  const date = /\btomorrow\b/i.test(candidate)
    ? localDate(timeZone, now, 1)
    : /\btoday\b/i.test(candidate)
      ? localDate(timeZone, now, 0)
      : null;
  const time = parsedTime(candidate);
  const title = candidate
    .replace(/\b(?:today|tomorrow)\b.*$/i, "")
    .replace(
      /\b(?:at\s*)?(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b.*$/i,
      "",
    )
    .replace(/[,.\s]+$/, "")
    .trim();
  if (!isMeaningfulReminderTitle(title)) return null;
  return { title, person: null, date, time, notes: null, clearDue: false };
}

export function recoverInitialReminderIntent(args: {
  text: string;
  timeZone: string;
  activeReminder: unknown;
  intent: AssistantIntent;
  now?: Date;
}): AssistantIntent {
  const { intent } = args;
  if (args.activeReminder || intent.fields.title !== null) return intent;
  if (
    intent.kind !== "none" &&
    intent.kind !== "new_task" &&
    intent.kind !== "follow_up"
  )
    return intent;
  const fields = inferClearReminderRequest(args.text, args.timeZone, args.now);
  return fields ? { kind: "new_task", fields } : intent;
}
