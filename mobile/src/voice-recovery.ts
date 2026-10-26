/** One bounded retry preserves a pending draft without creating an automatic loop. */
export function canAutoRetryEmptyTranscript(input: {
  code: string | undefined;
  handsFreeActive: boolean;
  consecutiveRetries: number;
}) {
  return (
    input.code === "EMPTY_TRANSCRIPT" &&
    input.handsFreeActive &&
    input.consecutiveRetries < 1
  );
}
