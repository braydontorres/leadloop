/** Ignore a recorder status read that belonged to the turn before this one. */
export function statusBelongsToActiveTurn(
  checkedAtMs: number | null,
  recordingStartedAtMs: number | null,
) {
  return (
    checkedAtMs !== null &&
    recordingStartedAtMs !== null &&
    checkedAtMs >= recordingStartedAtMs
  );
}
