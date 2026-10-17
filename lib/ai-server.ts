import {
  MAX_HISTORY_TURNS,
  MAX_KNOWN_TASKS,
  localDateTimeContext,
  parseAssistantResult,
  parseConversationContext,
  type AssistantResult,
  type ConversationContext,
} from "./conversation";

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
        required: ["type", "targetId", "question", "task"],
        properties: {
          type: {
            type: "string",
            enum: ["create", "update", "cancel", "clarify"],
          },
          targetId: { type: ["string", "null"] },
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
  return `You are LeadLoop, a careful business task assistant. Return only JSON matching the schema. The user's display time zone is ${timeZone}. The current local date and time is ${localDateTimeContext(timeZone)}. Interpret relative dates in that time zone. Never invent a date, time, contact, or task detail. If a reminder date lacks a time, emit a clarify operation asking a short question. If any detail is ambiguous, emit clarify and do not create or update a task for the ambiguous part. A due date must be an ISO 8601 timestamp with offset in UTC (for example 2026-10-23T22:00:00.000Z), or null only if no date was mentioned and no clarification is needed. For an update or cancellation, targetId must exactly match an id from KNOWN TASKS or the prior unsaved review queue. Preserve all existing task fields in update.task unless the user changes them. For an update, send the complete replacement task. Use one create operation per separate task. Do not save anything: the user must confirm later.\n\nHISTORY (bounded):\n${JSON.stringify(context.history.slice(-MAX_HISTORY_TURNS))}\n\nKNOWN TASKS (bounded):\n${JSON.stringify(context.knownTasks.slice(-MAX_KNOWN_TASKS))}`;
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
    return parseAssistantResult(JSON.parse(content));
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
