import { localDateTimeContext } from "./conversation";
import {
  parseConversationContext,
  type AssistantIntent,
  type ConversationContext,
  type IntentResult,
  type PendingField,
} from "./conversation-machine";

const OPENAI_API_URL = "https://api.openai.com/v1";
const MAX_TEXT_LENGTH = 3000;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "intent"],
  properties: {
    message: { type: "string" },
    intent: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "subject", "fields", "clarificationField", "question"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "new_task",
            "follow_up",
            "update",
            "cancel",
            "clarify",
            "none",
          ],
        },
        subject: { type: ["string", "null"] },
        clarificationField: {
          type: ["string", "null"],
          enum: ["due", "title", "task_choice", null],
        },
        question: { type: ["string", "null"] },
        fields: {
          type: "object",
          additionalProperties: false,
          required: ["title", "person", "date", "time", "notes", "clearDue"],
          properties: {
            title: { type: ["string", "null"] },
            person: { type: ["string", "null"] },
            date: { type: ["string", "null"] },
            time: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
            clearDue: { type: "boolean" },
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
  return `You are LeadLoop's language interpreter. Return only JSON matching the schema. The application owns every task ID, lifecycle state, pending question, date conversion, and mutation. Never return a task ID or an executable operation.

The user's configured time zone is ${timeZone}. The current local date and time is ${localDateTimeContext(timeZone)}. Resolve relative dates to date as YYYY-MM-DD and time as HH:MM in that time zone. Do not return an ISO timestamp. Never invent dates, times, contacts, or task details.

Choose new_task only when the user clearly starts a separate reminder, including “also remind me”. Choose follow_up when the user answers the one pending question. Choose update or cancel for an existing reminder and put a short identifying subject in subject when the user names one. Choose clarify with clarificationField task_choice when more than one reminder could match. For corrections such as “actually make it 5 PM”, choose follow_up or update and include only changed fields. Use null for every unchanged field. If a task is missing a reminder date or time, choose clarify with clarificationField due and a concise question. A user must confirm before anything is saved.

CONVERSATION HISTORY:\n${JSON.stringify(context.history)}\n\nTASKS:\n${JSON.stringify(context.tasks)}\n\nPENDING CLARIFICATIONS:\n${JSON.stringify(context.pending)}\n\nLAST ACTIVE TASK ID (context only; never return it):\n${JSON.stringify(context.lastTaskId ?? null)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value: unknown, label: string, maxLength: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength)
    throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function parseIntent(value: unknown): IntentResult {
  if (!isRecord(value) || !isRecord(value.intent))
    throw new Error("Invalid response shape.");
  const intent = value.intent;
  const kind = intent.kind;
  if (
    kind !== "new_task" &&
    kind !== "follow_up" &&
    kind !== "update" &&
    kind !== "cancel" &&
    kind !== "clarify" &&
    kind !== "none"
  )
    throw new Error("Invalid intent kind.");
  if (!isRecord(intent.fields)) throw new Error("Invalid intent fields.");
  const fields = intent.fields;
  const date = nullableText(fields.date, "local date", 10);
  const time = nullableText(fields.time, "local time", 5);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Invalid local date.");
  if (time !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Invalid local time.");
  const clarificationField = intent.clarificationField;
  if (
    clarificationField !== null &&
    clarificationField !== "due" &&
    clarificationField !== "title" &&
    clarificationField !== "task_choice"
  )
    throw new Error("Invalid clarification field.");
  if (typeof fields.clearDue !== "boolean")
    throw new Error("Invalid clear reminder flag.");
  return {
    message:
      nullableText(value.message, "assistant message", 500) ||
      "I’m ready when you are.",
    intent: {
      kind,
      subject: nullableText(intent.subject, "task subject", 240),
      fields: {
        title: nullableText(fields.title, "task title", 240),
        person: nullableText(fields.person, "person", 160),
        date,
        time,
        notes: nullableText(fields.notes, "notes", 1000),
        clearDue: fields.clearDue,
      },
      clarificationField: clarificationField as PendingField | null,
      question: nullableText(intent.question, "clarification", 400),
    } as AssistantIntent,
  };
}

function logValidationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const rule =
    message === "Invalid local date." || message === "Invalid local time."
      ? "LOCAL_DATE_TIME"
      : message === "Invalid intent kind."
        ? "INTENT_KIND"
        : message === "Invalid intent fields."
          ? "INTENT_FIELDS"
          : "RESPONSE_VALIDATION";
  console.error(
    "[LeadLoop AI]",
    JSON.stringify({
      operation: "interpretation",
      errorType: "AI_INVALID_RESPONSE",
      validationRule: rule,
      field: rule === "LOCAL_DATE_TIME" ? "intent.fields.date/time" : "intent",
    }),
  );
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
): Promise<IntentResult> {
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
            name: "leadloop_task_intent",
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
    return parseIntent(JSON.parse(content));
  } catch (error) {
    logValidationFailure(error);
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Invalid local date." ||
      message === "Invalid local time."
    ) {
      return {
        message: "I need a valid date and time for that reminder.",
        intent: {
          kind: "follow_up",
          subject: null,
          fields: {
            title: null,
            person: null,
            date: null,
            time: null,
            notes: null,
            clearDue: false,
          },
          clarificationField: "due",
          question: "What date and time would you like?",
        },
      };
    }
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
