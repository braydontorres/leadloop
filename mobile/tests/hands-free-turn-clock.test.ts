import assert from "node:assert/strict";
import test from "node:test";
import {
  handsFreeElapsedMs,
  isFreshHandsFreeStatus,
  monotonicNowMs,
} from "../src/hands-free-turn-clock";
import { advanceVoiceActivity, newVoiceActivity } from "../src/hands-free-vad";

test("the hands-free clock advances when native duration remains frozen at zero", () => {
  const startedAt = 10_000;
  assert.equal(handsFreeElapsedMs(startedAt, startedAt), 0);
  assert.equal(handsFreeElapsedMs(startedAt, startedAt + 1_300), 1_300);
  assert.equal(handsFreeElapsedMs(startedAt, startedAt - 1), 0);
});

test("the turn clock reads a finite monotonic JavaScript time source", () => {
  assert.equal(Number.isFinite(monotonicNowMs()), true);
});

test("fresh meter readings drive a complete turn even when native duration is frozen", () => {
  let state = newVoiceActivity();
  // Each elapsed value below comes from the JS turn clock; native duration is
  // deliberately not involved and may stay at zero on Expo Go.
  ({ state } = advanceVoiceActivity(state, 100, -75));
  ({ state } = advanceVoiceActivity(state, 250, -55));
  let result = advanceVoiceActivity(state, 450, -54);
  assert.equal(result.action, "speech_started");
  ({ state } = advanceVoiceActivity(result.state, 700, -75));
  ({ state } = advanceVoiceActivity(state, 1_000, -74.2));
  ({ state } = advanceVoiceActivity(state, 1_300, -75));
  ({ state } = advanceVoiceActivity(state, 1_600, -74.2));
  result = advanceVoiceActivity(state, 1_900, -75);
  assert.equal(result.action, "submit");
});

test("a stale status cannot be attributed to a new recording turn", () => {
  assert.equal(isFreshHandsFreeStatus(9_999, 10_000), false);
  assert.equal(isFreshHandsFreeStatus(10_000, 10_000), true);
  assert.equal(isFreshHandsFreeStatus(null, 10_000), false);
});
