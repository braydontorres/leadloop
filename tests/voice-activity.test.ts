import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceVoiceActivity,
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  initialVoiceActivityState,
  NOISE_RESISTANT_VOICE_ACTIVITY_CONFIG,
  rmsFromTimeDomain,
  SENSITIVE_VOICE_ACTIVITY_CONFIG,
  type VoiceActivityState,
} from "../lib/voice-activity";

function frames(values: number[]) {
  let state: VoiceActivityState = initialVoiceActivityState();
  const events: string[] = [];
  for (const value of values) {
    const next = advanceVoiceActivity(state, value, 100, {
      ...DEFAULT_VOICE_ACTIVITY_CONFIG,
      minimumSignal: 0.012,
      speechHoldMs: 200,
      silenceMs: 1_200,
      noSpeechMs: 1_000,
    });
    state = next.state;
    if (next.event !== "none") events.push(next.event);
  }
  return events;
}

test("voice activity waits through a brief pause and ends after sustained silence", () => {
  const events = frames([
    0.001, 0.04, 0.04, 0.001, 0.001, 0.04, 0.04, 0.001, 0.001, 0.001, 0.001,
    0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001,
  ]);
  assert.deepEqual(events, ["speech_started", "speech_ended"]);
});

test("background noise without sustained speech never submits", () => {
  const events = frames(Array.from({ length: 10 }, () => 0.003));
  assert.deepEqual(events, ["no_speech"]);
});

test("normal and short quiet speech qualify on the first attempt", () => {
  let state: VoiceActivityState = initialVoiceActivityState();
  const first = advanceVoiceActivity(state, 0.007, 50);
  state = first.state;
  const second = advanceVoiceActivity(state, 0.007, 50);
  assert.equal(second.event, "speech_started");

  const shortReply = advanceVoiceActivity(
    initialVoiceActivityState(),
    0.007,
    100,
  );
  assert.equal(shortReply.event, "speech_started");
});

test("quiet normal speech rises above a learned quiet-room floor", () => {
  let state = initialVoiceActivityState();
  state = advanceVoiceActivity(
    state,
    0.003,
    100,
    DEFAULT_VOICE_ACTIVITY_CONFIG,
  ).state;
  const speech = advanceVoiceActivity(
    state,
    0.007,
    100,
    DEFAULT_VOICE_ACTIVITY_CONFIG,
  );
  assert.equal(speech.event, "speech_started");
});

test("a brief gap in a short answer does not erase speech qualification", () => {
  let state = initialVoiceActivityState();
  state = advanceVoiceActivity(state, 0.007, 50).state;
  state = advanceVoiceActivity(state, 0.001, 40).state;
  const resumed = advanceVoiceActivity(state, 0.007, 50);
  assert.equal(resumed.event, "speech_started");
});

test("sensitive mode accepts a soft-spoken response without becoming the default", () => {
  const sensitive = advanceVoiceActivity(
    initialVoiceActivityState(),
    0.0045,
    80,
    SENSITIVE_VOICE_ACTIVITY_CONFIG,
  );
  assert.equal(sensitive.event, "speech_started");
  const standard = advanceVoiceActivity(
    initialVoiceActivityState(),
    0.0045,
    80,
    DEFAULT_VOICE_ACTIVITY_CONFIG,
  );
  assert.equal(standard.event, "none");
});

test("noise-resistant mode rejects a louder steady background floor", () => {
  let state: VoiceActivityState = initialVoiceActivityState();
  let lastEvent = "none";
  for (let index = 0; index < 12; index += 1) {
    const next = advanceVoiceActivity(state, 0.02, 100, {
      ...NOISE_RESISTANT_VOICE_ACTIVITY_CONFIG,
      silenceMs: 1_200,
      noSpeechMs: 1_000,
    });
    state = next.state;
    lastEvent = next.event;
  }
  assert.equal(state.speechStarted, false);
  assert.equal(lastEvent, "no_speech");
});

test("RMS measurement distinguishes silence from voice energy", () => {
  assert.equal(rmsFromTimeDomain(new Uint8Array([128, 128, 128])), 0);
  assert.ok(rmsFromTimeDomain(new Uint8Array([96, 160, 96, 160])) > 0.2);
});
