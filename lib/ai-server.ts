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
            required: ["title", "person", "due", "notes", "clearDue"],
            properties: {
              title: { type: ["string", "null"] },
              person: { type: ["string", "null"] },
              due: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
              clearDue: { type: "boolean" },
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
    public requestId?: string,
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

Conversation state is authoritative. An unfinished task is a real review draft, not merely chat history. When a user says a recognizable task but omits a required reminder time, create the draft immediately with every known field and due:null, then add a clarify operation that targets that same draft. For a new create, targetId must be one unused id from AVAILABLE NEW DRAFT IDS. You may use that new id in a clarification targetIds array in the same response. For updates or cancellations, targetId must exactly match a KNOWN TASK id. Preserve all unrelated fields by leaving them null in update.changes.

If PENDING CLARIFICATIONS contains exactly one task and the user's next statement naturally answers its question, update that task by default. If the user clearly starts a separate task, create it and leave the unfinished task pending. If more than one pending task could fit an ambiguous follow-up, ask which task they mean; do not guess. Treat “that”, “it”, “him”, and “her” as references to the most recent unambiguous unfinished or reviewed task. “Actually” or “I meant” is normally an update, never a duplicate create. A pronoun can update a known task only when one task is unambiguous; otherwise clarify.

Use one create per separate task. A response must never create and update/cancel the same intended task. OpenAI structured output requires every changes key: for update, changes must always be {"title":string|null,"person":string|null,"due":string|null,"notes":string|null,"clearDue":boolean}. Use null for unchanged title, person, due, and notes. Set clearDue:true only when the user explicitly removes the reminder; otherwise it is false. This is essential: a time-only update is {"title":null,"person":null,"due":"...","notes":null,"clearDue":false}, so the stored date, contact, title, and notes are preserved. Never put an inferred contact into changes.person; only change it when the user explicitly names the replacement. A due date must be an ISO 8601 UTC timestamp ending in Z (for example 2026-10-23T22:00:00.000Z). Create uses task and changes:null. Update uses changes and task:null. Cancel and clarify use task:null and changes:null. Clarify requires a short question and targetIds for every affected task. Use targetIds:[] only when no task is identifiable. For non-clarify operations use targetIds:[]. Do not save anything: the user must confirm later.

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

type ProviderFailure = {
  status?: number;
  requestId?: string;
  providerType?: string;
  providerCode?: string;
  providerParam?: string;
  providerMessage?: string;
};

function safeDiagnosticValue(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(value)
    ? value
    : undefined;
}

function requestIdFrom(response: Response) {
  return (
    safeDiagnosticValue(response.headers.get("x-request-id")) ??
    safeDiagnosticValue(response.headers.get("request-id"))
  );
}

function safeSchemaMessage(value: unknown, parameter?: string) {
  if (
    typeof value !== "string" ||
    value.length > 1000 ||
    !(
      parameter?.startsWith("response_format") ||
      value.startsWith("Invalid schema for response_format") ||
      value.startsWith("Invalid parameter: response_format")
    )
  ) {
    return undefined;
  }
  return value;
}

async function providerFailure(response: Response): Promise<ProviderFailure> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload.error as Record<string, unknown>)
      : undefined;
  const providerParam = safeDiagnosticValue(error?.param);
  return {
    status: response.status,
    requestId: requestIdFrom(response),
    providerType: safeDiagnosticValue(error?.type),
    providerCode: safeDiagnosticValue(error?.code),
    providerParam,
    providerMessage: safeSchemaMessage(error?.message, providerParam),
  };
}

function logAiFailure(
  operation: "transcription" | "interpretation",
  failure: ProviderFailure & { errorType: string },
) {
  console.error(
    "[LeadLoop AI]",
    JSON.stringify({
      operation,
      errorType: failure.errorType,
      httpStatus: failure.status,
      requestId: failure.requestId,
      providerType: failure.providerType,
      providerCode: failure.providerCode,
      providerParam: failure.providerParam,
      providerMessage: failure.providerMessage,
    }),
  );
}

function errorForProviderFailure(
  failure: ProviderFailure,
  operation: "transcription" | "interpretation",
) {
  if (failure.status === 401)
    return new ApiError(
      "OpenAI rejected the server key. Check your environment setting.",
      502,
      "AI_AUTH_FAILED",
      failure.requestId,
    );
  if (failure.status === 403)
    return new ApiError(
      `This OpenAI project is not allowed to use ${operation}. Check the project and model permissions.`,
      502,
      "AI_ACCESS_DENIED",
      failure.requestId,
    );
  if (failure.status === 404)
    return new ApiError(
      `The configured ${operation} model is unavailable to this OpenAI project.`,
      502,
      "AI_MODEL_UNAVAILABLE",
      failure.requestId,
    );
  if (failure.status === 429) {
    const quota = failure.providerCode === "insufficient_quota";
    return new ApiError(
      quota
        ? "This OpenAI project has no available quota. Check billing and project limits."
        : "LeadLoop is receiving too many AI requests. Please wait a moment.",
      429,
      quota ? "AI_QUOTA_EXCEEDED" : "AI_RATE_LIMITED",
      failure.requestId,
    );
  }
  if (
    failure.status === 400 ||
    failure.status === 413 ||
    failure.status === 415
  )
    return new ApiError(
      operation === "transcription"
        ? "OpenAI could not accept this recording. Record a short note in a supported browser and try again."
        : "OpenAI rejected LeadLoop's task interpretation request. Update LeadLoop and try again.",
      operation === "transcription" ? 422 : 502,
      operation === "transcription"
        ? "AI_TRANSCRIPTION_REJECTED"
        : "AI_INTERPRETATION_REJECTED",
      failure.requestId,
    );
  if (failure.status && failure.status >= 500)
    return new ApiError(
      "OpenAI is temporarily unavailable. Please try again shortly.",
      503,
      "AI_PROVIDER_UNAVAILABLE",
      failure.requestId,
    );
  return new ApiError(
    "OpenAI could not complete this request. Please try again.",
    502,
    "AI_REQUEST_FAILED",
    failure.requestId,
  );
}

async function openAiFetch(
  path: string,
  init: RequestInit,
  operation: "transcription" | "interpretation",
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${OPENAI_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers },
    });
    if (!response.ok) {
      const failure = await providerFailure(response);
      const error = errorForProviderFailure(failure, operation);
      logAiFailure(operation, { ...failure, errorType: error.code });
      throw error;
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError") {
      const timeoutError = new ApiError(
        "The AI request took too long. Please try again.",
        504,
        "AI_TIMEOUT",
      );
      logAiFailure(operation, { errorType: timeoutError.code });
      throw timeoutError;
    }
    const networkError = new ApiError(
      "LeadLoop could not reach OpenAI. Please try again.",
      502,
      "AI_NETWORK_ERROR",
    );
    logAiFailure(operation, {
      errorType: networkError.code,
      providerCode: safeDiagnosticValue(
        (error as { cause?: { code?: unknown } }).cause?.code,
      ),
    });
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
}

export async function interpretThought(
  text: string,
  timeZone: string,
  context: ConversationContext,
): Promise<AssistantResult> {
  const response = await openAiFetch(
    "/chat/completions",
    {
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
    },
    "interpretation",
  );
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
  const response = await openAiFetch(
    "/audio/transcriptions",
    {
      method: "POST",
      body: form,
    },
    "transcription",
  );
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
