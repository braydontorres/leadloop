import type { VoiceActivityAction } from "./hands-free-vad";

export const HANDS_FREE_METER_RECOVERY = {
  // iOS needs a brief foreground transition after playback before its input
  // route returns live metering. This is not a VAD threshold.
  audioSessionSettleMs: 180,
  retryDelayMs: 300,
  maxAttemptsPerSession: 1,
} as const;

export type ListeningStartReason =
  | "initial"
  | "after_playback"
  | "no_speech_retry"
  | "meter_recovery"
  | "manual"
  | "user_resume";

export function shouldRecoverMeter(input: {
  action: VoiceActivityAction | "recorder_inactive" | "recorder_invalidated";
  speechStarted: boolean;
  attempts: number;
}) {
  return (
    (input.action === "meter_unavailable" ||
      input.action === "meter_stalled") &&
    !input.speechStarted &&
    input.attempts < HANDS_FREE_METER_RECOVERY.maxAttemptsPerSession
  );
}

/** Prevents an ended session or replaced turn from reviving microphone capture. */
export function canRunMeterRecovery(input: {
  active: boolean;
  scheduledSessionId: number;
  currentSessionId: number;
  scheduledTurn: number;
  activeTurn: number | null;
}) {
  return (
    input.active &&
    input.scheduledSessionId === input.currentSessionId &&
    input.activeTurn === null &&
    input.scheduledTurn >= 0
  );
}
