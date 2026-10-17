import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTaskOperations,
  localDateTimeContext,
  parseAssistantResult,
  type ReviewItem,
} from "../lib/conversation";
import { POST as interpretPost } from "../app/api/interpret/route";

const bill: ReviewItem = {
  id: "draft-bill",
  source: "new",
  title: "Talk to Bill about washing his clothes",
  person: "Bill",
  due: "2026-10-23T22:00:00.000Z",
  notes: "",
};

test("keeps an existing draft id when a contextual correction changes its time", () => {
  const result = parseAssistantResult({
    message: "Updated to 6 PM.",
    operations: [
      {
        type: "update",
        targetId: "draft-bill",
        question: null,
        task: {
          title: bill.title,
          person: "Bill",
          due: "2026-10-23T23:00:00.000Z",
          notes: "",
        },
      },
    ],
  });
  const applied = applyTaskOperations(
    [bill],
    [],
    result.operations,
    () => "unused",
  );
  assert.equal(applied.reviewItems.length, 1);
  assert.equal(applied.reviewItems[0].id, "draft-bill");
  assert.equal(applied.reviewItems[0].due, "2026-10-23T23:00:00.000Z");
});

test("keeps multiple tasks from one thought separate", () => {
  const operations = [
    {
      type: "create" as const,
      task: {
        title: "Call James",
        person: "James",
        due: "2026-10-23T15:00:00.000Z",
        notes: "",
      },
    },
    {
      type: "create" as const,
      task: {
        title: "Pick up supplies",
        person: "",
        due: "2026-10-23T15:00:00.000Z",
        notes: "",
      },
    },
  ];
  const applied = applyTaskOperations(
    [],
    [],
    operations,
    (() => {
      let number = 0;
      return () => `draft-${++number}`;
    })(),
  );
  assert.deepEqual(
    applied.reviewItems.map((task) => task.title),
    ["Call James", "Pick up supplies"],
  );
});

test("cancellations are held for confirmation instead of deleting a task", () => {
  const applied = applyTaskOperations(
    [],
    [{ ...bill, due: bill.due ?? "" }],
    [{ type: "cancel", targetId: "draft-bill" }],
    () => "unused",
  );
  assert.deepEqual(applied.cancelIds, ["draft-bill"]);
  assert.equal(applied.reviewItems.length, 0);
});

test("rejects an invalid date returned by an AI response", () => {
  assert.throws(() =>
    parseAssistantResult({
      message: "Here it is",
      operations: [
        {
          type: "create",
          targetId: null,
          question: null,
          task: {
            title: "Call Bill",
            person: "Bill",
            due: "next Friday",
            notes: "",
          },
        },
      ],
    }),
  );
});

test("builds date context in the user's time zone", () => {
  const context = localDateTimeContext(
    "America/Chicago",
    new Date("2026-10-17T01:00:00.000Z"),
  );
  assert.match(context, /Friday, October 16, 2026/);
  assert.match(context, /8:00 PM/);
});

test("reports a clear demo response when OpenAI credentials are unavailable", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await interpretPost(
      new Request("http://leadloop.test/api/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Call Bill tomorrow",
          timeZone: "America/Chicago",
          context: {},
        }),
      }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error:
        "OpenAI is not configured. Add OPENAI_API_KEY to enable voice and AI understanding.",
      code: "AI_NOT_CONFIGURED",
      demoMode: true,
    });
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
