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

test("the interpretation route plus conversation state applies a relative correction despite a confirm label", async () => {
  resetRateLimitsForTest();
  const now = new Date("2026-10-19T12:00:00Z");
  const { value, requests } = await withMockedInterpretations(
    [
      {
        intent: {
          kind: "new_task",
          fields: { ...blankFields, title: "talk to Steven", person: "Steven" },
        },
      },
      // This is the unsafe classification reported in production. Application
      // logic must still apply the explicit relative-date correction.
      { intent: { kind: "confirm", fields: blankFields } },
    ],
    async () => {
      const firstPayload = (await (
        await interpretPost(
          request(
            "Remind me to talk to Steven today at 5 PM.",
            conversationContext(emptyConversationState()),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      const first = advanceConversation({
        state: emptyConversationState(),
        result: firstPayload.result,
        text: firstPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "steven-route-draft",
        now,
      });
      const correctionPayload = (await (
        await interpretPost(
          request(
            "Actually, two weeks from today.",
            conversationContext({
              ...first.state,
              stage: "awaiting_confirmation",
            }),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      return advanceConversation({
        state: { ...first.state, stage: "awaiting_confirmation" },
        result: correctionPayload.result,
        text: correctionPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "unexpected-new-draft",
        now,
      });
    },
  );
  assert.equal(value.state.activeReminder?.id, "steven-route-draft");
  assert.equal(value.state.stage, "reading_back");
  assert.match(value.reply, /Monday, November 2, 2026.*5:00 PM/);
  assert.equal(requests.length, 2);
});

test("the interpretation route preserves Phase C weekday and spoken-time corrections", async () => {
  resetRateLimitsForTest();
  const now = new Date("2026-10-19T12:00:00Z");
  const { value } = await withMockedInterpretations(
    [
      {
        intent: {
          kind: "new_task",
          fields: { ...blankFields, title: "call Brad", person: "Brad" },
        },
      },
      // The deterministic parser must apply the correction even if the model
      // mistakenly classifies it as confirmation.
      { intent: { kind: "confirm", fields: blankFields } },
    ],
    async () => {
      const firstPayload = (await (
        await interpretPost(
          request(
            "Remind me to call Brad this Friday at half past three PM.",
            conversationContext(emptyConversationState()),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      const first = advanceConversation({
        state: emptyConversationState(),
        result: firstPayload.result,
        text: firstPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "phase-c-route-draft",
        now,
      });
      assert.match(first.reply, /October 23, 2026.*3:30 PM/);
      const correctionPayload = (await (
        await interpretPost(
          request(
            "Actually, Friday after next at quarter to five PM.",
            conversationContext({
              ...first.state,
              stage: "awaiting_confirmation",
            }),
          ),
        )
      ).json()) as { transcript: string; result: IntentResult };
      return advanceConversation({
        state: { ...first.state, stage: "awaiting_confirmation" },
        result: correctionPayload.result,
        text: correctionPayload.transcript,
        timeZone: "America/Chicago",
        createId: () => "unexpected-phase-c-route-draft",
        now,
      });
    },
  );
  assert.equal(value.state.activeReminder?.id, "phase-c-route-draft");
  assert.equal(value.state.activeReminder?.title, "call Brad");
  assert.equal(value.state.stage, "reading_back");
  assert.match(value.reply, /October 30, 2026.*4:45 PM/);
});
