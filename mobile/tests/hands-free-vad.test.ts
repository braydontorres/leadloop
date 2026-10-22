import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceVoiceActivity,
  HANDS_FREE_VAD,
  newVoiceActivity,
} from "../src/hands-free-vad";

function frame(
  state: ReturnType<typeof newVoiceActivity>,
  ms: number,
  db?: number,
) {
  return advanceVoiceActivity(state, ms, db);
}

test("sustained speech ends one hands-free turn only after natural silence", () => {
  let state = newVoiceActivity();
  ({ state } = frame(state, 100, -35));
  let result = frame(state, 300, -32);
  assert.equal(result.action, "speech_started");
  state = result.state;
  ({ state } = frame(state, 800, -34));
  result = frame(state, 1_700, -70);
  assert.equal(result.action, "continue");
  result = frame(result.state, 2_100, -70);
  assert.equal(result.action, "submit");
});

test("silence, unavailable metering, and maximum duration never create duplicate submissions", () => {
  let silent = newVoiceActivity();
  const silence = frame(silent, HANDS_FREE_VAD.noSpeechTimeoutMs, -80);
  assert.equal(silence.action, "retry_silence");

  const unavailable = frame(
    newVoiceActivity(),
    HANDS_FREE_VAD.meterUnavailableMs,
    undefined,
  );
  assert.equal(unavailable.action, "meter_unavailable");

  let speaking = newVoiceActivity();
  ({ state: speaking } = frame(speaking, 100, -30));
  ({ state: speaking } = frame(speaking, 300, -30));
  const maximum = frame(speaking, HANDS_FREE_VAD.maximumTurnMs, -30);
  assert.equal(maximum.action, "submit");
});
