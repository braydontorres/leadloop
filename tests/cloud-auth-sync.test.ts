import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authErrorMessage,
  authRedirectUrl,
  completeAuthCallback,
  currentAuth,
  sendPasswordRecovery,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  updatePassword,
} from "../lib/cloud/auth";
import {
  cloudRecordRemovals,
  storeFromCloudRows,
  storeToCloudRows,
} from "../lib/cloud/repository";
import {
  getSupabaseBrowserClient,
  getSupabaseBrowserConfigurationError,
  readSupabaseBrowserConfig,
  resetSupabaseBrowserClientForTests,
} from "../lib/cloud/supabase-browser";
import { sampleStore } from "../lib/tasks";

function authClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signUp: async (value: unknown) => {
        calls.push({ operation: "signUp", value });
        return { data: { user: null }, error: null };
      },
      signInWithPassword: async (value: unknown) => {
        calls.push({ operation: "signIn", value });
        return { data: { session: null }, error: null };
      },
      resetPasswordForEmail: async (email: string, value: unknown) => {
        calls.push({
          operation: "recover",
          value: { email, ...((value as object) ?? {}) },
        });
        return { data: {}, error: null };
      },
      updateUser: async (value: unknown) => {
        calls.push({ operation: "updatePassword", value });
        return { data: { user: null }, error: null };
      },
      exchangeCodeForSession: async (code: string) => {
        calls.push({ operation: "exchangeCode", value: code });
        return { data: { session: null }, error: null };
      },
      setSession: async (value: unknown) => {
        calls.push({ operation: "setSession", value });
        return { data: { session: null }, error: null };
      },
      signOut: async () => {
        calls.push({ operation: "signOut" });
        return { error: null };
      },
      ...overrides,
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("email auth helpers use browser-safe auth methods and surface provider errors", async () => {
  const { client, calls } = authClient();
  assert.equal((await currentAuth(client)).user, null);
  await signUpWithEmail(
    client,
    "owner@example.test",
    "password1",
    "http://localhost:3000",
  );
  await signInWithEmail(client, "owner@example.test", "password1");
  await sendPasswordRecovery(
    client,
    "owner@example.test",
    "http://localhost:3000",
  );
  await updatePassword(client, "new-password");
  await signOut(client);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["signUp", "signIn", "recover", "updatePassword", "signOut"],
  );
  assert.deepEqual(calls[0].value, {
    email: "owner@example.test",
    password: "password1",
    options: { emailRedirectTo: "http://localhost:3000" },
  });

  const denied = authClient({
    signOut: async () => ({ error: { message: "Session expired" } }),
  });
  await assert.rejects(() => signOut(denied.client), /Session expired/);
  await assert.rejects(
    () =>
      signUpWithEmail(client, "not-an-email", "password1", "http://localhost"),
    /valid email/,
  );
  await assert.rejects(
    () => updatePassword(client, "short"),
    /at least 8 characters/,
  );
});

test("confirmation and recovery callbacks exchange codes or legacy implicit tokens", async () => {
  const { client, calls } = authClient();
  assert.equal(
    authRedirectUrl("http://localhost:3000"),
    "http://localhost:3000/",
  );
  const recovery = await completeAuthCallback(
    client,
    "http://localhost:3000/?auth_callback=1&type=recovery&code=one-time-code",
  );
  assert.equal(recovery.kind, "recovery");
  assert.deepEqual(calls.at(-1), {
    operation: "exchangeCode",
    value: "one-time-code",
  });
  const confirmation = await completeAuthCallback(
    client,
    "http://localhost:3000/?auth_callback=1#type=signup&access_token=access&refresh_token=refresh",
  );
  assert.equal(confirmation.kind, "confirmation");
  assert.deepEqual(calls.at(-1), {
    operation: "setSession",
    value: { access_token: "access", refresh_token: "refresh" },
  });
  await assert.rejects(
    () =>
      completeAuthCallback(
        client,
        "http://localhost:3000/?auth_callback=1&error_description=Link%20expired",
      ),
    /expired/,
  );
});

test("auth errors give useful safe recovery guidance", () => {
  assert.match(
    authErrorMessage({ message: "Invalid path specified in request URI" }),
    /project base URL/i,
  );
  assert.match(
    authErrorMessage({ message: "User already registered" }),
    /already exists/i,
  );
  assert.match(
    authErrorMessage({ message: "Invalid login credentials" }),
    /incorrect/i,
  );
  assert.match(
    authErrorMessage(new TypeError("Failed to fetch")),
    /reach Supabase/i,
  );
});

test("browser cloud configuration accepts only public Supabase values", () => {
  assert.deepEqual(
    readSupabaseBrowserConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-be-read",
    }),
    { url: "https://example.supabase.co", anonKey: "publishable-key" },
  );
  assert.deepEqual(
    readSupabaseBrowserConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://legacy.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon-key",
    }),
    { url: "https://legacy.supabase.co", anonKey: "legacy-anon-key" },
  );
  assert.equal(readSupabaseBrowserConfig({}), null);
  assert.throws(
    () =>
      readSupabaseBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      }),
    /valid URL/,
  );
  assert.throws(
    () =>
      readSupabaseBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/auth/v1",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      }),
    /project base URL only/,
  );
});

test("default browser configuration reads statically named public variables", () => {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ] as const;
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://default.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "default-public-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    assert.deepEqual(readSupabaseBrowserConfig(), {
      url: "https://default.supabase.co",
      anonKey: "default-public-key",
    });
  } finally {
    for (const name of names) {
      const value = before[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("invalid public project URLs fall back safely and expose no credentials", () => {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ] as const;
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://example.supabase.co/auth/v1";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    resetSupabaseBrowserClientForTests();
    assert.equal(getSupabaseBrowserClient(), null);
    assert.match(
      getSupabaseBrowserConfigurationError() ?? "",
      /project base URL only/,
    );
    assert.doesNotMatch(
      getSupabaseBrowserConfigurationError() ?? "",
      /public-key/,
    );
  } finally {
    for (const name of names) {
      const value = before[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetSupabaseBrowserClientForTests();
  }
});

test("cloud row mapper preserves customer, quote, reminder IDs, links, dates, and timezone", () => {
  const store = sampleStore();
  const person = {
    id: "customer-mike",
    name: "Mike",
    business: "Mike's Home",
    email: "mike@example.test",
    phone: "555-0100",
    address: "1 Main St",
    notes: "Driveway estimate",
    interactions: [
      {
        id: "interaction-mike",
        note: "Asked for quote",
        createdAt: "2026-10-21T12:00:00.000Z",
      },
    ],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
  };
  const quote = {
    id: "quote-mike",
    customerId: person.id,
    serviceDescription: "Driveway cleaning",
    amountCents: 25000,
    currency: "USD" as const,
    status: "sent" as const,
    notes: "Follow up",
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    statusHistory: [
      {
        id: "quote-history",
        from: "draft" as const,
        to: "sent" as const,
        changedAt: person.updatedAt,
      },
    ],
  };
  const source = {
    ...store,
    name: "Owner",
    business: "LeadLoop Lawn Care",
    timezone: "America/Chicago",
    people: [person],
    quotes: [quote],
    tasks: [
      {
        id: "task-mike",
        title: "Call Mike",
        person: "Mike",
        personId: person.id,
        quoteId: quote.id,
        due: "2026-10-21T22:00:00.000Z",
        completed: false,
        notes: "Confirm estimate",
      },
    ],
  };
  const rows = storeToCloudRows("workspace-a", source);
  assert.equal(rows.tasks[0].workspace_id, "workspace-a");
  assert.equal(rows.tasks[0].person_id, person.id);
  assert.equal(rows.tasks[0].quote_id, quote.id);
  const restored = storeFromCloudRows({
    workspace: { name: "Fallback", business_name: "LeadLoop Lawn Care" },
    preferences: {
      owner_name: "Owner",
      timezone: "America/Chicago",
      working_days: [1, 2, 3, 4, 5],
    },
    ...rows,
  });
  assert.deepEqual(restored, source);
});

test("cloud deletion candidates are limited to records this browser loaded", () => {
  const baseline = sampleStore();
  const existingTask = {
    id: "loaded-task",
    title: "Loaded task",
    person: "",
    due: "",
    completed: false,
    notes: "",
  };
  baseline.tasks = [existingTask];
  // A task created remotely after this browser loaded never appears in the
  // baseline, so it cannot become a delete candidate for this snapshot.
  const current = { ...baseline, tasks: [] };
  assert.deepEqual(cloudRecordRemovals(baseline, current), {
    customers: [],
    interactions: [],
    quotes: [],
    history: [],
    tasks: ["loaded-task"],
  });
});
