/** Foreground-only recorder metering policy for Expo Audio on iOS. */
export const HANDS_FREE_VAD = {
  startThresholdDb: -48,
  noiseMarginDb: 12,
  speechStartHoldMs: 180,
  endSilenceMs: 1_200,
  minimumSpeechMs: 280,
  noSpeechTimeoutMs: 8_000,
  maximumTurnMs: 30_000,
  meterUnavailableMs: 2_000,
  // AVAudioRecorder can expose a numeric floor value (commonly -160 dB)
  // even when meter updates are not actually arriving. Treat an unchanged
  // value as unavailable instead of silently waiting for a voice that can
  // never be detected.
  meterStalledMs: 2_500,
  meterChangeEpsilonDb: 0.5,
} as const;

export type VoiceActivityState = {
  startedAtMs: number;
  noiseFloorDb: number | null;
  speechCandidateAtMs: number | null;
  speechStartedAtMs: number | null;
  lastVoiceAtMs: number | null;
  sawMeter: boolean;
  lastMeterDb: number | null;
  lastMeterChangeAtMs: number | null;
};

export type VoiceActivityAction =
  | "continue"
  | "speech_started"
  | "submit"
  | "retry_silence"
  | "meter_unavailable"
  | "meter_stalled";

export function newVoiceActivity(startedAtMs = 0): VoiceActivityState {
  return {
    startedAtMs,
    noiseFloorDb: null,
    speechCandidateAtMs: null,
    speechStartedAtMs: null,
    lastVoiceAtMs: null,
    sawMeter: false,
    lastMeterDb: null,
    lastMeterChangeAtMs: null,
  };
}

function clampMeter(value: number) {
  return Math.max(-90, Math.min(-5, value));
}

export function voiceActivityThreshold(state: VoiceActivityState) {
  return Math.max(
    HANDS_FREE_VAD.startThresholdDb,
    (state.noiseFloorDb ?? -60) + HANDS_FREE_VAD.noiseMarginDb,
  );
}

/**
 * This detects activity, not speaker identity. It qualifies sustained nearby
 * speech/noise and waits for a natural silence before submitting one turn.
 */
export function advanceVoiceActivity(
  state: VoiceActivityState,
  elapsedMs: number,
  meterDb: number | undefined,
): { state: VoiceActivityState; action: VoiceActivityAction } {
  if (!Number.isFinite(meterDb)) {
    return {
      state,
      action:
        elapsedMs >= HANDS_FREE_VAD.meterUnavailableMs
          ? "meter_unavailable"
          : "continue",
    };
  }

  const meter = clampMeter(meterDb as number);
  const meterChanged =
    state.lastMeterDb === null ||
    Math.abs(meter - state.lastMeterDb) >= HANDS_FREE_VAD.meterChangeEpsilonDb;
  const lastMeterChangeAtMs = meterChanged
    ? elapsedMs
    : (state.lastMeterChangeAtMs ?? elapsedMs);
  if (
    state.speechStartedAtMs === null &&
    elapsedMs >= HANDS_FREE_VAD.meterStalledMs &&
    elapsedMs - lastMeterChangeAtMs >= HANDS_FREE_VAD.meterStalledMs
  ) {
    return {
      state: {
        ...state,
        sawMeter: true,
        lastMeterDb: meter,
        lastMeterChangeAtMs,
      },
      action: "meter_stalled",
    };
  }
  let noiseFloorDb = state.noiseFloorDb ?? Math.min(meter, -60);
  let threshold = Math.max(
    HANDS_FREE_VAD.startThresholdDb,
    noiseFloorDb + HANDS_FREE_VAD.noiseMarginDb,
  );
  // Learn only observations below the current activity threshold. A first
  // spoken sample must not become the noise floor and mask itself.
  if (state.speechStartedAtMs === null && meter < threshold) {
    noiseFloorDb = noiseFloorDb * 0.85 + meter * 0.15;
    threshold = Math.max(
      HANDS_FREE_VAD.startThresholdDb,
      noiseFloorDb + HANDS_FREE_VAD.noiseMarginDb,
    );
  }
  const isVoice = meter >= threshold;
  let next: VoiceActivityState = {
    ...state,
    noiseFloorDb,
    sawMeter: true,
    lastMeterDb: meter,
    lastMeterChangeAtMs,
  };

  if (next.speechStartedAtMs === null) {
    if (isVoice) {
      const candidateAtMs = next.speechCandidateAtMs ?? elapsedMs;
      next = { ...next, speechCandidateAtMs: candidateAtMs };
      if (elapsedMs - candidateAtMs >= HANDS_FREE_VAD.speechStartHoldMs) {
        next = {
          ...next,
          speechStartedAtMs: candidateAtMs,
          lastVoiceAtMs: elapsedMs,
        };
        return { state: next, action: "speech_started" };
      }
    } else if (next.speechCandidateAtMs !== null) {
      next = { ...next, speechCandidateAtMs: null };
    }
    return {
      state: next,
      action:
        elapsedMs >= HANDS_FREE_VAD.noSpeechTimeoutMs
          ? "retry_silence"
          : "continue",
    };
  }

  if (isVoice)
    next = {
      ...next,
      lastVoiceAtMs: elapsedMs,
    };
  const speechStartedAtMs = next.speechStartedAtMs;
  if (speechStartedAtMs === null) return { state: next, action: "continue" };
  const speechDurationMs = elapsedMs - speechStartedAtMs;
  const silenceMs = elapsedMs - (next.lastVoiceAtMs ?? elapsedMs);
  if (
    speechDurationMs >= HANDS_FREE_VAD.minimumSpeechMs &&
    silenceMs >= HANDS_FREE_VAD.endSilenceMs
  )
    return { state: next, action: "submit" };
  if (elapsedMs >= HANDS_FREE_VAD.maximumTurnMs)
    return { state: next, action: "submit" };
  return { state: next, action: "continue" };
}
