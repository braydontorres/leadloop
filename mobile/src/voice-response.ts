export function voiceHttpError(input: {
  message?: string;
  retryAfterSeconds?: number;
}) {
  const retry = input.retryAfterSeconds
    ? ` Try again in ${input.retryAfterSeconds} seconds.`
    : "";
  return new Error(
    (input.message || "LeadLoop could not process that recording.") + retry,
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
