import { test, expect } from "@playwright/test";
test("capture, confirm, persist, edit, complete and delete a task", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A clear mind. A good day." }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await navigation
    .getByRole("button", { name: /^Capture(?: & review)?$/ })
    .click();
  await page
    .getByLabel("What do you need to remember?")
    .fill("Call Robin about the estimate");
  await page.getByRole("button", { name: "Review manually instead" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Person").fill("Robin");
  await dialog.getByLabel("Date & time").fill("2027-01-15T17:00");
  await dialog.getByRole("button", { name: "Confirm & save" }).click();
  await page.reload();
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await nav.getByRole("button", { name: /^Tasks/ }).click();
  await page.getByLabel("Search tasks").fill("Call Robin");
  await expect(
    page.getByText("Call Robin about the estimate", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Call Robin about the estimate" })
    .click();
  await dialog
    .getByLabel("Task", { exact: true })
    .fill("Call Robin about the revised estimate");
  await dialog.getByRole("button", { name: "Confirm & save" }).click();
  await expect(page.locator(".task-row")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Complete Call Robin about the revised estimate",
    })
    .click();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByText("Call Robin about the revised estimate", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Call Robin about the revised estimate" })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(0);
  await expect(page.getByText("No tasks match this view.")).toBeVisible();
});
test("shows a useful microphone-permission error and keeps text capture available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
      configurable: true,
    });
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await nav.getByRole("button", { name: /^Capture/ }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Microphone access was denied" }),
  ).toContainText("Microphone access was denied");
  await expect(page.getByLabel("What do you need to remember?")).toBeVisible();
});

test("keeps an unfinished reminder stable across clarification, correction, and a separate new task", async ({
  page,
}) => {
  const contexts: Array<Record<string, unknown>> = [];
  let billId = "";
  await page.route("**/api/interpret", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}") as {
      text: string;
      context: {
        availableDraftIds: string[];
        knownTasks: Array<{ id: string }>;
        pendingClarifications: unknown[];
      };
    };
    contexts.push(request.context);
    if (!billId) billId = request.context.availableDraftIds[0];
    const response =
      contexts.length === 1
        ? {
            transcript: request.text,
            result: {
              message: "When would you like to set this reminder?",
              operations: [
                {
                  type: "create",
                  targetId: billId,
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
                  targetIds: [billId],
                },
              ],
            },
          }
        : contexts.length === 2
          ? {
              transcript: request.text,
              result: {
                message: "I'll remind you next Friday at 5 PM.",
                operations: [
                  {
                    type: "update",
                    targetId: billId,
                    changes: {
                      due: "2026-10-23T22:00:00.000Z",
                    },
                  },
                ],
              },
            }
          : contexts.length === 3
            ? {
                transcript: request.text,
                result: {
                  message: "Updated to 6 PM.",
                  operations: [
                    {
                      type: "update",
                      targetId: billId,
                      changes: {
                        due: "2026-10-23T23:00:00.000Z",
                      },
                    },
                  ],
                },
              }
            : contexts.length === 4
              ? {
                  transcript: request.text,
                  result: {
                    message: "Updated Bill to Ben.",
                    operations: [
                      {
                        type: "update",
                        targetId: billId,
                        changes: {
                          title: "Talk to Ben about washing his clothes",
                          person: "Ben",
                        },
                      },
                    ],
                  },
                }
              : {
                  transcript: request.text,
                  result: {
                    message: "I added Sarah.",
                    operations: [
                      {
                        type: "create",
                        targetId: request.context.availableDraftIds[0],
                        task: {
                          title: "Call Sarah",
                          person: "Sarah",
                          due: "2026-10-18T14:00:00.000Z",
                          notes: "",
                        },
                      },
                    ],
                  },
                };
    await route.fulfill({ json: response });
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await nav.getByRole("button", { name: /^Capture(?: & review)?$/ }).click();
  const thought = page.getByLabel("What do you need to remember?");
  const understand = page.getByRole("button", {
    name: "Understand with LeadLoop",
  });
  await thought.fill("I need to talk to Bill about washing his clothes.");
  await understand.click();
  await expect(page.locator(".pending-question")).toContainText(
    "When would you like",
  );
  await thought.fill("Next Friday at 5 PM.");
  await understand.click();
  await expect(page.locator(".review-card")).toHaveCount(1);
  await expect(page.locator(".pending-question")).toHaveCount(0);
  await thought.fill("Actually, make it 6 PM.");
  await understand.click();
  await expect(page.locator(".review-card")).toHaveCount(1);
  await thought.fill("I meant Ben, not Bill.");
  await understand.click();
  await expect(
    page.getByRole("heading", {
      name: "Talk to Ben about washing his clothes",
    }),
  ).toBeVisible();
  await thought.fill("Remind me to call Sarah tomorrow at 9 AM.");
  await understand.click();
  await expect(page.locator(".review-card")).toHaveCount(2);
  await expect.poll(() => contexts.length).toBe(5);
  expect(contexts[1].knownTasks).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: billId })]),
  );
  expect(contexts[1].pendingClarifications).toEqual([
    expect.objectContaining({ taskIds: [billId] }),
  ]);
});

test("reviews one explicit Sarah update at 9 PM without mutating the saved task", async ({
  page,
}) => {
  const initialStore = {
    name: "Alex",
    business: "My business",
    timezone: "America/Chicago",
    people: [],
    tasks: [
      {
        id: "sarah-1",
        title: "Call Sarah about the new project",
        person: "Sarah",
        due: "2026-10-23T21:00:00.000Z",
        completed: false,
        notes: "Bring the proposal.",
      },
    ],
  };
  await page.addInitScript((store) => {
    localStorage.setItem("leadloop.phase1.v1", JSON.stringify(store));
  }, initialStore);
  let context: { knownTasks: Array<{ id: string }> } | undefined;
  await page.route("**/api/interpret", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}") as {
      context: { knownTasks: Array<{ id: string }> };
    };
    context = request.context;
    await route.fulfill({
      json: {
        transcript: "I wanna talk to her at 9 p.m.",
        result: {
          message: "I updated Sarah's reminder.",
          operations: [
            {
              type: "update",
              targetId: "sarah-1",
              changes: { due: "2026-10-24T02:00:00.000Z" },
            },
          ],
        },
      },
    });
  });
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await navigation.getByRole("button", { name: /^Capture/ }).click();
  await page
    .getByLabel("What do you need to remember?")
    .fill("I wanna talk to her at 9 p.m.");
  await page.getByRole("button", { name: "Understand with LeadLoop" }).click();
  const card = page.locator(".review-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("UPDATE TO REVIEW");
  await expect(card).toContainText("Call Sarah about the new project");
  await expect(card).toContainText("Sarah");
  await expect(card).toContainText("9:00 PM");
  await expect(card).not.toContainText("bobby true");
  expect(context?.knownTasks).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "sarah-1" })]),
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("leadloop.phase1.v1") ?? "{}"),
  );
  expect(saved.tasks[0].due).toBe("2026-10-23T21:00:00.000Z");
});

test("Continue speaking sends the same pending draft context through voice", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "leadloop.phase1.v1",
      JSON.stringify({
        name: "Alex",
        business: "My business",
        timezone: "America/Chicago",
        people: [],
        tasks: [],
      }),
    );
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(stream: MediaStream) {
        this.stream = stream;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["audio"], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      value: FakeRecorder,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
      configurable: true,
    });
  });
  let draftId = "";
  await page.route("**/api/interpret", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}") as {
      context: { availableDraftIds: string[] };
    };
    draftId = request.context.availableDraftIds[0];
    await route.fulfill({
      json: {
        transcript: "Talk to Bill about the proposal",
        result: {
          message: "When should I remind you?",
          operations: [
            {
              type: "create",
              targetId: draftId,
              task: {
                title: "Talk to Bill about the proposal",
                person: "Bill",
                due: null,
                notes: "",
              },
            },
            {
              type: "clarify",
              question: "When should I remind you?",
              targetIds: [draftId],
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/voice", async (route) => {
    await route.fulfill({
      json: {
        transcript: "Next Friday at 5 PM.",
        result: {
          message: "Updated to next Friday at 5 PM.",
          operations: [
            {
              type: "update",
              targetId: draftId,
              changes: { due: "2026-10-23T22:00:00.000Z" },
            },
          ],
        },
      },
    });
  });
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await navigation.getByRole("button", { name: /^Capture/ }).click();
  await page
    .getByLabel("What do you need to remember?")
    .fill("Talk to Bill about the proposal");
  await page.getByRole("button", { name: "Understand with LeadLoop" }).click();
  await page.getByRole("button", { name: "Continue speaking" }).click();
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await expect(page.locator(".review-card")).toHaveCount(1);
  await expect(page.locator(".review-card")).toContainText("5:00 PM");
  await expect(page.locator(".pending-question")).toHaveCount(0);
});
test("contacts can be created and retained and mobile layout fits", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name:
      page.viewportSize()!.width < 640
        ? "Mobile navigation"
        : "Main navigation",
  });
  await nav.getByRole("button", { name: "People" }).click();
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Robin Patel");
  await page.getByLabel("Notes", { exact: true }).fill("Call after lunch.");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.reload();
  await nav.getByRole("button", { name: "People" }).click();
  await expect(
    page.getByRole("heading", { name: "Robin Patel" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
