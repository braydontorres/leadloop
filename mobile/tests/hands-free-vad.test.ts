import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceVoiceActivity,
  HANDS_FREE_VAD,
  newVoiceActivity,
  voiceActivityNoiseFloor,
  voiceActivitySilenceMs,
  voiceActivityThreshold,
} from "../src/hands-free-vad";

function runTrace(levels: number[]) {
  let state = newVoiceActivity();
  const actions: string[] = [];
  levels.forEach((db, index) => {
    const next = advanceVoiceActivity(state, index * 100, db);
    state = next.state;
    actions.push(next.action);
  });
  return { state, actions };
}

test("iOS room baseline, speech, and ambient silence produce speech_started then submit", () => {
  const quietRoom = Array.from({ length: 6 }, () => -44);
  const speech = [-34, -33, -32, -34, -33, -35];
  const afterSpeech = Array.from({ length: 21 }, (_, index) =>
    index % 4 === 0 ? -39 : -44,
  );
  const result = runTrace([...quietRoom, ...speech, ...afterSpeech]);
  assert.ok(result.actions.includes("speech_started"));
  assert.equal(result.actions.at(-1), "submit");
  assert.ok(voiceActivityNoiseFloor(result.state) > -48);
  assert.ok(voiceActivityThreshold(result.state) > -42);
});

test("a stale iOS startup floor does not pin the learned room baseline", () => {
  const result = runTrace([
    -120,
    -44,
    -44,
    -44,
    -44,
    -34,
    -33,
    -34,
    ...Array.from({ length: 14 }, () => -44),
  ]);
  assert.ok(voiceActivityNoiseFloor(result.state) > -50);
  assert.ok(result.actions.includes("speech_started"));
  assert.equal(result.actions.at(-1), "submit");
});

test("soft speech remains detectable above a learned quiet-room baseline", () => {
  const result = runTrace([
    -69,
    -68,
    -69,
    -69,
    -68,
    -59,
    -58,
    -58,
    ...Array.from({ length: 14 }, () => -69),
  ]);
  assert.ok(result.actions.includes("speech_started"));
  assert.equal(result.actions.at(-1), "submit");
});

test("fan or air-conditioner noise calibrates as ambient instead of continuous speech", () => {
  const result = runTrace(
    Array.from({ length: 123 }, (_, index) => (index % 5 === 0 ? -47 : -49)),
  );
  assert.equal(result.actions.includes("speech_started"), false);
  assert.equal(result.actions.at(-1), "retry_silence");
});

test("intermittent background noise does not erase accumulated end-of-speech silence", () => {
  const result = runTrace([
    -50,
    -50,
    -50,
    -50,
    -50,
    -38,
    -37,
    -37,
    ...Array.from({ length: 16 }, (_, index) =>
      index === 4 || index === 10 ? -38 : -50,
    ),
  ]);
  assert.ok(result.actions.includes("speech_started"));
  assert.equal(result.actions.at(-1), "submit");
});

test("loud speech followed by quiet frames advances silence instead of remaining continuous", () => {
  const result = runTrace([
    -46,
    -46,
    -46,
    -46,
    -46,
    -23,
    -22,
    -24,
    ...Array.from({ length: 14 }, () => -46),
  ]);
  assert.ok(result.actions.includes("speech_started"));
  assert.equal(result.actions.at(-1), "submit");
  assert.ok(
    voiceActivitySilenceMs(result.state) >= HANDS_FREE_VAD.endSilenceMs,
  );
});

test("multiple turns receive independent ambient calibration", () => {
  const first = runTrace([
    -60,
    -60,
    -60,
    -60,
    -60,
    -48,
    -48,
    -48,
    ...Array.from({ length: 14 }, () => -60),
  ]);
  const second = runTrace([
    -43,
    -43,
    -43,
    -43,
    -43,
    -31,
    -31,
    -31,
    ...Array.from({ length: 14 }, () => -43),
  ]);
  assert.equal(first.actions.at(-1), "submit");
  assert.equal(second.actions.at(-1), "submit");
});

test("unavailable or frozen meters remain explicit recovery states", () => {
  const unavailable = advanceVoiceActivity(
    newVoiceActivity(),
    HANDS_FREE_VAD.meterUnavailableMs,
    undefined,
  );
  assert.equal(unavailable.action, "meter_unavailable");

  let state = newVoiceActivity();
  ({ state } = advanceVoiceActivity(state, 100, -52));
  const frozen = advanceVoiceActivity(
    state,
    HANDS_FREE_VAD.meterStalledMs + 200,
    -52,
  );
  assert.equal(frozen.action, "meter_stalled");
});
