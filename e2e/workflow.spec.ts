import { test, expect } from "@playwright/test";

const blankFields = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

test("drive-through reminder conversation speaks, corrects, confirms, starts over, and cancels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const spoken: SpeechSynthesisUtterance[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance),
        cancel: () => {},
      },
    });
    (
      window as unknown as Window & { __spoken: SpeechSynthesisUtterance[] }
    ).__spoken = spoken;
  });
  let turn = 0;
  await page.route("**/api/interpret", async (route) => {
    turn += 1;
    const intents = [
      {
        kind: "new_task",
        fields: {
          ...blankFields,
          title: "talk to Bill about washing his clothes",
          person: "Bill",
        },
      },
      {
        kind: "follow_up",
        fields: { ...blankFields, date: "2026-10-20", time: "17:00" },
      },
      { kind: "update", fields: { ...blankFields, time: "18:00" } },
      { kind: "confirm", fields: blankFields },
      {
        kind: "new_task",
        fields: {
          ...blankFields,
          title: "call Sarah",
          person: "Sarah",
          date: "2026-10-21",
          time: "09:00",
        },
      },
      { kind: "cancel", fields: blankFields },
    ];
    await route.fulfill({
      json: {
        transcript: `turn ${turn}`,
        result: { intent: intents[turn - 1] },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  const reply = page.getByLabel("Or type your reply");
  const send = page.getByRole("button", { name: /Send reply/ });
  const finishSpeech = () =>
    page.evaluate(() => {
      const spoken = (
        window as unknown as Window & { __spoken: SpeechSynthesisUtterance[] }
      ).__spoken;
      spoken.at(-1)?.onend?.({} as SpeechSynthesisEvent);
    });

  await reply.fill("Talk to Bill about washing his clothes.");
  await send.click();
  await expect(
    page.getByText("Sure! When would you like me to remind you?"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "LeadLoop is speaking" }),
  ).toBeDisabled();
  await finishSpeech();

  await reply.fill("Tomorrow at 5 PM.");
  await send.click();
  await expect(page.getByText(/Is that correct/)).toBeVisible();
  await expect(
    page.getByText("talk to Bill about washing his clothes", { exact: true }),
  ).toBeVisible();
  await finishSpeech();

  await reply.fill("Actually, make that 6 PM.");
  await send.click();
  await expect(page.locator(".assistant-message strong")).toContainText(
    "6:00 PM",
  );
  await finishSpeech();

  await reply.fill("Yes.");
  await send.click();
  await expect(
    page.getByText("Perfect! Your reminder is saved. Anything else?"),
  ).toBeVisible();
  await finishSpeech();

  await reply.fill("Remind me to call Sarah tomorrow at 9 AM.");
  await send.click();
  await expect(page.getByText("call Sarah", { exact: true })).toBeVisible();
  await finishSpeech();

  await reply.fill("Cancel.");
  await send.click();
  await expect(
    page.getByText(/canceled that unfinished reminder/),
  ).toBeVisible();
});

test("a rate-limited follow-up preserves the active reminder and shows retry timing", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/interpret", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        json: {
          transcript: "Talk to Bill",
          result: {
            intent: {
              kind: "new_task",
              fields: { ...blankFields, title: "talk to Bill", person: "Bill" },
            },
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 429,
      json: {
        error:
          "LeadLoop is receiving too many requests. Please try again shortly.",
        code: "LOCAL_RATE_LIMIT",
        retryAfterSeconds: 3,
        rateLimitSource: "internal",
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  const reply = page.getByLabel("Or type your reply");
  const send = page.getByRole("button", { name: /Send reply/ });
  await reply.fill("Talk to Bill");
  await send.click();
  await expect(page.getByText("talk to Bill", { exact: true })).toBeVisible();
  await reply.fill("Tomorrow at 5 PM");
  await send.click();
  await expect(page.getByText(/retry in 3s/)).toBeVisible();
  await expect(page.getByText("talk to Bill", { exact: true })).toBeVisible();
});
