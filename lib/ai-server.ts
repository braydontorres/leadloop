import { localDateTimeContext } from "./conversation";
import {
  parseConversationContext,
  type AssistantIntent,
  type ConversationContext,
  type IntentResult,
} from "./conversation-machine";
import { recoverInitialReminderIntent } from "./reminder-fallback";

const OPENAI_API_URL = "https://api.openai.com/v1";
const MAX_TEXT_LENGTH = 3000;
const MAX_SPEECH_TEXT_LENGTH = 800;

/**
 * These identifiers are documented OpenAI voices. The product labels describe
 * their perceived delivery only; they do not claim a person's gender.
 */
export const NATURAL_SPEECH_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;
export type NaturalSpeechVoice = (typeof NATURAL_SPEECH_VOICES)[number];
export const NATURAL_SPEECH_SPEEDS = ["relaxed", "normal", "fast"] as const;
export type NaturalSpeechSpeed = (typeof NATURAL_SPEECH_SPEEDS)[number];

const naturalSpeechRates: Record<NaturalSpeechSpeed, number> = {
  // Make the three owner-facing choices readily audible in a short preview.
  // All values are within the provider's supported range.
  relaxed: 0.75,
  normal: 1,
  fast: 1.35,
};

export function isNaturalSpeechVoice(
  value: unknown,
): value is NaturalSpeechVoice {
  return (
    typeof value === "string" &&
    (NATURAL_SPEECH_VOICES as readonly string[]).includes(value)
  );
}

export function isNaturalSpeechSpeed(
  value: unknown,
): value is NaturalSpeechSpeed {
  return (
    typeof value === "string" &&
    (NATURAL_SPEECH_SPEEDS as readonly string[]).includes(value)
  );
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent"],
  properties: {
    intent: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "fields"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "new_task",
            "follow_up",
            "update",
            "confirm",
            "reject",
            "cancel",
            "end_conversation",
            "none",
          ],
        },
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
    public retryAfterSeconds?: number,
    public source: "internal" | "openai" = "openai",
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
  return `You are LeadLoop's language interpreter for one active reminder conversation. Return only JSON matching the schema. The application owns task IDs, dialogue stage, missing-field questions, read-back wording, confirmation, and saving. Never return an ID, a question, an executable operation, or a claim that a reminder was saved.

The user's configured time zone is ${timeZone}. The current local date and time is ${localDateTimeContext(timeZone)}. Resolve only unambiguous relative dates to YYYY-MM-DD and times explicitly spoken by the user to HH:MM in that time zone. Do not return an ISO timestamp. Never invent dates, times, contacts, or task details. For supported relative phrases such as “two weeks from today”, “in five days”, “tomorrow”, and “one week later”, return date as null: LeadLoop's calendar engine calculates those deterministically from its stored context. Month-plus-weekday references without a numbered day or ordinal (for example, “next July on a Saturday”) are ambiguous: return date and time as null. For ordinal weekday language (first/second/third/fourth/fifth/last/second-to-last), return date and time as null unless the user also supplied an explicit calendar date; LeadLoop calculates ordinal dates itself. Never default a missing time to noon. Use null for every unchanged or unknown field.

Choose new_task for a new reminder, follow_up when the user supplies requested details, update for a correction, confirm for yes/correct/that's right, reject for no/not right, cancel for cancel/never mind, end_conversation for a clear conversational goodbye such as “that's all”, “nothing else”, “we're done”, or “bye”, and none when no supported intent is clear. A confirmation does not include task fields. A correction such as “make it 6 PM” only includes time. The active reminder is the only reminder this turn may change. During awaiting_confirmation, interpret “no” as reject, never end_conversation.

CONVERSATION STAGE:\n${JSON.stringify(context.stage)}\n\nACTIVE REMINDER:\n${JSON.stringify(context.activeReminder)}\n\nCONVERSATION HISTORY:\n${JSON.stringify(context.history)}`;
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
    kind !== "confirm" &&
    kind !== "reject" &&
    kind !== "cancel" &&
    kind !== "end_conversation" &&
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
  if (typeof fields.clearDue !== "boolean")
    throw new Error("Invalid clear reminder flag.");
  return {
    intent: {
      kind,
      fields: {
        title: nullableText(fields.title, "task title", 240),
        person: nullableText(fields.person, "person", 160),
        date,
        time,
        notes: nullableText(fields.notes, "notes", 1000),
        clearDue: fields.clearDue,
      },
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
  retryAfterSeconds?: number;
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

/** Keep provider cooldowns short and clock-independent for native clients. */
function retryAfterSeconds(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3_600
    ? seconds
    : undefined;
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
    retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
  };
}

function logAiFailure(
  operation: "transcription" | "interpretation" | "speech",
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
      retryAfterSeconds: failure.retryAfterSeconds,
    }),
  );
}

function errorForProviderFailure(
  failure: ProviderFailure,
  operation: "transcription" | "interpretation" | "speech",
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
      failure.retryAfterSeconds,
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
        : operation === "speech"
          ? "OpenAI could not create that voice response. Try device speech instead."
          : "OpenAI rejected LeadLoop's task interpretation request. Update LeadLoop and try again.",
      operation === "transcription" ? 422 : 502,
      operation === "transcription"
        ? "AI_TRANSCRIPTION_REJECTED"
        : operation === "speech"
          ? "AI_SPEECH_REJECTED"
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
  operation: "transcription" | "interpretation" | "speech",
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

/**
 * Creates a short, transient MP3 response for an authenticated client. The
 * caller owns authorization and must never persist the returned response.
 */
export async function synthesizeNaturalSpeech(input: {
  text: string;
  voice: NaturalSpeechVoice;
  speed: NaturalSpeechSpeed;
}) {
  const text = input.text.trim();
  if (!text || text.length > MAX_SPEECH_TEXT_LENGTH)
    throw new ApiError(
      "LeadLoop can speak replies up to 800 characters.",
      400,
      "SPEECH_TEXT_INVALID",
    );
  const response = await openAiFetch(
    "/audio/speech",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
        voice: input.voice,
        input: text,
        response_format: "mp3",
        speed: naturalSpeechRates[input.speed],
        instructions:
          "Speak warmly and conversationally, with clear pacing for a small-business owner.",
      }),
    },
    "speech",
  );
  return response;
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
    const parsed = parseIntent(JSON.parse(content));
    const intent = recoverInitialReminderIntent({
      text,
      timeZone,
      activeReminder: context.activeReminder,
      intent: parsed.intent,
    });
    console.info(
      "[LeadLoop interpretation]",
      JSON.stringify({
        stage: context.stage,
        hasActiveReminder: Boolean(context.activeReminder),
        intentKind: intent.kind,
        hasTitle: Boolean(intent.fields.title),
        hasDate: Boolean(intent.fields.date),
        hasTime: Boolean(intent.fields.time),
        transcriptLength: text.length,
      }),
    );
    return { intent };
  } catch (error) {
    logValidationFailure(error);
    const message = error instanceof Error ? error.message : "";
    if (
      message === "Invalid local date." ||
      message === "Invalid local time."
    ) {
      return {
        intent: {
          kind: "follow_up",
          fields: {
            title: null,
            person: null,
            date: null,
            time: null,
            notes: null,
            clearDue: false,
          },
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
