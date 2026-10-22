import assert from "node:assert/strict";
import test from "node:test";
import {
  initialHandsFreeRecorderStatus,
  recorderStatusSnapshot,
  recorderStoppedUnexpectedly,
} from "../src/hands-free-recorder-status";

test("hands-free recorder lifecycle preserves active meter and duration samples", () => {
  const status = recorderStatusSnapshot(
    { isRecording: true, durationMillis: 420, metering: -37.5 },
    1_000,
  );
  assert.deepEqual(status, {
    active: true,
    durationMillis: 420,
    meterDb: -37.5,
    checkedAtMs: 1_000,
    wallElapsedMs: 0,
    nativeError: null,
    action: "waiting",
  });
  assert.equal(recorderStoppedUnexpectedly(status), false);
});

test("a completed status read is reported as an actionable recorder interruption", () => {
  assert.equal(
    recorderStoppedUnexpectedly(initialHandsFreeRecorderStatus),
    false,
  );
  const stopped = recorderStatusSnapshot(
    { isRecording: false, durationMillis: 0 },
    2_000,
  );
  assert.equal(recorderStoppedUnexpectedly(stopped), true);
});

test("session cancellation keeps an invalidated recorder from becoming a live turn", () => {
  const stopped = recorderStatusSnapshot(
    { isRecording: false, durationMillis: 1_250, metering: -45 },
    3_000,
    "recorder_invalidated",
  );
  assert.equal(stopped.action, "recorder_invalidated");
  assert.equal(recorderStoppedUnexpectedly(stopped), true);
});
