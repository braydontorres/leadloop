import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/ai-server";
import {
  clientId,
  limitRequest,
  releaseRequest,
  resetRateLimitsForTest,
} from "../lib/request-limit";

const config = { windowMs: 60_000, maxRequests: 2 };

test("internal limit returns its own source and retry duration", () => {
  resetRateLimitsForTest();
  limitRequest("test-client", 1_000, config);
  limitRequest("test-client", 2_000, config);
  assert.throws(
    () => limitRequest("test-client", 3_000, config),
    (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.code, "LOCAL_RATE_LIMIT");
      assert.equal(error.source, "internal");
      assert.equal(error.retryAfterSeconds, 58);
      return true;
    },
  );
});

test("released failed requests do not consume the allowance", () => {
  resetRateLimitsForTest();
  const failed = limitRequest("test-client", 1_000, config);
  releaseRequest(failed);
  limitRequest("test-client", 2_000, config);
  limitRequest("test-client", 3_000, config);
});

test("uses forwarded client identity when available", () => {
  assert.equal(
    clientId(new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.2" })),
    "203.0.113.8",
  );
  assert.equal(clientId(new Headers()), "local");
});
