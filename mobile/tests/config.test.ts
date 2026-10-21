import assert from "node:assert/strict";
import test from "node:test";
import { mobileSupabaseConfig, workspacePreferenceKey } from "../src/config";

test("mobile accepts only public Supabase project configuration", () => {
  assert.deepEqual(
    mobileSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://leadloop.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "must never be read",
    }),
    { url: "https://leadloop.supabase.co", anonKey: "publishable-key" },
  );
  assert.deepEqual(
    mobileSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://leadloop.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon-key",
    }),
    { url: "https://leadloop.supabase.co", anonKey: "legacy-anon-key" },
  );
  assert.equal(mobileSupabaseConfig({}), null);
  assert.throws(
    () =>
      mobileSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: "https://leadloop.supabase.co/auth/v1",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "key",
      }),
    /project base URL/i,
  );
});

test("workspace selection is scoped to the authenticated user", () => {
  assert.notEqual(
    workspacePreferenceKey("owner-a"),
    workspacePreferenceKey("owner-b"),
  );
});
