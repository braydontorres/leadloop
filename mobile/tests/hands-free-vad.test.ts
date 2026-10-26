import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceVoiceActivity,
  HANDS_FREE_VAD,
  SHORT_CONFIRMATION_VAD,
  voiceActivityEndThreshold,
  newVoiceActivity,
  voiceActivityNoiseFloor,
  voiceActivitySilenceMs,
  voiceActivityThreshold,
  voiceActivityTrailingBackgroundDecision,
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

function firstActionIndex(actions: string[], action: string) {
  return actions.findIndex((current) => current === action);
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

test("the SDK 58 third-turn trace adapts a noisier trailing room level and submits", () => {
  // This mirrors the iPhone diagnostic: startup floor around -56 dBFS, voice
  // around -36 dBFS, then a stable post-speech room level near -46 dBFS.
  const result = runTrace([
    -56,
    -55,
    -56,
    -55,
    -56,
    -38,
    -36,
    -39,
    -37,
    -38,
    ...Array.from(
      { length: 24 },
      (_, index) => [-46.3, -45.7, -46.8, -46.1][index % 4],
    ),
  ]);
  const submitAt = firstActionIndex(result.actions, "submit");
  assert.ok(firstActionIndex(result.actions, "speech_started") >= 0);
  assert.ok(submitAt >= 0, "the trailing room level must end the turn");
  assert.ok(submitAt < 30, "it must not wait through a long stuck recording");
  assert.equal(
    voiceActivityTrailingBackgroundDecision(result.state),
    "adapted_background",
  );
  assert.ok(voiceActivityEndThreshold(result.state) > -45);
});

test("short Yes and No answers submit after stable moderately noisy silence", () => {
  for (const answer of [
    [-38, -35, -37], // Yes
    [-39, -36, -38], // No
  ]) {
    const result = runTrace([
      -57,
      -56,
      -57,
      -56,
      -57,
      ...answer,
      ...Array.from(
        { length: 24 },
        (_, index) => [-46, -47, -45.5, -46.5][index % 4],
      ),
    ]);
    assert.ok(result.actions.includes("speech_started"));
    assert.ok(result.actions.includes("submit"));
  }
});

test("a short confirmation has a bounded context-aware end-of-turn window", () => {
  let state = newVoiceActivity();
  const actions: string[] = [];
  [-58, -58, -58, -58, -58, -43, -42, -43]
    .concat(Array.from({ length: 12 }, () => -58))
    .forEach((db, index) => {
      const result = advanceVoiceActivity(
        state,
        index * 100,
        db,
        SHORT_CONFIRMATION_VAD,
      );
      state = result.state;
      actions.push(result.action);
    });
  assert.ok(actions.includes("speech_started"));
  assert.ok(actions.includes("submit"));
  assert.equal(
    actions.slice(0, 8).includes("submit"),
    false,
    "the word itself must finish before a turn submits",
  );
});

test("a resumed phrase clears a meaningful pause without a premature submit", () => {
  const firstPhrase = [-38, -36, -37];
  const meaningfulPause = Array.from({ length: 8 }, () => -56);
  const secondPhrase = [-37, -35, -38];
  const finalSilence = Array.from({ length: 16 }, () => -56);
  const result = runTrace([
    -56,
    -56,
    -56,
    -56,
    -56,
    ...firstPhrase,
    ...meaningfulPause,
    ...secondPhrase,
    ...finalSilence,
  ]);
  const resumeAt = 5 + firstPhrase.length + meaningfulPause.length;
  const submitAt = firstActionIndex(result.actions, "submit");
  assert.ok(submitAt > resumeAt + secondPhrase.length);
  assert.ok(
    result.actions.slice(0, resumeAt).every((action) => action !== "submit"),
  );
});

test("post-playback recorder starts give each consecutive natural-voice turn a fresh trailing baseline", () => {
  const levelsFor = (ambient: number, speech: number) => [
    ...Array.from({ length: 5 }, () => ambient),
    speech,
    speech + 1,
    speech,
    ...Array.from({ length: 16 }, () => ambient),
  ];
  for (const [ambient, speech] of [
    [-56, -37],
    [-48, -31],
    [-63, -51],
  ]) {
    const result = runTrace(levelsFor(ambient, speech));
    assert.ok(result.actions.includes("speech_started"));
    assert.ok(result.actions.includes("submit"));
  }
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

test("temporary iOS -120 dB startup placeholders wait for a live meter before recovery", () => {
  let state = newVoiceActivity();
  for (const elapsedMs of [0, 500, 1_000, 1_500, 2_000]) {
    const next = advanceVoiceActivity(state, elapsedMs, -120);
    state = next.state;
    assert.equal(next.action, "continue");
  }
  const unavailable = advanceVoiceActivity(
    state,
    HANDS_FREE_VAD.startupPlaceholderGraceMs +
      HANDS_FREE_VAD.meterUnavailableMs,
    -120,
  );
  assert.equal(unavailable.action, "meter_unavailable");

  const live = advanceVoiceActivity(unavailable.state, 4_500, -43);
  assert.notEqual(live.action, "meter_stalled");
});
