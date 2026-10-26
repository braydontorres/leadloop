import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshSupabaseForAppState } from "../src/app-state-refresh";

test("SDK 58 nullable initial AppState does not start a cloud refresh until active", () => {
  assert.equal(shouldRefreshSupabaseForAppState(null), false);
  assert.equal(shouldRefreshSupabaseForAppState(undefined), false);
  assert.equal(shouldRefreshSupabaseForAppState("background"), false);
  assert.equal(shouldRefreshSupabaseForAppState("active"), true);
});
