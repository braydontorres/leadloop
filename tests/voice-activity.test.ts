import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceVoiceActivity,
  initialVoiceActivityState,
  rmsFromTimeDomain,
  type VoiceActivityState,
} from "../lib/voice-activity";

function frames(values: number[]) {
  let state: VoiceActivityState = initialVoiceActivityState();
  const events: string[] = [];
  for (const value of values) {
    const next = advanceVoiceActivity(state, value, 100, {
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

test("noise-resistant mode rejects a louder steady background floor", () => {
  let state: VoiceActivityState = initialVoiceActivityState();
  let lastEvent = "none";
  for (let index = 0; index < 12; index += 1) {
    const next = advanceVoiceActivity(state, 0.02, 100, {
      minimumSignal: 0.022,
      speechHoldMs: 280,
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
