import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/mobile/voice/route";
import { resetRateLimitsForTest } from "../lib/request-limit";

function request(headers?: HeadersInit) {
  const form = new FormData();
  form.append("workspaceId", "11111111-1111-4111-8111-111111111111");
  form.append("durationMs", "200");
  form.append("timeZone", "America/Chicago");
  form.append("context", "{}");
  form.append("audio", new Blob(["audio"], { type: "audio/m4a" }), "voice.m4a");
  return new Request("https://leadloop.test/api/mobile/voice", {
    method: "POST",
    headers,
    body: form,
  });
}

test("mobile voice reports when Expo did not deliver an Authorization header", async () => {
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "MOBILE_AUTH_HEADER_MISSING");
});

test("mobile voice reports a malformed Authorization header before transcription", async () => {
  const response = await POST(request({ Authorization: "Basic not-a-bearer" }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "MOBILE_AUTH_HEADER_MALFORMED");
});

async function withSupabaseAuthResponse(
  response: Response | Error,
  run: () => Promise<void>,
) {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";
  globalThis.fetch = async (input) => {
    if (!String(input).endsWith("/auth/v1/user"))
      throw new Error(`Unexpected fetch ${String(input)}`);
    if (response instanceof Error) throw response;
    return response;
  };
  try {
    await run();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previous.key;
  }
}

test("mobile voice distinguishes a Supabase-rejected JWT from a missing header", async () => {
  await withSupabaseAuthResponse(
    new Response(JSON.stringify({ message: "invalid JWT" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
    async () => {
      const response = await POST(request({ Authorization: "Bearer token" }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, "MOBILE_AUTH_TOKEN_REJECTED");
    },
  );
});

test("mobile voice distinguishes a Supabase verification outage from rejected credentials", async () => {
  await withSupabaseAuthResponse(
    new TypeError("network unavailable"),
    async () => {
      const response = await POST(request({ Authorization: "Bearer token" }));
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json()).code,
        "MOBILE_AUTH_SERVICE_UNAVAILABLE",
      );
    },
  );
});

test("mobile voice accepts an authenticated member and reaches the shared AI pipeline", async () => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    openAi: process.env.OPENAI_API_KEY,
    fetch: globalThis.fetch,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";
  process.env.OPENAI_API_KEY = "test-key";
  resetRateLimitsForTest();
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/workspace_members"))
      return new Response(
        JSON.stringify([
          { workspace_id: "11111111-1111-4111-8111-111111111111" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (url.includes("audio/transcriptions"))
      return new Response(
        JSON.stringify({ text: "Remind me to call Mike tomorrow at 3 PM" }),
        { status: 200 },
      );
    if (url.includes("chat/completions"))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: {
                    kind: "new_task",
                    fields: {
                      title: "Call Mike",
                      person: "Mike",
                      date: "tomorrow",
                      time: "15:00",
                      notes: null,
                      clearDue: false,
                    },
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await POST(
      request({ Authorization: "Bearer signed-user-token" }),
    );
    const payload = (await response.json()) as {
      transcript?: string;
      error?: string;
    };
    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.transcript, "Remind me to call Mike tomorrow at 3 PM");
    assert(urls.some((url) => url.endsWith("/auth/v1/user")));
    assert(urls.some((url) => url.includes("workspace_members")));
    assert(urls.some((url) => url.includes("audio/transcriptions")));
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previous.key;
    if (previous.openAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.openAi;
  }
});
