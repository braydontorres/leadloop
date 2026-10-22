import assert from "node:assert/strict";
import test from "node:test";
import {
  currentMobileVoiceAccessToken,
  MobileVoiceSessionError,
} from "../src/voice-session";

function client(input: {
  current?: { access_token: string; expires_at?: number } | null;
  refreshed?: { access_token: string; expires_at?: number } | null;
  sessionError?: unknown;
  refreshError?: unknown;
}) {
  let refreshes = 0;
  return {
    value: {
      auth: {
        getSession: async () => ({
          data: { session: input.current ?? null },
          error: input.sessionError ?? null,
        }),
        refreshSession: async () => {
          refreshes += 1;
          return {
            data: { session: input.refreshed ?? null },
            error: input.refreshError ?? null,
          };
        },
      },
    },
    refreshes: () => refreshes,
  };
}

test("voice upload uses a still-fresh mobile access token", async () => {
  const mock = client({
    current: { access_token: "fresh", expires_at: 10_000 },
  });
  assert.equal(await currentMobileVoiceAccessToken(mock.value, 100), "fresh");
  assert.equal(mock.refreshes(), 0);
});

test("voice upload refreshes an expired or nearly expired mobile session", async () => {
  const mock = client({
    current: { access_token: "stale", expires_at: 150 },
    refreshed: { access_token: "fresh", expires_at: 10_000 },
  });
  assert.equal(await currentMobileVoiceAccessToken(mock.value, 100), "fresh");
  assert.equal(mock.refreshes(), 1);
});

test("voice upload reports a safe session-refresh failure without token details", async () => {
  const mock = client({
    current: { access_token: "stale", expires_at: 100 },
    refreshError: new Error("network failure"),
  });
  await assert.rejects(
    () => currentMobileVoiceAccessToken(mock.value, 100),
    (error: unknown) => {
      assert(error instanceof MobileVoiceSessionError);
      assert.equal(error.code, "MOBILE_SESSION_REFRESH_FAILED");
      assert.doesNotMatch(error.message, /stale|token/i);
      return true;
    },
  );
});
