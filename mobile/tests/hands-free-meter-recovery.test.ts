import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunMeterRecovery,
  HANDS_FREE_METER_RECOVERY,
  shouldRecoverMeter,
} from "../src/hands-free-meter-recovery";

test("a startup meter failure receives one bounded recovery before an error", () => {
  assert.equal(
    shouldRecoverMeter({
      action: "meter_stalled",
      speechStarted: false,
      attempts: 0,
    }),
    true,
  );
  assert.equal(
    shouldRecoverMeter({
      action: "meter_unavailable",
      speechStarted: false,
      attempts: HANDS_FREE_METER_RECOVERY.maxAttemptsPerSession,
    }),
    false,
  );
  assert.equal(
    shouldRecoverMeter({
      action: "meter_stalled",
      speechStarted: true,
      attempts: 0,
    }),
    false,
  );
});

test("an ended conversation or a replacement turn cannot revive recovery capture", () => {
  assert.equal(
    canRunMeterRecovery({
      active: true,
      scheduledSessionId: 4,
      currentSessionId: 4,
      scheduledTurn: 9,
      activeTurn: null,
    }),
    true,
  );
  assert.equal(
    canRunMeterRecovery({
      active: false,
      scheduledSessionId: 4,
      currentSessionId: 5,
      scheduledTurn: 9,
      activeTurn: null,
    }),
    false,
  );
  assert.equal(
    canRunMeterRecovery({
      active: true,
      scheduledSessionId: 4,
      currentSessionId: 4,
      scheduledTurn: 9,
      activeTurn: 10,
    }),
    false,
  );
});
