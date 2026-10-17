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
                    task: {
                      title: "Talk to Bill about washing his clothes",
                      person: "Bill",
                      due: "2026-10-23T22:00:00.000Z",
                      notes: "",
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
                      task: {
                        title: "Talk to Bill about washing his clothes",
                        person: "Bill",
                        due: "2026-10-23T23:00:00.000Z",
                        notes: "",
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
                        task: {
                          title: "Talk to Ben about washing his clothes",
                          person: "Ben",
                          due: "2026-10-23T23:00:00.000Z",
                          notes: "",
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
