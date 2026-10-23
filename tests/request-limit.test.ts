import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/ai-server";
import {
  clientId,
  limitRequest,
  mobileSpeechLimitKey,
  mobileSpeechRateLimitConfig,
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

test("natural previews and assistant replies have independent authenticated-user budgets", () => {
  resetRateLimitsForTest();
  const reply = { windowMs: 60_000, maxRequests: 2 };
  const preview = { windowMs: 60_000, maxRequests: 1 };
  const userId = "user-1";
  limitRequest(mobileSpeechLimitKey(userId, "preview"), 1_000, preview);
  limitRequest(mobileSpeechLimitKey(userId, "assistant_reply"), 1_000, reply);
  limitRequest(mobileSpeechLimitKey(userId, "assistant_reply"), 2_000, reply);
  assert.throws(() =>
    limitRequest(mobileSpeechLimitKey(userId, "preview"), 2_000, preview),
  );
  assert.throws(() =>
    limitRequest(mobileSpeechLimitKey(userId, "assistant_reply"), 3_000, reply),
  );
});

test("natural speech policy has safe production defaults and bounded server overrides", () => {
  assert.deepEqual(
    mobileSpeechRateLimitConfig("assistant_reply", { NODE_ENV: "production" }),
    { windowMs: 600_000, maxRequests: 30 },
  );
  assert.deepEqual(
    mobileSpeechRateLimitConfig("preview", {
      NODE_ENV: "production",
      LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS: "8",
      LEADLOOP_MOBILE_SPEECH_PREVIEW_WINDOW_SECONDS: "120",
    }),
    { windowMs: 120_000, maxRequests: 8 },
  );
  assert.deepEqual(
    mobileSpeechRateLimitConfig("preview", {
      NODE_ENV: "production",
      LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS: "0",
      LEADLOOP_MOBILE_SPEECH_PREVIEW_WINDOW_SECONDS: "not-a-number",
    }),
    { windowMs: 600_000, maxRequests: 6 },
  );
});
