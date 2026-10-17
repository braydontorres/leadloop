import {
  AVAILABLE_DRAFT_IDS_PER_TURN,
  MAX_HISTORY_TURNS,
  MAX_KNOWN_TASKS,
  localDateTimeContext,
  parseAssistantResult,
  parseConversationContext,
  type AssistantResult,
  type ConversationContext,
} from "./conversation";
import { fromLocalInput, toLocalInput } from "./tasks";

const OPENAI_API_URL = "https://api.openai.com/v1";
const MAX_TEXT_LENGTH = 3000;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "operations"],
  properties: {
    message: { type: "string" },
    operations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "targetId",
          "targetIds",
          "question",
          "task",
          "changes",
        ],
        properties: {
          type: {
            type: "string",
            enum: ["create", "update", "cancel", "clarify"],
          },
          targetId: { type: ["string", "null"] },
          targetIds: { type: "array", items: { type: "string" } },
          question: { type: ["string", "null"] },
          task: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["title", "person", "due", "notes"],
            properties: {
              title: { type: "string" },
              person: { type: "string" },
              due: { type: ["string", "null"] },
              notes: { type: "string" },
            },
          },
          changes: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              person: { type: "string" },
              due: { type: ["string", "null"] },
              notes: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw new ApiError(
      "OpenAI is not configured. Add OPENAI_API_KEY to enable voice and AI understanding.",
      503,
      "AI_NOT_CONFIGURED",
    );
  return key;
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateInterpretationInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError("Send a valid request.", 400, "INVALID_REQUEST");
  const data = input as Record<string, unknown>;
  if (
    typeof data.text !== "string" ||
    !data.text.trim() ||
    data.text.length > MAX_TEXT_LENGTH
  ) {
    throw new ApiError(
      "Enter a thought between 1 and 3,000 characters.",
      400,
      "INVALID_TEXT",
    );
  }
  if (!isTimeZone(data.timeZone))
    throw new ApiError("Choose a valid time zone.", 400, "INVALID_TIME_ZONE");
  let context: ConversationContext;
  try {
    context = parseConversationContext(data.context ?? {});
  } catch {
    throw new ApiError(
      "Your conversation context is invalid.",
      400,
      "INVALID_CONTEXT",
    );
  }
  return { text: data.text.trim(), timeZone: data.timeZone, context };
}

function systemPrompt(timeZone: string, context: ConversationContext) {
  return `You are LeadLoop, a careful business task assistant. Return only JSON matching the schema. The user's display time zone is ${timeZone}. The current local date and time is ${localDateTimeContext(timeZone)}. Interpret relative dates in that time zone. Never invent a date, time, contact, or task detail.

Conversation state is authoritative. An unfinished task is a real review draft, not merely chat history. When a user says a recognizable task but omits a required reminder time, create the draft immediately with every known field and due:null, then add a clarify operation that targets that same draft. For a new create, targetId must be one unused id from AVAILABLE NEW DRAFT IDS. You may use that new id in a clarification targetIds array in the same response. For updates or cancellations, targetId must exactly match a KNOWN TASK id. Preserve all unrelated fields in update.task.

If PENDING CLARIFICATIONS contains exactly one task and the user's next statement naturally answers its question, update that task by default. If the user clearly starts a separate task, create it and leave the unfinished task pending. If more than one pending task could fit an ambiguous follow-up, ask which task they mean; do not guess. Treat “that”, “it”, “him”, and “her” as references to the most recent unambiguous unfinished or reviewed task. “Actually” or “I meant” is normally an update, never a duplicate create. A pronoun can update a known task only when one task is unambiguous; otherwise clarify.

Use one create per separate task. A response must never create and update/cancel the same intended task. For update, return only the fields the user explicitly changed in changes; do not repeat unchanged title, contact, due date, or notes. This is essential: an update to a reminder time has changes: {"due":"..."} only, so the stored date, contact, title, and notes are preserved. Never put an inferred contact into changes.person; only change it when the user explicitly names the replacement. A due date must be an ISO 8601 UTC timestamp ending in Z (for example 2026-10-23T22:00:00.000Z), or null only when the user explicitly removes a reminder. Create uses task and changes:null. Update uses changes and task:null. Cancel and clarify use task:null and changes:null. Clarify requires a short question and targetIds for every affected task. Use targetIds:[] only when no task is identifiable. For non-clarify operations use targetIds:[]. Do not save anything: the user must confirm later.

HISTORY (bounded):\n${JSON.stringify(context.history.slice(-MAX_HISTORY_TURNS))}\n\nKNOWN TASKS (bounded):\n${JSON.stringify(context.knownTasks.slice(-MAX_KNOWN_TASKS))}\n\nPENDING CLARIFICATIONS:\n${JSON.stringify(context.pendingClarifications)}\n\nAVAILABLE NEW DRAFT IDS:\n${JSON.stringify(context.availableDraftIds.slice(0, AVAILABLE_DRAFT_IDS_PER_TURN))}`;
}

function validateResultTargets(
  result: AssistantResult,
  context: ConversationContext,
) {
  const knownIds = new Set(context.knownTasks.map((task) => task.id));
  const availableIds = new Set(context.availableDraftIds);
  const created = result.operations.filter(
    (
      operation,
    ): operation is Extract<
      AssistantResult["operations"][number],
      { type: "create" }
    > => operation.type === "create",
  );
  const createdIds = new Set(created.map((operation) => operation.targetId));
  if (
    created.some((operation) => !availableIds.has(operation.targetId)) ||
    createdIds.size !== created.length
  ) {
    throw new Error("Invalid new draft reference.");
  }
  const mutationIds = new Set<string>();
  for (const operation of result.operations) {
    if (operation.type === "create") {
      continue;
    }
    if (operation.type === "update" || operation.type === "cancel") {
      if (!knownIds.has(operation.targetId))
        throw new Error("Invalid task reference.");
      if (mutationIds.has(operation.targetId))
        throw new Error("Conflicting task operations.");
      mutationIds.add(operation.targetId);
      continue;
    }
    for (const targetId of operation.targetIds) {
      if (!knownIds.has(targetId) && !createdIds.has(targetId)) {
        throw new Error("Invalid clarification reference.");
      }
    }
  }
}

function words(value: string) {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function userExplicitlyNamed(text: string, person: string) {
  const said = words(text);
  const nameWords = [...words(person)].filter((word) => word.length > 1);
  return nameWords.some((word) => said.has(word));
}

export function normalizeAndValidateUpdates(
  result: AssistantResult,
  text: string,
  timeZone: string,
  context: ConversationContext,
): AssistantResult {
  const known = new Map(context.knownTasks.map((task) => [task.id, task]));
  const spokenTime = text.match(
    /\b(?:at\s+|make (?:it|that)\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  const operations = result.operations.map((operation) => {
    if (operation.type !== "update") return operation;
    const current = known.get(operation.targetId);
    if (!current) return operation;
    let changes = operation.changes;
    if (
      changes.person !== undefined &&
      changes.person !== current.person &&
      !userExplicitlyNamed(text, changes.person)
    ) {
      const { person: _unsafePerson, ...safeChanges } = changes;
      changes = safeChanges;
      if (Object.keys(changes).length === 0) {
        throw new Error("Unverified contact change.");
      }
    }
    if (spokenTime && changes.due) {
      const hour12 = Number(spokenTime[1]);
      const minute = Number(spokenTime[2] ?? "0");
      const isPm = spokenTime[3].toLowerCase().startsWith("p");
      if (hour12 < 1 || hour12 > 12 || minute > 59) {
        throw new Error("Invalid spoken time.");
      }
      const expectedHour = (hour12 % 12) + (isPm ? 12 : 0);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(changes.due));
      const actual = Object.fromEntries(
        parts
          .filter((part) => part.type === "hour" || part.type === "minute")
          .map((part) => [part.type, Number(part.value)]),
      );
      if (actual.hour !== expectedHour || actual.minute !== minute) {
        const hasRelativeDate =
          /\b(today|tomorrow|tonight|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/?\d{1,2})\b/i.test(
            text,
          );
        if (!current.due || hasRelativeDate) {
          throw new Error("Reminder time did not match the request.");
        }
        const existingLocal = toLocalInput(current.due, timeZone);
        changes = {
          ...changes,
          due: fromLocalInput(
            `${existingLocal.slice(0, 11)}${String(expectedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
            timeZone,
          ),
        };
      }
    }
    return { ...operation, changes };
  });
  const pronounReference = /\b(that|it|him|her)\b/i.test(text);
  const updates = operations.filter((operation) => operation.type === "update");
  const creates = operations.filter((operation) => operation.type === "create");
  return pronounReference && updates.length === 1 && creates.length > 0
    ? {
        ...result,
        operations: operations.filter(
          (operation) => operation.type !== "create",
        ),
      }
    : { ...result, operations };
}

async function openAiFetch(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${OPENAI_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers },
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new ApiError(
          "OpenAI rejected the server key. Check your environment setting.",
          502,
          "AI_AUTH_FAILED",
        );
      if (response.status === 429)
        throw new ApiError(
          "LeadLoop is receiving too many AI requests. Please wait a moment.",
          429,
          "AI_RATE_LIMITED",
        );
      throw new ApiError(
        "LeadLoop could not reach OpenAI. Please try again.",
        502,
        "AI_REQUEST_FAILED",
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError")
      throw new ApiError(
        "The AI request took too long. Please try again.",
        504,
        "AI_TIMEOUT",
      );
    throw new ApiError(
      "LeadLoop could not reach OpenAI. Please try again.",
      502,
      "AI_NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function interpretThought(
  text: string,
  timeZone: string,
  context: ConversationContext,
): Promise<AssistantResult> {
  const response = await openAiFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "leadloop_task_operations",
          strict: true,
          schema: responseSchema,
        },
      },
      messages: [
        { role: "system", content: systemPrompt(timeZone, context) },
        { role: "user", content: text },
      ],
    }),
  });
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content)
    throw new ApiError(
      "LeadLoop received an empty AI response. Please try again.",
      502,
      "AI_EMPTY_RESPONSE",
    );
  try {
    const result = normalizeAndValidateUpdates(
      parseAssistantResult(JSON.parse(content)),
      text,
      timeZone,
      context,
    );
    validateResultTargets(result, context);
    return result;
  } catch {
    throw new ApiError(
      "LeadLoop received an invalid AI response. Please try again.",
      502,
      "AI_INVALID_RESPONSE",
    );
  }
}

export async function transcribeAudio(audio: File) {
  const form = new FormData();
  form.append("file", audio, audio.name || "leadloop-recording.webm");
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "json");
  const response = await openAiFetch("/audio/transcriptions", {
    method: "POST",
    body: form,
  });
  const payload = (await response.json()) as { text?: unknown };
  if (
    typeof payload.text !== "string" ||
    !payload.text.trim() ||
    payload.text.length > MAX_TEXT_LENGTH
  ) {
    throw new ApiError(
      "We couldn't hear a usable thought in that recording.",
      422,
      "EMPTY_TRANSCRIPT",
    );
  }
  return payload.text.trim();
}
