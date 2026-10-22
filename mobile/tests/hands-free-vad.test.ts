import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceVoiceActivity,
  HANDS_FREE_VAD,
  newVoiceActivity,
  voiceActivitySilenceMs,
  voiceActivityThreshold,
} from "../src/hands-free-vad";

function frame(
  state: ReturnType<typeof newVoiceActivity>,
  ms: number,
  db?: number,
) {
  return advanceVoiceActivity(state, ms, db);
}

test("native average-power speech starts then submits after natural silence", () => {
  let state = newVoiceActivity();
  ({ state } = frame(state, 100, -72));
  ({ state } = frame(state, 200, -56));
  let result = frame(state, 300, -55);
  assert.equal(result.action, "speech_started");
  state = result.state;
  ({ state } = frame(state, 500, -54));
  ({ state } = frame(state, 750, -75));
  assert.equal(voiceActivitySilenceMs(state), 250);
  ({ state } = frame(state, 1_000, -74.2));
  ({ state } = frame(state, 1_250, -75));
  ({ state } = frame(state, 1_500, -74.2));
  ({ state } = frame(state, 1_750, -75));
  result = frame(state, 2_000, -74.2);
  assert.equal(result.action, "submit");
});

test("native average power uses an adaptive quiet-room threshold", () => {
  let state = newVoiceActivity();
  ({ state } = frame(state, 100, -76));
  assert.ok(voiceActivityThreshold(state) <= -60);
  ({ state } = frame(state, 200, -57));
  const result = frame(state, 400, -56);
  assert.equal(result.action, "speech_started");
});

test("unavailable or frozen meters pause instead of leaving a turn listening", () => {
  const unavailable = frame(
    newVoiceActivity(),
    HANDS_FREE_VAD.meterUnavailableMs,
    undefined,
  );
  assert.equal(unavailable.action, "meter_unavailable");

  let frozen = newVoiceActivity();
  ({ state: frozen } = frame(frozen, 100, -160));
  const stalled = frame(frozen, HANDS_FREE_VAD.meterStalledMs + 200, -160);
  assert.equal(stalled.action, "meter_stalled");
});

test("a frozen meter after speech is actionable rather than blocking silence forever", () => {
  let state = newVoiceActivity();
  ({ state } = frame(state, 100, -75));
  ({ state } = frame(state, 200, -55));
  ({ state } = frame(state, 400, -55));
  const result = frame(state, HANDS_FREE_VAD.meterStalledMs + 500, -55);
  assert.equal(result.action, "meter_stalled");
});

test("silence without speech remains a retry rather than creating a turn", () => {
  let state = newVoiceActivity();
  let result = frame(state, 0, -75);
  for (
    let elapsed = 100;
    elapsed <= HANDS_FREE_VAD.noSpeechTimeoutMs;
    elapsed += 100
  ) {
    result = frame(result.state, elapsed, elapsed % 200 === 0 ? -74.2 : -75);
  }
  assert.equal(result.action, "retry_silence");
});
