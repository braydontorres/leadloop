import assert from "node:assert/strict";
import test from "node:test";
import { canAutoRetryEmptyTranscript } from "../src/voice-recovery";

test("one empty transcript retries hands-free listening without treating silence as confirmation", () => {
  assert.equal(
    canAutoRetryEmptyTranscript({
      code: "EMPTY_TRANSCRIPT",
      handsFreeActive: true,
      consecutiveRetries: 0,
    }),
    true,
  );
  assert.equal(
    canAutoRetryEmptyTranscript({
      code: "EMPTY_TRANSCRIPT",
      handsFreeActive: true,
      consecutiveRetries: 1,
    }),
    false,
  );
  assert.equal(
    canAutoRetryEmptyTranscript({
      code: "EMPTY_TRANSCRIPT",
      handsFreeActive: false,
      consecutiveRetries: 0,
    }),
    false,
  );
});
