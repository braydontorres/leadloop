import type { AssistantSpeed, AssistantVoiceId } from "./assistant-preferences";

export type NaturalSpeechSelection = {
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
};

export type NaturalSpeechRequestStage =
  | "configuration"
  | "session"
  | "request"
  | "transport"
  | "response"
  | "download"
  | "cache";

/** Converts a client-safe API failure into UI-safe diagnostic metadata. */
export function naturalSpeechFailureDetails(error: unknown): {
  stage: NaturalSpeechRequestStage | "playback";
  code: string;
  retryAfterSeconds?: number;
} {
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "NaturalSpeechApiError" &&
    (
      [
        "configuration",
        "session",
        "request",
        "transport",
        "response",
        "download",
        "cache",
      ] as const
    ).includes(
      (error as { stage?: unknown }).stage as NaturalSpeechRequestStage,
    )
  ) {
    const failure = error as {
      stage: NaturalSpeechRequestStage;
      code?: unknown;
      retryAfterSeconds?: unknown;
    };
    const retryAfterSeconds =
      typeof failure.retryAfterSeconds === "number" &&
      Number.isSafeInteger(failure.retryAfterSeconds) &&
      failure.retryAfterSeconds > 0
        ? failure.retryAfterSeconds
        : undefined;
    return {
      stage: failure.stage,
      code:
        typeof failure.code === "string" && failure.code
          ? failure.code
          : "SPEECH_REQUEST_FAILED",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    };
  }
  return { stage: "playback", code: "SPEECH_PLAYBACK_FAILED" };
}

/** A concise, user-visible explanation while the included device voice speaks. */
export function naturalSpeechFallbackNotice(input: {
  code: string;
  retryAfterSeconds?: number;
}) {
  const reason =
    input.code === "LOCAL_RATE_LIMIT"
      ? "Natural voice is briefly cooling down"
      : input.code === "AI_RATE_LIMITED" || input.code === "AI_QUOTA_EXCEEDED"
        ? "OpenAI is temporarily limiting natural voice"
        : input.code === "SPEECH_NETWORK_ERROR" ||
            input.code === "SPEECH_TIMEOUT"
          ? "Natural voice could not reach the network"
          : "Natural voice is unavailable for this reply";
  const retry = input.retryAfterSeconds
    ? ` Try again in ${input.retryAfterSeconds}s.`
    : "";
  return `${reason}. Using device voice.${retry}`;
}

/** Settings diagnostics name the failure source without exposing request data. */
export function naturalSpeechDiagnosticSource(input: {
  stage: NaturalSpeechRequestStage | "audio_session" | "playback" | "complete";
  code?: string | null;
}) {
  if (input.stage === "playback") return "Native playback";
  if (input.code === "LOCAL_RATE_LIMIT") return "LeadLoop rate limit";
  if (input.code === "AI_RATE_LIMITED" || input.code === "AI_QUOTA_EXCEEDED")
    return "OpenAI rate limit";
  if (input.stage === "transport") return "Network transport";
  return "Natural voice request";
}

/** Only audio explicitly marked by our authenticated server is Natural AI audio. */
export function naturalSpeechResponseMatchesSelection(
  headers: Pick<Headers, "get">,
  input: NaturalSpeechSelection,
) {
  return (
    headers.get("x-leadloop-speech-source") === "openai-tts" &&
    headers.get("x-leadloop-speech-voice") === input.voice &&
    headers.get("x-leadloop-speech-speed") === input.speed
  );
}

/** A later preview or conversation response always wins over an older request. */
export function isCurrentNaturalSpeechRequest(
  requestId: number,
  currentRequestId: number,
) {
  return requestId === currentRequestId;
}
