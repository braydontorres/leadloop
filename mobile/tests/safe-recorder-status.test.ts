import assert from "node:assert/strict";
import test from "node:test";
import {
  readRecorderStatus,
  shouldContinueRecorderStatusPolling,
} from "../src/safe-recorder-status";

test("a valid native recorder status supplies duration and metering to VAD", () => {
  const status = readRecorderStatus(
    {
      getStatus: () => ({
        isRecording: true,
        durationMillis: 640,
        metering: -34.5,
        mediaServicesDidReset: false,
        url: "file:///voice.m4a",
      }),
    },
    123,
  );
  assert.equal(status.nativeError, null);
  assert.equal(status.durationMillis, 640);
  assert.equal(status.metering, -34.5);
  assert.equal(shouldContinueRecorderStatusPolling(status), true);
});

test("an invalidated native recorder is contained and stops status polling", () => {
  const status = readRecorderStatus(
    {
      getStatus: () => {
        throw new Error("native shared object has been released");
      },
    },
    456,
  );
  assert.equal(status.nativeError, "recorder_invalidated");
  assert.equal(status.checkedAtMs, 456);
  assert.equal(status.isRecording, false);
  assert.equal(shouldContinueRecorderStatusPolling(status), false);
});
