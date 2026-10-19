export type VoiceActivityConfig = {
  minimumSignal: number;
  speechHoldMs: number;
  speechGapMs: number;
  silenceMs: number;
  noSpeechMs: number;
  noiseMultiplier: number;
  noiseOffset: number;
};

export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  // RMS samples are normalized from -1..1. This accepts conversational and
  // soft speech while still requiring it to rise above the learned room tone.
  minimumSignal: 0.006,
  speechHoldMs: 100,
  speechGapMs: 100,
  silenceMs: 1_250,
  noSpeechMs: 12_000,
  noiseMultiplier: 1.45,
  noiseOffset: 0.0015,
};

export const SENSITIVE_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  ...DEFAULT_VOICE_ACTIVITY_CONFIG,
  minimumSignal: 0.004,
  speechHoldMs: 80,
  speechGapMs: 140,
  noiseMultiplier: 1.25,
  noiseOffset: 0.001,
};

export const NOISE_RESISTANT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  ...DEFAULT_VOICE_ACTIVITY_CONFIG,
  minimumSignal: 0.022,
  speechHoldMs: 280,
  speechGapMs: 40,
  noiseMultiplier: 2.8,
  noiseOffset: 0.004,
};

export type VoiceActivityState = {
  elapsedMs: number;
  noiseFloor: number;
  peakSignal: number;
  voicedMs: number;
  candidateQuietMs: number;
  quietMs: number;
  speechStarted: boolean;
};

export type VoiceActivityEvent =
  "none" | "speech_started" | "speech_ended" | "no_speech";

export function initialVoiceActivityState(): VoiceActivityState {
  return {
    elapsedMs: 0,
    noiseFloor: 0,
    peakSignal: 0,
    voicedMs: 0,
    candidateQuietMs: 0,
    quietMs: 0,
    speechStarted: false,
  };
}

export function rmsFromTimeDomain(samples: Uint8Array) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

export function advanceVoiceActivity(
  previous: VoiceActivityState,
  rms: number,
  elapsedMs: number,
  config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG,
): { state: VoiceActivityState; event: VoiceActivityEvent } {
  const delta = Math.min(Math.max(elapsedMs, 0), 250);
  const threshold = Math.max(
    config.minimumSignal,
    previous.noiseFloor * config.noiseMultiplier + config.noiseOffset,
  );
  const voiced = rms >= threshold;
  // Learn the room only from frames that were below the current speech
  // threshold. A spoken first frame must never become the noise baseline.
  const noiseFloor = voiced
    ? previous.noiseFloor
    : previous.noiseFloor === 0
      ? rms
      : previous.noiseFloor * 0.92 + rms * 0.08;
  const state: VoiceActivityState = {
    elapsedMs: previous.elapsedMs + delta,
    noiseFloor,
    peakSignal: Math.max(previous.peakSignal, rms),
    // Brief unvoiced gaps occur inside short words such as "yes" and "no".
    // Preserve the candidate until the gap is sustained.
    voicedMs: voiced
      ? previous.voicedMs + delta
      : previous.speechStarted
        ? 0
        : previous.candidateQuietMs + delta > config.speechGapMs
          ? 0
          : previous.voicedMs,
    candidateQuietMs:
      previous.speechStarted || voiced ? 0 : previous.candidateQuietMs + delta,
    quietMs: previous.speechStarted
      ? voiced
        ? 0
        : previous.quietMs + delta
      : 0,
    speechStarted: previous.speechStarted,
  };
  if (!state.speechStarted && state.voicedMs >= config.speechHoldMs) {
    state.speechStarted = true;
    state.quietMs = 0;
    return { state, event: "speech_started" };
  }
  if (state.speechStarted && state.quietMs >= config.silenceMs)
    return { state, event: "speech_ended" };
  if (!state.speechStarted && state.elapsedMs >= config.noSpeechMs)
    return { state, event: "no_speech" };
  return { state, event: "none" };
}
