import assert from "node:assert/strict";
import test from "node:test";
import {
  isVoiceTimeout,
  voiceHttpError,
  voiceTimeoutError,
} from "../src/voice-response";

test("voice HTTP failures retain retry guidance without exposing authorization", () => {
  const error = voiceHttpError({
    message: "Too many voice requests.",
    retryAfterSeconds: 42,
  });
  assert.match(error.message, /42 seconds/);
  assert.doesNotMatch(error.message, /bearer|token|secret/i);
});

test("aborted voice request is converted into a safe timeout error", () => {
  assert.equal(isVoiceTimeout({ name: "AbortError" }), true);
  assert.equal(isVoiceTimeout(new Error("network failed")), false);
  assert.match(voiceTimeoutError().message, /timed out/i);
});
