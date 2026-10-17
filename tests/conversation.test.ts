import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advancePendingClarifications,
  applyTaskOperations,
  localDateTimeContext,
  parseConversationContext,
  parseAssistantResult,
  type ReviewItem,
} from "../lib/conversation";
import { POST as interpretPost } from "../app/api/interpret/route";
import { normalizeAndValidateUpdates } from "../lib/ai-server";

const bill: ReviewItem = {
  id: "draft-bill",
  source: "new",
  title: "Talk to Bill about washing his clothes",
  person: "Bill",
  due: "2026-10-23T22:00:00.000Z",
  notes: "",
};

test("Scenario B: keeps an existing draft id when a contextual correction changes its time", () => {
  const result = parseAssistantResult({
    message: "Updated to 6 PM.",
    operations: [
      {
        type: "update",
        targetId: "draft-bill",
        targetIds: [],
        question: null,
        task: null,
        changes: {
          title: null,
          person: null,
          due: "2026-10-23T23:00:00.000Z",
          notes: null,
          clearDue: false,
        },
      },
    ],
  });
  const applied = applyTaskOperations([bill], [], result.operations);
  assert.equal(applied.reviewItems.length, 1);
  assert.equal(applied.reviewItems[0].id, "draft-bill");
  assert.equal(applied.reviewItems[0].due, "2026-10-23T23:00:00.000Z");
});

test("keeps multiple tasks from one thought separate", () => {
  const operations = [
    {
      type: "create" as const,
      targetId: "draft-james",
      task: {
        title: "Call James",
        person: "James",
        due: "2026-10-23T15:00:00.000Z",
        notes: "",
      },
    },
    {
      type: "create" as const,
      targetId: "draft-supplies",
      task: {
        title: "Pick up supplies",
        person: "",
        due: "2026-10-23T15:00:00.000Z",
        notes: "",
      },
    },
  ];
  const applied = applyTaskOperations([], [], operations);
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
          targetId: "draft-bill",
          targetIds: [],
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

test("Scenario A: a time answer updates the unfinished Bill draft", () => {
  const initial = applyTaskOperations(
    [],
    [],
    [
      {
        type: "create",
        targetId: "draft-bill",
        task: {
          title: "Talk to Bill about washing his clothes",
          person: "Bill",
          due: null,
          notes: "",
        },
      },
      {
        type: "clarify",
        question: "When would you like to set this reminder?",
        targetIds: ["draft-bill"],
      },
    ],
  );
  const pending = advancePendingClarifications([], initial);
  assert.deepEqual(pending, [
    {
      question: "When would you like to set this reminder?",
      taskIds: ["draft-bill"],
    },
  ]);
  const answer = applyTaskOperations(
    initial.reviewItems,
    [],
    [
      {
        type: "update",
        targetId: "draft-bill",
        changes: {
          due: "2026-10-23T22:00:00.000Z",
        },
      },
    ],
  );
  assert.equal(answer.reviewItems.length, 1);
  assert.equal(answer.reviewItems[0].id, "draft-bill");
  assert.equal(answer.reviewItems[0].due, "2026-10-23T22:00:00.000Z");
  assert.deepEqual(advancePendingClarifications(pending, answer), []);
});

test("Scenario C: a contact correction preserves the reminder date and unrelated fields", () => {
  const corrected = applyTaskOperations(
    [
      {
        ...bill,
        due: "2026-10-23T23:00:00.000Z",
        notes: "Call after closing.",
      },
    ],
    [],
    [
      {
        type: "update",
        targetId: "draft-bill",
        changes: {
          title: "Talk to Ben about washing his clothes",
          person: "Ben",
        },
      },
    ],
  );
  assert.deepEqual(corrected.reviewItems[0], {
    id: "draft-bill",
    source: "new",
    title: "Talk to Ben about washing his clothes",
    person: "Ben",
    due: "2026-10-23T23:00:00.000Z",
    notes: "Call after closing.",
  });
});

test("Scenario D: a clearly new Sarah task does not overwrite an unfinished Bill draft", () => {
  const result = applyTaskOperations(
    [bill],
    [],
    [
      {
        type: "create",
        targetId: "draft-sarah",
        task: {
          title: "Call Sarah",
          person: "Sarah",
          due: "2026-10-17T14:00:00.000Z",
          notes: "",
        },
      },
    ],
  );
  assert.deepEqual(
    result.reviewItems.map((item) => item.id),
    ["draft-bill", "draft-sarah"],
  );
});

test("Scenario C: a contextual Sarah update removes a duplicate create, preserves fields, and uses 9 PM", () => {
  const sarah = {
    id: "sarah-1",
    title: "Call Sarah about the new project",
    person: "Sarah",
    due: "2026-10-23T21:00:00.000Z",
    notes: "Bring the proposal.",
  };
  const result = normalizeAndValidateUpdates(
    {
      message: "Updated Sarah.",
      operations: [
        {
          type: "create",
          targetId: "draft-duplicate",
          task: {
            title: "Call Sarah",
            person: "bobby true",
            due: null,
            notes: "",
          },
        },
        {
          type: "update",
          targetId: sarah.id,
          changes: { due: "2026-10-23T21:00:00.000Z", person: "bobby true" },
        },
      ],
    },
    "I wanna talk to her at 9 p.m.",
    "America/Chicago",
    {
      history: [],
      knownTasks: [sarah],
      pendingClarifications: [],
      availableDraftIds: ["draft-duplicate"],
    },
  );
  assert.equal(result.operations.length, 1);
  assert.deepEqual(result.operations[0], {
    type: "update",
    targetId: sarah.id,
    changes: { due: "2026-10-24T02:00:00.000Z" },
  });
  const applied = applyTaskOperations([], [sarah], result.operations);
  assert.equal(applied.reviewItems.length, 1);
  assert.deepEqual(applied.reviewItems[0], {
    ...sarah,
    source: "existing",
    due: "2026-10-24T02:00:00.000Z",
  });
  assert.equal(sarah.due, "2026-10-23T21:00:00.000Z");
});

test("Scenario D: an explicit contact correction preserves its title, date, time, and notes", () => {
  const applied = applyTaskOperations(
    [],
    [
      {
        id: "bobby-1",
        title: "Call Bobby about the new project",
        person: "Bobby",
        due: "2026-10-24T02:00:00.000Z",
        notes: "Bring the proposal.",
      },
    ],
    [{ type: "update", targetId: "bobby-1", changes: { person: "Sarah" } }],
  );
  assert.deepEqual(applied.reviewItems[0], {
    id: "bobby-1",
    source: "existing",
    title: "Call Bobby about the new project",
    person: "Sarah",
    due: "2026-10-24T02:00:00.000Z",
    notes: "Bring the proposal.",
  });
});

test("Scenario F: multiple matching reminders retain both targets for a clarification", () => {
  const clarification = applyTaskOperations(
    [],
    [],
    [
      {
        type: "clarify",
        question: "Which Sarah reminder should I update?",
        targetIds: ["sarah-1", "sarah-2"],
      },
    ],
  );
  assert.deepEqual(clarification.clarification, {
    question: "Which Sarah reminder should I update?",
    taskIds: ["sarah-1", "sarah-2"],
  });
});

test("keeps multiple pending task references so the AI can ask which one a follow-up means", () => {
  const context = parseConversationContext({
    knownTasks: [
      {
        id: "draft-bill",
        title: "Talk to Bill",
        person: "Bill",
        due: "",
        notes: "",
      },
      {
        id: "draft-sarah",
        title: "Call Sarah",
        person: "Sarah",
        due: "",
        notes: "",
      },
    ],
    pendingClarifications: [
      {
        question: "What time for these reminders?",
        taskIds: ["draft-bill", "draft-sarah"],
      },
    ],
    availableDraftIds: ["draft-new-1"],
  });
  assert.deepEqual(context.pendingClarifications[0].taskIds, [
    "draft-bill",
    "draft-sarah",
  ]);
  assert.deepEqual(context.availableDraftIds, ["draft-new-1"]);
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
