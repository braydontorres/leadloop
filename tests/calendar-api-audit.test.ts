import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as interpretPost } from "../app/api/interpret/route";
import {
  advanceConversation,
  conversationContext,
  emptyConversationState,
  type AssistantIntent,
  type IntentResult,
} from "../lib/conversation-machine";
import { resetRateLimitsForTest } from "../lib/request-limit";

const fields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

function request(text: string, context: unknown) {
  return new Request("http://leadloop.test/api/interpret", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "calendar-audit-route-test",
    },
    body: JSON.stringify({ text, timeZone: "America/Chicago", context }),
  });
}

async function withMockedProvider<T>(
  results: IntentResult[],
  run: () => Promise<T>,
) {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-never-log-this-value";
  globalThis.fetch = async () => {
    const result = results.shift();
    if (!result) throw new Error("Unexpected mocked interpretation request.");
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

test("Layer D: /api/interpret plus conversation state accepts ordinal/time follow-ups despite model labels", async () => {
  const labels: AssistantIntent["kind"][] = [
    "none",
    "confirm",
    "new_task",
    "follow_up",
    "update",
  ];
  for (const kind of labels) {
    resetRateLimitsForTest();
    const transition = await withMockedProvider(
      [
        {
          intent: {
            kind: "new_task",
            fields: { ...fields, title: "order supplies" },
          },
        },
        { intent: { kind, fields } },
      ],
      async () => {
        const firstPayload = (await (
          await interpretPost(
            request(
              "Remind me to order supplies on a Saturday in June.",
              conversationContext(emptyConversationState()),
            ),
          )
        ).json()) as { transcript: string; result: IntentResult };
        const first = advanceConversation({
          state: emptyConversationState(),
          result: firstPayload.result,
          text: firstPayload.transcript,
          timeZone: "America/Chicago",
          createId: () => "route-audit-draft",
          now: new Date("2026-10-19T12:00:00Z"),
        });
        assert.match(first.reply, /Which Saturday in June/);

        const secondPayload = (await (
          await interpretPost(
            request(
              "The second Saturday at 5 PM.",
              conversationContext(first.state),
            ),
          )
        ).json()) as { transcript: string; result: IntentResult };
        return advanceConversation({
          state: first.state,
          result: secondPayload.result,
          text: secondPayload.transcript,
          timeZone: "America/Chicago",
          createId: () => "must-not-create-a-second-draft",
          now: new Date("2026-10-19T12:00:00Z"),
        });
      },
    );
    assert.equal(transition.state.activeReminder?.id, "route-audit-draft");
    assert.equal(transition.state.activeReminder?.title, "order supplies");
    assert.equal(transition.state.stage, "reading_back");
    assert.match(transition.reply, /Saturday, June 12, 2027.*5:00 PM/);
  }
});
