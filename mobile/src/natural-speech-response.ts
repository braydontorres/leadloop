import type { AssistantSpeed, AssistantVoiceId } from "./assistant-preferences";

export type NaturalSpeechSelection = {
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
};

export type NaturalSpeechRequestStage = "request" | "response" | "cache";

/** Converts a client-safe API failure into UI-safe diagnostic metadata. */
export function naturalSpeechFailureDetails(error: unknown): {
  stage: NaturalSpeechRequestStage | "playback";
  code: string;
} {
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "NaturalSpeechApiError" &&
    ((error as { stage?: unknown }).stage === "request" ||
      (error as { stage?: unknown }).stage === "response" ||
      (error as { stage?: unknown }).stage === "cache")
  ) {
    const failure = error as {
      stage: NaturalSpeechRequestStage;
      code?: unknown;
    };
    return {
      stage: failure.stage,
      code:
        typeof failure.code === "string" && failure.code
          ? failure.code
          : "SPEECH_REQUEST_FAILED",
    };
  }
  return { stage: "playback", code: "SPEECH_PLAYBACK_FAILED" };
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
