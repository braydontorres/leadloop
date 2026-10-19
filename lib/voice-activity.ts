export type VoiceActivityConfig = {
  minimumSignal: number;
  speechHoldMs: number;
  silenceMs: number;
  noSpeechMs: number;
};

export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  // RMS samples are normalized from -1..1. The adaptive noise floor handles
  // quiet rooms while this lower bound rejects browser/microphone hiss.
  minimumSignal: 0.012,
  speechHoldMs: 160,
  silenceMs: 1_250,
  noSpeechMs: 12_000,
};

export type VoiceActivityState = {
  elapsedMs: number;
  noiseFloor: number;
  voicedMs: number;
  quietMs: number;
  speechStarted: boolean;
};

export type VoiceActivityEvent =
  "none" | "speech_started" | "speech_ended" | "no_speech";

export function initialVoiceActivityState(): VoiceActivityState {
  return {
    elapsedMs: 0,
    noiseFloor: 0,
    voicedMs: 0,
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
    previous.noiseFloor * 2.8 + 0.004,
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
    voicedMs: voiced ? previous.voicedMs + delta : 0,
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
