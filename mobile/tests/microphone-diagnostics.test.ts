import assert from "node:assert/strict";
import test from "node:test";
import {
  microphoneErrorMessage,
  microphoneFailure,
  microphoneSuccess,
} from "../src/microphone-diagnostics";
import { errorMessage } from "../src/format";

test("microphone failures retain their native stage and never use cloud authorization copy", () => {
  assert.deepEqual(microphoneFailure("audio_session"), {
    stage: "audio_session",
    category: "audio_session",
    outcome: "failed",
  });
  assert.match(microphoneErrorMessage("prepare"), /microphone/i);
  assert.doesNotMatch(microphoneErrorMessage("permission"), /cloud request/i);
  assert.doesNotMatch(
    errorMessage(new Error("microphone permission denied")),
    /cloud request was denied/i,
  );
});

test("microphone start and usable-file outcomes are explicit", () => {
  assert.equal(microphoneSuccess("start").outcome, "succeeded");
  assert.equal(microphoneFailure("file").category, "file");
  assert.match(microphoneErrorMessage("file"), /audio file/i);
});
