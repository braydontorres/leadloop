import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/ai-server";
import { mobileVoiceSupabaseConfig } from "../lib/mobile-voice-auth";

test("production mobile voice uses explicit runtime Supabase settings", () => {
  assert.deepEqual(
    mobileVoiceSupabaseConfig({
      NODE_ENV: "production",
      SUPABASE_URL: "https://runtime.supabase.co/",
      SUPABASE_PUBLISHABLE_KEY: "runtime-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://build-time.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "build-time-key",
    }),
    {
      url: "https://runtime.supabase.co",
      key: "runtime-key",
      source: "server_publishable",
    },
  );
});

test("production mobile voice never falls back to a build-time public variable", () => {
  assert.throws(
    () =>
      mobileVoiceSupabaseConfig({
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://build-time.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "build-time-key",
      }),
    (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.code, "MOBILE_AUTH_RUNTIME_CONFIG_REQUIRED");
      return true;
    },
  );
});

test("conflicting server key types are rejected rather than silently prioritized", () => {
  assert.throws(
    () =>
      mobileVoiceSupabaseConfig({
        NODE_ENV: "production",
        SUPABASE_URL: "https://runtime.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        SUPABASE_ANON_KEY: "different-legacy-key",
      }),
    (error: unknown) => {
      assert(error instanceof ApiError);
      assert.equal(error.code, "MOBILE_AUTH_CONFIG_AMBIGUOUS");
      return true;
    },
  );
});

test("local development remains compatible with one public Supabase key", () => {
  assert.deepEqual(
    mobileVoiceSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://local.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-key",
    }),
    {
      url: "https://local.supabase.co",
      key: "legacy-key",
      source: "development_public_anon",
    },
  );
});
