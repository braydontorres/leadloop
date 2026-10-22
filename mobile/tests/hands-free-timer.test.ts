import assert from "node:assert/strict";
import test from "node:test";
import {
  HandsFreeTurnTimer,
  type HandsFreeTimerDriver,
} from "../src/hands-free-timer";

function fakeDriver() {
  let callback: (() => void) | null = null;
  let cleared = 0;
  const driver: HandsFreeTimerDriver = {
    setInterval(next) {
      callback = next;
      return "timer";
    },
    clearInterval() {
      cleared += 1;
      callback = null;
    },
  };
  return { driver, fire: () => callback?.(), cleared: () => cleared };
}

test("a hands-free timer ticks independently of recorder state and stops cleanly", () => {
  const fake = fakeDriver();
  const timer = new HandsFreeTurnTimer(fake.driver);
  let ticks = 0;
  timer.start(() => {
    ticks += 1;
  }, 100);
  assert.equal(timer.running, true);
  assert.equal(ticks, 1);
  fake.fire();
  fake.fire();
  assert.equal(ticks, 3);
  timer.stop();
  assert.equal(timer.running, false);
  fake.fire();
  assert.equal(ticks, 3);
  assert.equal(fake.cleared(), 1);
});

test("starting a new turn replaces the prior timer instead of overlapping ticks", () => {
  const fake = fakeDriver();
  const timer = new HandsFreeTurnTimer(fake.driver);
  let first = 0;
  let second = 0;
  timer.start(() => {
    first += 1;
  }, 100);
  timer.start(() => {
    second += 1;
  }, 100);
  fake.fire();
  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(fake.cleared(), 1);
});
