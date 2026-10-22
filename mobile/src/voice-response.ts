export class MobileVoiceApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MobileVoiceApiError";
  }
}

export function voiceHttpError(input: {
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
}) {
  const retry = input.retryAfterSeconds
    ? ` Try again in ${input.retryAfterSeconds} seconds.`
    : "";
  return new MobileVoiceApiError(
    (input.message || "LeadLoop could not process that recording.") + retry,
    input.code,
  );
}

export function isVoiceTimeout(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function voiceTimeoutError() {
  return new Error(
    "Voice processing timed out. Your reminder was not changed; try again.",
  );
}
