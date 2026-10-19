import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAudioMimeType,
  selectRecorderMimeType,
  supportedAudioFormat,
} from "../lib/audio-format";
import { ApiError, interpretThought, transcribeAudio } from "../lib/ai-server";
import { POST as voicePost } from "../app/api/voice/route";

test("recognizes Chrome WebM and Safari MP4 MIME parameters", () => {
  assert.equal(normalizeAudioMimeType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(
    supportedAudioFormat("audio/webm; codecs=opus")?.extension,
    "webm",
  );
  assert.equal(
    supportedAudioFormat("audio/mp4;codecs=mp4a.40.2")?.extension,
    "m4a",
  );
  assert.equal(
    supportedAudioFormat("video/mp4; codecs=mp4a.40.2")?.extension,
    "m4a",
  );
});

test("chooses the first browser-supported recorder format", () => {
  assert.equal(
    selectRecorderMimeType((type) => type === "audio/webm;codecs=opus"),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    selectRecorderMimeType((type) => type === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    selectRecorderMimeType(() => false),
    null,
  );
});

test("does not allow arbitrary audio formats", () => {
  assert.equal(supportedAudioFormat("audio/flac"), null);
  assert.equal(supportedAudioFormat("application/octet-stream"), null);
  assert.equal(supportedAudioFormat(""), null);
});

function voiceRequest(mimeType: string) {
  const form = new FormData();
  form.append(
    "audio",
    new Blob(["short audio"], { type: mimeType }),
    "leadloop-recording.webm",
  );
  form.append("timeZone", "America/Chicago");
  form.append("context", JSON.stringify({}));
  return new Request("http://leadloop.test/api/voice", {
    method: "POST",
    body: form,
  });
}

async function withMockedOpenAi<T>(
  mockFetch: (...args: Parameters<typeof fetch>) => Promise<Response>,
  action: (diagnostics: string[]) => Promise<T>,
) {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const diagnostics: string[] = [];
  process.env.OPENAI_API_KEY = "test-key-must-not-appear-in-logs";
  globalThis.fetch = mockFetch as typeof fetch;
  console.error = (...args: unknown[]) => {
    diagnostics.push(args.map(String).join(" "));
  };
  try {
    return await action(diagnostics);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

function audioFile() {
  return new File(["safe test audio"], "leadloop-recording.webm", {
    type: "audio/webm",
  });
}

test("accepts a codec-qualified supported upload before checking OpenAI credentials", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await voicePost(voiceRequest("audio/webm;codecs=opus"));
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "AI_NOT_CONFIGURED",
    );
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("rejects an unsupported upload with a 415 response", async () => {
  const response = await voicePost(voiceRequest("audio/flac"));
  assert.equal(response.status, 415);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUDIO_UNSUPPORTED",
  );
});

test("reports a missing transcription model with a safe request-id diagnostic", async () => {
  let transcriptionForm: FormData | undefined;
  await withMockedOpenAi(
    async (_input, init) => {
      transcriptionForm = init?.body as FormData;
      return new Response(
        JSON.stringify({
          error: { type: "invalid_request_error", code: "model_not_found" },
        }),
        {
          status: 404,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_transcription_test",
          },
        },
      );
    },
    async (diagnostics) => {
      await assert.rejects(
        () => transcribeAudio(audioFile()),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_MODEL_UNAVAILABLE");
          assert.equal(error.status, 502);
          assert.equal(error.requestId, "req_transcription_test");
          return true;
        },
      );
      assert.match(diagnostics.join("\n"), /AI_MODEL_UNAVAILABLE/);
      assert.match(diagnostics.join("\n"), /req_transcription_test/);
      assert.equal(transcriptionForm?.get("model"), "gpt-4o-mini-transcribe");
      assert.equal(transcriptionForm?.get("response_format"), "json");
      assert(transcriptionForm?.get("file") instanceof File);
      assert.doesNotMatch(
        diagnostics.join("\n"),
        /test-key-must-not-appear-in-logs/,
      );
    },
  );
});

test("distinguishes an exhausted quota from a rate limit", async () => {
  await withMockedOpenAi(
    async () =>
      new Response(
        JSON.stringify({
          error: { type: "insufficient_quota", code: "insufficient_quota" },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    async () => {
      await assert.rejects(
        () => transcribeAudio(audioFile()),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_QUOTA_EXCEEDED");
          assert.equal(error.status, 429);
          return true;
        },
      );
    },
  );
});

test("classifies authentication and ordinary rate-limit failures separately", async () => {
  await withMockedOpenAi(
    async () =>
      new Response(
        JSON.stringify({ error: { type: "authentication_error" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    async () => {
      await assert.rejects(
        () => transcribeAudio(audioFile()),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_AUTH_FAILED");
          return true;
        },
      );
    },
  );
  await withMockedOpenAi(
    async () =>
      new Response(JSON.stringify({ error: { type: "rate_limit_error" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      await assert.rejects(
        () => transcribeAudio(audioFile()),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_RATE_LIMITED");
          return true;
        },
      );
    },
  );
});

test("classifies a fetch failure as a network error without logging audio data", async () => {
  await withMockedOpenAi(
    async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      });
    },
    async (diagnostics) => {
      await assert.rejects(
        () => transcribeAudio(audioFile()),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_NETWORK_ERROR");
          return true;
        },
      );
      assert.match(diagnostics.join("\n"), /ENOTFOUND/);
      assert.doesNotMatch(diagnostics.join("\n"), /safe test audio/);
    },
  );
});

const interpretationContext = {
  history: [],
  activeReminder: null,
  stage: "idle" as const,
};

test("classifies a rejected interpretation schema without calling it a transcription error", async () => {
  const exactSchemaError =
    "Invalid schema for response_format 'leadloop_task_intent': In context=('properties', 'intent'), required is missing.";
  await withMockedOpenAi(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: exactSchemaError,
            type: "invalid_request_error",
            param: "response_format.json_schema.schema",
            code: "invalid_json_schema",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    async (diagnostics) => {
      await assert.rejects(
        () =>
          interpretThought(
            "Actually make it 6 PM.",
            "America/Chicago",
            interpretationContext,
          ),
        (error: unknown) => {
          assert(error instanceof ApiError);
          assert.equal(error.code, "AI_INTERPRETATION_REJECTED");
          assert.equal(error.status, 502);
          return true;
        },
      );
      assert.match(diagnostics.join("\n"), /operation.*interpretation/);
      assert.match(diagnostics.join("\n"), /AI_INTERPRETATION_REJECTED/);
      assert.match(
        diagnostics.join("\n"),
        /response_format\.json_schema\.schema/,
      );
      assert.match(diagnostics.join("\n"), /required is missing/);
    },
  );
});

test("sends an intent-only strict schema and parses a time-only update", async () => {
  let requestBody: Record<string, unknown> | undefined;
  await withMockedOpenAi(
    async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: {
                    kind: "update",
                    fields: {
                      title: null,
                      person: null,
                      date: null,
                      time: "18:00",
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
    },
    async () => {
      const result = await interpretThought(
        "Actually make it 6 PM.",
        "America/Chicago",
        interpretationContext,
      );
      assert.equal(result.intent.kind, "update");
      assert.equal(result.intent.fields.time, "18:00");
    },
  );
  const responseFormat = requestBody?.response_format as {
    type: string;
    json_schema: { schema: Record<string, unknown> };
  };
  assert.equal(requestBody?.model, "gpt-4o-mini");
  assert.equal(responseFormat.type, "json_schema");
  const schema = responseFormat.json_schema.schema as {
    properties: {
      intent: { properties: { fields: Record<string, unknown> } };
    };
  };
  const fields = schema.properties.intent.properties.fields as {
    required: string[];
    additionalProperties: boolean;
  };
  assert.deepEqual(fields.required, [
    "title",
    "person",
    "date",
    "time",
    "notes",
    "clearDue",
  ]);
  assert.equal(fields.additionalProperties, false);
});

test("returns a safe clarification for an invalid local date-time without exposing task content", async () => {
  await withMockedOpenAi(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: {
                    kind: "new_task",
                    fields: {
                      title: "Talk to Sarah",
                      person: "Sarah",
                      date: "tomorrow",
                      time: "15:00",
                      notes: "",
                      clearDue: false,
                    },
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    async (diagnostics) => {
      const result = await interpretThought(
        "Remind me to talk to Sarah tomorrow at 3 PM.",
        "America/Chicago",
        interpretationContext,
      );
      assert.equal(result.intent.kind, "follow_up");
      assert.match(diagnostics.join("\n"), /LOCAL_DATE_TIME/);
      assert.doesNotMatch(diagnostics.join("\n"), /Talk to Sarah/);
    },
  );
});

test("logs the failed validation rule without logging task content", async () => {
  await withMockedOpenAi(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: {
                    kind: "update",
                    fields: {
                      title: null,
                      person: null,
                      date: null,
                      time: "25:00",
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
      ),
    async (diagnostics) => {
      const result = await interpretThought(
        "Actually make it 6 PM.",
        "America/Chicago",
        interpretationContext,
      );
      assert.equal(result.intent.kind, "follow_up");
      assert.match(diagnostics.join("\n"), /LOCAL_DATE_TIME/);
      assert.match(diagnostics.join("\n"), /intent\.fields\.(date|time)/);
      assert.doesNotMatch(diagnostics.join("\n"), /Sarah should be updated/);
    },
  );
});
