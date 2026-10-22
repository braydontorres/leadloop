import {
  advanceVoiceActivity as advanceRmsVoiceActivity,
  initialVoiceActivityState,
  type VoiceActivityConfig,
  type VoiceActivityState as RmsVoiceActivityState,
} from "../../lib/voice-activity";

/**
 * AVAudioRecorder exposes a windowed average power in dBFS, rather than the
 * Web Audio analyser's instantaneous RMS samples. Convert it to linear signal
 * energy, then use the same adaptive state machine as the web Capture flow.
 */
export const HANDS_FREE_VAD = {
  // -60 dBFS is a conservative floor for iOS *average* power. The old -48 dB
  // absolute gate excluded normal conversational readings before silence could
  // ever be measured. The adaptive noise floor still raises this in loud rooms.
  minimumSignalDb: -60,
  speechHoldMs: 180,
  speechGapMs: 140,
  endSilenceMs: 1_200,
  noSpeechTimeoutMs: 12_000,
  noiseMultiplier: 1.6,
  noiseOffset: 0.0005,
  meterUnavailableMs: 2_000,
  meterStalledMs: 2_500,
  meterChangeEpsilonDb: 0.5,
} as const;

const config: VoiceActivityConfig = {
  minimumSignal: Math.pow(10, HANDS_FREE_VAD.minimumSignalDb / 20),
  speechHoldMs: HANDS_FREE_VAD.speechHoldMs,
  speechGapMs: HANDS_FREE_VAD.speechGapMs,
  silenceMs: HANDS_FREE_VAD.endSilenceMs,
  noSpeechMs: HANDS_FREE_VAD.noSpeechTimeoutMs,
  noiseMultiplier: HANDS_FREE_VAD.noiseMultiplier,
  noiseOffset: HANDS_FREE_VAD.noiseOffset,
};

export type VoiceActivityState = {
  activity: RmsVoiceActivityState;
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
    activity: initialVoiceActivityState(),
    lastElapsedMs: 0,
    lastMeterDb: null,
    lastMeterChangeAtMs: null,
    sawMeter: false,
  };
}

function clampMeter(value: number) {
  return Math.max(-120, Math.min(0, value));
}

function dbToSignal(value: number) {
  return Math.pow(10, clampMeter(value) / 20);
}

function signalToDb(value: number) {
  if (value <= 0) return -120;
  return 20 * Math.log10(value);
}

export function voiceActivityThreshold(state: VoiceActivityState) {
  return signalToDb(
    Math.max(
      config.minimumSignal,
      state.activity.noiseFloor * config.noiseMultiplier + config.noiseOffset,
    ),
  );
}

export function voiceActivityNoiseFloor(state: VoiceActivityState) {
  return signalToDb(state.activity.noiseFloor);
}

export function voiceActivitySilenceMs(state: VoiceActivityState) {
  return state.activity.quietMs;
}

/**
 * This detects activity, not speaker identity. A single turn starts only after
 * sustained signal, then submits after sustained silence. It is deterministic
 * for a recorder duration/meter sequence and does not submit twice itself.
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

  const deltaMs = Math.max(0, elapsedMs - state.lastElapsedMs);
  const update = advanceRmsVoiceActivity(
    state.activity,
    dbToSignal(meter),
    deltaMs,
    config,
  );
  const next: VoiceActivityState = {
    activity: update.state,
    lastElapsedMs: elapsedMs,
    lastMeterDb: meter,
    lastMeterChangeAtMs,
    sawMeter: true,
  };
  switch (update.event) {
    case "speech_started":
      return { state: next, action: "speech_started" };
    case "speech_ended":
      return { state: next, action: "submit" };
    case "no_speech":
      return { state: next, action: "retry_silence" };
    default:
      return { state: next, action: "continue" };
  }
}
