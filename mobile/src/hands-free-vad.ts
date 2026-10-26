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
  // Once speech has begun, iOS can report a different steady room level than
  // it did during recorder startup (for example after assistant playback).
  // Learn that level only from a sustained, low-variance tail so a spoken
  // phrase or brief pause cannot become the end-of-turn baseline.
  trailingBackgroundWindowMs: 400,
  // Poll callbacks are not aligned to an exact 400 ms boundary. Retain one
  // additional maximum frame so a valid 400 ms quiet span is still observable
  // after the sample that began it would otherwise have rolled out.
  trailingBackgroundRetentionMs: 650,
  trailingBackgroundMaxSpreadDb: 4,
  strongSpeechMarginDb: 3,
  speechHoldMs: 180,
  speechGapMs: 140,
  endSilenceMs: 1_200,
  noSpeechTimeoutMs: 12_000,
  meterUnavailableMs: 2_000,
  meterStalledMs: 2_500,
  // AVAudioRecorder can transiently report its floor value while iOS restores
  // the recording route after assistant playback. Wait for a live meter before
  // treating that placeholder as a failed recorder.
  startupPlaceholderDb: -118,
  startupPlaceholderGraceMs: 2_200,
  meterChangeEpsilonDb: 0.5,
  maxFrameMs: 250,
} as const;

export type VoiceActivityState = {
  activity: { speechStarted: boolean; quietMs: number };
  ambientDb: number | null;
  endAmbientDb: number | null;
  trailingSamples: Array<{ elapsedMs: number; meterDb: number }>;
  trailingBackgroundDecision:
    "start_baseline" | "learning_background" | "adapted_background";
  speechStartedAtMs: number | null;
  lastStrongSpeechAtMs: number | null;
  strongSpeechMs: number;
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

/**
 * A confirmation is only accepted in a completed read-back state. It can use
 * a modestly shorter qualification/silence window because "Yes" and "No"
 * are often much shorter than an initial reminder sentence.
 */
export const SHORT_CONFIRMATION_VAD = {
  speechHoldMs: 120,
  endSilenceMs: 1_000,
} as const;

export type VoiceActivityOptions = {
  speechHoldMs?: number;
  endSilenceMs?: number;
};

export function newVoiceActivity(): VoiceActivityState {
  return {
    activity: { speechStarted: false, quietMs: 0 },
    ambientDb: null,
    endAmbientDb: null,
    trailingSamples: [],
    trailingBackgroundDecision: "start_baseline",
    speechStartedAtMs: null,
    lastStrongSpeechAtMs: null,
    strongSpeechMs: 0,
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

/** The trailing background is used only after speech begins to end a turn. */
export function voiceActivityEndThreshold(state: VoiceActivityState) {
  const ambient = state.endAmbientDb ?? voiceActivityNoiseFloor(state);
  return ambient + HANDS_FREE_VAD.endMarginDb;
}

export function voiceActivityTrailingBackgroundDecision(
  state: VoiceActivityState,
) {
  return state.trailingBackgroundDecision;
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

function trailingSampleSpread(
  samples: Array<{ elapsedMs: number; meterDb: number }>,
) {
  if (samples.length === 0) return Infinity;
  const levels = samples.map((sample) => sample.meterDb);
  return Math.max(...levels) - Math.min(...levels);
}

function updateTrailingBackground(input: {
  previous: VoiceActivityState;
  meter: number;
  elapsedMs: number;
  speechStarted: boolean;
  speechStartedAtMs: number | null;
  startThreshold: number;
  speechHoldMs: number;
}) {
  if (!input.speechStarted)
    return {
      endAmbientDb: null,
      trailingSamples: [],
      trailingBackgroundDecision: "start_baseline" as const,
      speechStartedAtMs: null,
      lastStrongSpeechAtMs: null,
      strongSpeechMs: 0,
    };

  const startedAt = input.speechStartedAtMs ?? input.elapsedMs;
  const strongFrame =
    input.meter >= input.startThreshold + HANDS_FREE_VAD.strongSpeechMarginDb;
  const strongSpeechMs = strongFrame
    ? input.previous.strongSpeechMs +
      Math.min(
        HANDS_FREE_VAD.maxFrameMs,
        Math.max(0, input.elapsedMs - input.previous.lastElapsedMs),
      )
    : 0;
  // A single loud fan click or meter spike is not enough to discard a useful
  // trailing-noise window. Require the same temporal evidence used for speech
  // qualification before treating frames as an active speech continuation.
  const strongSpeechEvidence = strongSpeechMs >= input.speechHoldMs;
  const lastStrongSpeechAtMs = strongSpeechEvidence
    ? input.elapsedMs
    : (input.previous.lastStrongSpeechAtMs ?? startedAt);
  const trailingSamples = strongSpeechEvidence
    ? []
    : (strongFrame
        ? input.previous.trailingSamples
        : [
            ...input.previous.trailingSamples,
            { elapsedMs: input.elapsedMs, meterDb: input.meter },
          ]
      ).filter(
        (sample) =>
          input.elapsedMs - sample.elapsedMs <=
          HANDS_FREE_VAD.trailingBackgroundRetentionMs,
      );
  const hasStableWindow =
    trailingSamples.length >= 3 &&
    input.elapsedMs - trailingSamples[0].elapsedMs >=
      HANDS_FREE_VAD.trailingBackgroundWindowMs &&
    input.elapsedMs - lastStrongSpeechAtMs >=
      HANDS_FREE_VAD.trailingBackgroundWindowMs &&
    trailingSampleSpread(trailingSamples) <=
      HANDS_FREE_VAD.trailingBackgroundMaxSpreadDb;
  if (!hasStableWindow)
    return {
      endAmbientDb: input.previous.endAmbientDb,
      trailingSamples,
      trailingBackgroundDecision: strongSpeechEvidence
        ? ("start_baseline" as const)
        : ("learning_background" as const),
      speechStartedAtMs: startedAt,
      lastStrongSpeechAtMs,
      strongSpeechMs,
    };
  // A direct median update is intentional: its only input is an independently
  // sustained, low-variance window after strong speech has stopped. A slow
  // blend leaves the old startup floor in control for too long on iOS.
  return {
    endAmbientDb: median(trailingSamples.map((sample) => sample.meterDb)),
    trailingSamples,
    trailingBackgroundDecision: "adapted_background" as const,
    speechStartedAtMs: startedAt,
    lastStrongSpeechAtMs,
    strongSpeechMs,
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
  options: VoiceActivityOptions = {},
): { state: VoiceActivityState; action: VoiceActivityAction } {
  const speechHoldMs = options.speechHoldMs ?? HANDS_FREE_VAD.speechHoldMs;
  const endSilenceMs = options.endSilenceMs ?? HANDS_FREE_VAD.endSilenceMs;
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
  if (!state.sawMeter && meter <= HANDS_FREE_VAD.startupPlaceholderDb) {
    return {
      state: { ...state, lastElapsedMs: elapsedMs },
      action:
        elapsedMs >=
        HANDS_FREE_VAD.startupPlaceholderGraceMs +
          HANDS_FREE_VAD.meterUnavailableMs
          ? "meter_unavailable"
          : "continue",
    };
  }
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
    if (candidateSpeechMs >= speechHoldMs) {
      speechStarted = true;
      quietMs = 0;
      action = "speech_started";
    } else if (elapsedMs >= HANDS_FREE_VAD.noSpeechTimeoutMs) {
      action = "retry_silence";
    }
  }
  const trailing = updateTrailingBackground({
    previous: state,
    meter,
    elapsedMs,
    speechStarted,
    speechStartedAtMs:
      speechStarted && !state.activity.speechStarted
        ? elapsedMs
        : state.speechStartedAtMs,
    startThreshold,
    speechHoldMs,
  });
  const endThreshold =
    (trailing.endAmbientDb ?? ambientBefore) + HANDS_FREE_VAD.endMarginDb;
  if (speechStarted && meter <= endThreshold) {
    quietMs += deltaMs;
  } else if (speechStarted && trailing.strongSpeechMs >= speechHoldMs) {
    // Several strong voice-like frames prove the person resumed speaking;
    // discard a prior natural pause without letting one fan click do so.
    quietMs = 0;
  } else if (speechStarted) {
    // A one-frame fan click or distant voice should not erase all silence.
    quietMs = Math.max(0, quietMs - deltaMs * 0.4);
  }
  if (speechStarted && quietMs >= endSilenceMs) action = "submit";

  return {
    state: {
      activity: { speechStarted, quietMs },
      ambientDb: ambient.ambientDb,
      endAmbientDb: trailing.endAmbientDb,
      trailingSamples: trailing.trailingSamples,
      trailingBackgroundDecision: trailing.trailingBackgroundDecision,
      speechStartedAtMs: trailing.speechStartedAtMs,
      lastStrongSpeechAtMs: trailing.lastStrongSpeechAtMs,
      strongSpeechMs: trailing.strongSpeechMs,
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
