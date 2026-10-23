import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/mobile/speech/route";
import { resetRateLimitsForTest } from "../lib/request-limit";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function request(
  body: Record<string, unknown> = {
    workspaceId,
    text: "I will remind you to call Mike tomorrow at three PM.",
    voice: "alloy",
    speed: "normal",
  },
  headers?: HeadersInit,
) {
  return new Request("https://leadloop.test/api/mobile/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("mobile natural speech rejects missing authentication before contacting OpenAI", async () => {
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "MOBILE_AUTH_HEADER_MISSING");
});

test("mobile natural speech validates voice selection before authorization", async () => {
  const response = await POST(
    request({
      workspaceId,
      text: "Hello",
      voice: "not-a-voice",
      speed: "normal",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "SPEECH_VOICE_INVALID");
});

test("preview traffic cannot consume the assistant reply budget and returns Retry-After", async () => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    openAi: process.env.OPENAI_API_KEY,
    previewLimit: process.env.LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS,
    replyLimit: process.env.LEADLOOP_MOBILE_SPEECH_REPLY_MAX_REQUESTS,
    fetch: globalThis.fetch,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS = "1";
  process.env.LEADLOOP_MOBILE_SPEECH_REPLY_MAX_REQUESTS = "5";
  resetRateLimitsForTest();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/workspace_members"))
      return new Response(JSON.stringify([{ workspace_id: workspaceId }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/audio/speech"))
      return new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 });
    throw new Error(`Unexpected fetch ${url}`);
  };
  const authorized = { Authorization: "Bearer signed-user-token" };
  try {
    const preview = {
      workspaceId,
      text: "Preview this voice.",
      voice: "alloy",
      speed: "normal",
      kind: "preview",
    };
    assert.equal((await POST(request(preview, authorized))).status, 200);
    const limited = await POST(request(preview, authorized));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "LOCAL_RATE_LIMIT");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);

    // A normal multi-turn reminder can need several spoken replies. Those
    // replies retain their own capacity after an owner samples all previews.
    for (let turn = 0; turn < 5; turn += 1) {
      const reply = await POST(
        request(
          {
            ...preview,
            text: `Assistant conversation reply ${turn + 1}.`,
            kind: "assistant_reply",
          },
          authorized,
        ),
      );
      assert.equal(reply.status, 200);
    }
    const replyLimited = await POST(
      request({ ...preview, kind: "assistant_reply" }, authorized),
    );
    assert.equal(replyLimited.status, 429);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previous.key;
    if (previous.openAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.openAi;
    if (previous.previewLimit === undefined)
      delete process.env.LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS;
    else
      process.env.LEADLOOP_MOBILE_SPEECH_PREVIEW_MAX_REQUESTS =
        previous.previewLimit;
    if (previous.replyLimit === undefined)
      delete process.env.LEADLOOP_MOBILE_SPEECH_REPLY_MAX_REQUESTS;
    else
      process.env.LEADLOOP_MOBILE_SPEECH_REPLY_MAX_REQUESTS =
        previous.replyLimit;
  }
});

test("mobile natural speech applies the lower preview text limit before authorization", async () => {
  const response = await POST(
    request({
      workspaceId,
      text: "a".repeat(241),
      voice: "alloy",
      speed: "normal",
      kind: "preview",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "SPEECH_TEXT_INVALID");
});

test("OpenAI rate limits preserve Retry-After for the iPhone cooldown", async () => {
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
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/workspace_members"))
      return new Response(JSON.stringify([{ workspace_id: workspaceId }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/audio/speech"))
      return new Response(
        JSON.stringify({ error: { type: "rate_limit_error" } }),
        { status: 429, headers: { "retry-after": "19" } },
      );
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await POST(
      request(undefined, { Authorization: "Bearer signed-user-token" }),
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "AI_RATE_LIMITED");
    assert.equal(response.headers.get("retry-after"), "19");
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

test("mobile natural speech authorizes the workspace and returns a no-store MP3", async () => {
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
  let speechPayload: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/workspace_members"))
      return new Response(JSON.stringify([{ workspace_id: workspaceId }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/audio/speech")) {
      speechPayload = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await POST(
      request(undefined, { Authorization: "Bearer signed-user-token" }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(
      response.headers.get("x-leadloop-speech-source"),
      "openai-tts",
    );
    assert.equal(response.headers.get("x-leadloop-speech-voice"), "alloy");
    assert.equal(response.headers.get("x-leadloop-speech-speed"), "normal");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      new Uint8Array([73, 68, 51, 4]),
    );
    assert.deepEqual(speechPayload, {
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "I will remind you to call Mike tomorrow at three PM.",
      response_format: "mp3",
      speed: 1,
      instructions:
        "Speak warmly and conversationally, with clear pacing for a small-business owner.",
    });
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

test("mobile natural speech preserves the requested voice and contrasting pace", async () => {
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
  let speechPayload: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/workspace_members"))
      return new Response(JSON.stringify([{ workspace_id: workspaceId }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/audio/speech")) {
      speechPayload = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([73, 68, 51, 4]), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const response = await POST(
      request(
        {
          workspaceId,
          text: "Preview this voice.",
          voice: "onyx",
          speed: "fast",
        },
        { Authorization: "Bearer signed-user-token" },
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-leadloop-speech-voice"), "onyx");
    assert.equal(response.headers.get("x-leadloop-speech-speed"), "fast");
    assert.equal(speechPayload?.voice, "onyx");
    assert.equal(speechPayload?.speed, 1.35);
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
