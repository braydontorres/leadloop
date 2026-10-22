/**
 * iOS AVAudioRecorder reports windowed average power in dBFS. That is not an
 * RMS analyser stream: converting it to linear values and applying the web
 * threshold made ordinary room readings look like continuous speech.
 *
 * This detector learns an ambient dB baseline, uses separate start/end
 * thresholds, and lets isolated loud background frames decay rather than
 * resetting an already-running silence window.
 */
export const HANDS_FREE_VAD = {
  calibrationMs: 350,
  // This protects someone who speaks immediately, before a quiet calibration
  // sample arrives. It is not the ongoing speech threshold.
  initialAmbientCeilingDb: -50,
  startMarginDb: 8,
  endMarginDb: 3,
  speechHoldMs: 180,
  speechGapMs: 140,
  endSilenceMs: 1_200,
  noSpeechTimeoutMs: 12_000,
  meterUnavailableMs: 2_000,
  meterStalledMs: 2_500,
  meterChangeEpsilonDb: 0.5,
  maxFrameMs: 250,
} as const;

export type VoiceActivityState = {
  activity: { speechStarted: boolean; quietMs: number };
  ambientDb: number | null;
  calibrationSamples: number[];
  calibrationComplete: boolean;
  candidateSpeechMs: number;
  candidateGapMs: number;
  lastElapsedMs: number;
  lastMeterDb: number | null;
  lastMeterChangeAtMs: number | null;
  sawMeter: boolean;
};

export type VoiceActivityAction =
  | "continue"
  | "speech_started"
  | "submit"
  | "retry_silence"
  | "meter_unavailable"
  | "meter_stalled";

export function newVoiceActivity(): VoiceActivityState {
  return {
    activity: { speechStarted: false, quietMs: 0 },
    ambientDb: null,
    calibrationSamples: [],
    calibrationComplete: false,
    candidateSpeechMs: 0,
    candidateGapMs: 0,
    lastElapsedMs: 0,
    lastMeterDb: null,
    lastMeterChangeAtMs: null,
    sawMeter: false,
  };
}

function clampMeter(value: number) {
  return Math.max(-120, Math.min(0, value));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function calibrationAmbient(state: VoiceActivityState) {
  if (state.calibrationSamples.length === 0)
    return HANDS_FREE_VAD.initialAmbientCeilingDb;
  // AVAudioRecorder can report one startup -120 dB sample before it begins
  // delivering live average power. A median makes that one stale sample
  // harmless while still allowing a truly quiet room to calibrate quietly.
  return median(state.calibrationSamples);
}

function effectiveAmbient(state: VoiceActivityState, elapsedMs: number) {
  if (elapsedMs < HANDS_FREE_VAD.calibrationMs)
    return HANDS_FREE_VAD.initialAmbientCeilingDb;
  return state.ambientDb ?? calibrationAmbient(state);
}

export function voiceActivityThreshold(state: VoiceActivityState) {
  return (
    effectiveAmbient(state, state.lastElapsedMs) + HANDS_FREE_VAD.startMarginDb
  );
}

export function voiceActivityNoiseFloor(state: VoiceActivityState) {
  return effectiveAmbient(state, state.lastElapsedMs);
}

export function voiceActivitySilenceMs(state: VoiceActivityState) {
  return state.activity.quietMs;
}

function updateAmbient(
  previous: VoiceActivityState,
  meter: number,
  elapsedMs: number,
  isCandidateSpeech: boolean,
) {
  const calibrationSamples = previous.calibrationComplete
    ? previous.calibrationSamples
    : [...previous.calibrationSamples, meter].slice(-8);
  if (elapsedMs < HANDS_FREE_VAD.calibrationMs) {
    return {
      ambientDb: calibrationAmbient({ ...previous, calibrationSamples }),
      calibrationSamples,
    };
  }
  if (!previous.calibrationComplete) {
    return {
      ambientDb: calibrationAmbient({ ...previous, calibrationSamples }),
      calibrationSamples,
    };
  }
  const baseline =
    previous.ambientDb ??
    calibrationAmbient({ ...previous, calibrationSamples });
  if (previous.activity.speechStarted || isCandidateSpeech) {
    return { ambientDb: baseline, calibrationSamples };
  }
  // Adapt down quickly to a quieter room and up gradually when a fan/AC
  // starts, so background sound cannot instantly become the speech baseline.
  const alpha = meter < baseline ? 0.25 : 0.05;
  return {
    ambientDb: baseline + (meter - baseline) * alpha,
    calibrationSamples,
  };
}

/**
 * Detects activity, not speaker identity. If background speech is as loud as
 * the user, the phone cannot safely identify a speaker; it waits for a quiet
 * interval instead of inventing a turn boundary.
 */
export function advanceVoiceActivity(
  state: VoiceActivityState,
  elapsedMs: number,
  meterDb: number | undefined,
): { state: VoiceActivityState; action: VoiceActivityAction } {
  if (!Number.isFinite(meterDb)) {
    return {
      state: { ...state, lastElapsedMs: elapsedMs },
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
    elapsedMs >= HANDS_FREE_VAD.meterStalledMs &&
    elapsedMs - lastMeterChangeAtMs >= HANDS_FREE_VAD.meterStalledMs
  ) {
    return {
      state: {
        ...state,
        lastElapsedMs: elapsedMs,
        lastMeterDb: meter,
        lastMeterChangeAtMs,
        sawMeter: true,
      },
      action: "meter_stalled",
    };
  }

  const deltaMs = Math.min(
    HANDS_FREE_VAD.maxFrameMs,
    Math.max(0, elapsedMs - state.lastElapsedMs),
  );
  const ambientBefore = effectiveAmbient(state, elapsedMs);
  const startThreshold = ambientBefore + HANDS_FREE_VAD.startMarginDb;
  const endThreshold = ambientBefore + HANDS_FREE_VAD.endMarginDb;
  const candidateSpeech = meter >= startThreshold;
  const ambient = updateAmbient(state, meter, elapsedMs, candidateSpeech);

  let speechStarted = state.activity.speechStarted;
  let candidateSpeechMs = state.candidateSpeechMs;
  let candidateGapMs = state.candidateGapMs;
  let quietMs = state.activity.quietMs;
  let action: VoiceActivityAction = "continue";

  if (!speechStarted) {
    if (candidateSpeech) {
      candidateSpeechMs += deltaMs;
      candidateGapMs = 0;
    } else {
      candidateGapMs += deltaMs;
      if (candidateGapMs > HANDS_FREE_VAD.speechGapMs) candidateSpeechMs = 0;
    }
    if (candidateSpeechMs >= HANDS_FREE_VAD.speechHoldMs) {
      speechStarted = true;
      quietMs = 0;
      action = "speech_started";
    } else if (elapsedMs >= HANDS_FREE_VAD.noSpeechTimeoutMs) {
      action = "retry_silence";
    }
  } else if (meter <= endThreshold) {
    quietMs += deltaMs;
  } else {
    // A one-frame fan click or distant voice should not erase all silence.
    quietMs = Math.max(0, quietMs - deltaMs * 0.4);
  }
  if (speechStarted && quietMs >= HANDS_FREE_VAD.endSilenceMs)
    action = "submit";

  return {
    state: {
      activity: { speechStarted, quietMs },
      ambientDb: ambient.ambientDb,
      calibrationSamples: ambient.calibrationSamples,
      calibrationComplete:
        state.calibrationComplete || elapsedMs >= HANDS_FREE_VAD.calibrationMs,
      candidateSpeechMs,
      candidateGapMs,
      lastElapsedMs: elapsedMs,
      lastMeterDb: meter,
      lastMeterChangeAtMs,
      sawMeter: true,
    },
    action,
  };
}
