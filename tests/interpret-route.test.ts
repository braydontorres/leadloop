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

const blankFields: AssistantIntent["fields"] = {
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
      "x-forwarded-for": "calendar-route-test",
    },
    body: JSON.stringify({ text, timeZone: "America/Chicago", context }),
  });
}

async function withMockedInterpretations<T>(
  results: IntentResult[],
  action: () => Promise<T>,
) {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: unknown[] = [];
  process.env.OPENAI_API_KEY = "test-key-must-not-appear-in-logs";
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const result = results.shift();
    if (!result) throw new Error("Unexpected interpretation request.");
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const value = await action();
    return { value, requests };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

test("the real interpretation route cannot make an ordinal reply repeat an active calendar question", async () => {
  const misclassifications: AssistantIntent["kind"][] = [
    "none",
    "confirm",
    "new_task",
    "end_conversation",
  ];
  for (const kind of misclassifications) {
    resetRateLimitsForTest();
    const { value, requests } = await withMockedInterpretations(
      [
        {
          intent: {
            kind: "new_task",
            fields: {
              ...blankFields,
              title: "order supplies",
              date: "2027-07-01",
            },
          },
        },
        { intent: { kind, fields: blankFields } },
      ],
      async () => {
        const firstResponse = await interpretPost(
          request(
            "Remind me to order supplies on a Saturday next July.",
            conversationContext(emptyConversationState()),
          ),
        );
        assert.equal(firstResponse.status, 200);
        const firstPayload = (await firstResponse.json()) as {
          transcript: string;
          result: IntentResult;
        };
        const first = advanceConversation({
          state: emptyConversationState(),
          result: firstPayload.result,
          text: firstPayload.transcript,
          timeZone: "America/Chicago",
          createId: () => "draft-order-supplies",
          now: new Date("2026-10-19T12:00:00Z"),
        });
        assert.match(first.reply, /Which Saturday in July/);

        const secondResponse = await interpretPost(
          request("The fifth Saturday.", conversationContext(first.state)),
        );
        assert.equal(secondResponse.status, 200);
        const secondPayload = (await secondResponse.json()) as {
          transcript: string;
          result: IntentResult;
        };
        assert.equal(secondPayload.result.intent.kind, kind);
        return advanceConversation({
          state: first.state,
          result: secondPayload.result,
          text: secondPayload.transcript,
          timeZone: "America/Chicago",
          createId: () => "unexpected-new-draft",
          now: new Date("2026-10-19T12:00:00Z"),
        });
      },
    );
    assert.equal(value.state.activeReminder?.id, "draft-order-supplies");
    assert.equal(value.state.activeReminder?.title, "order supplies");
    assert.equal(value.state.activeReminder?.pendingDate, "2027-07-31");
    assert.equal(value.state.activeReminder?.pendingDateConstraint, null);
    assert.match(value.reply, /What time/);
    assert.equal(requests.length, 2);
    assert.doesNotMatch(
      JSON.stringify(requests),
      /test-key-must-not-appear-in-logs/,
    );
  }
});

test("the real interpretation route preserves a combined ordinal date and deterministic time", async () => {
  resetRateLimitsForTest();
  const { value } = await withMockedInterpretations(
    [
      {
        intent: {
          kind: "new_task",
          fields: {
            ...blankFields,
            title: "order supplies",
            date: "2027-07-01",
          },
        },
      },
      { intent: { kind: "confirm", fields: blankFields } },
    ],
    async () => {
      const firstPayload = (await (
        await interpretPost(
          request(
            "Remind me to order supplies on a Saturday next July.",
            conversationContext(emptyConversationState()),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      const first = advanceConversation({
        state: emptyConversationState(),
        result: firstPayload.result,
        text: firstPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "draft-order-supplies",
        now: new Date("2026-10-19T12:00:00Z"),
      });
      const secondPayload = (await (
        await interpretPost(
          request(
            "The fifth Saturday at 5 PM.",
            conversationContext(first.state),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      return advanceConversation({
        state: first.state,
        result: secondPayload.result,
        text: secondPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "unexpected-new-draft",
        now: new Date("2026-10-19T12:00:00Z"),
      });
    },
  );
  assert.equal(value.state.activeReminder?.id, "draft-order-supplies");
  assert.equal(value.state.stage, "reading_back");
  assert.equal(value.state.activeReminder?.pendingDate, null);
  assert.equal(value.state.activeReminder?.pendingTime, null);
  assert.match(value.reply, /Saturday, July 31, 2027.*5:00 PM/);
});
