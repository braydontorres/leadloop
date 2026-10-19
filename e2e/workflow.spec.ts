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
  await page.getByRole("button", { name: "Start Conversation" }).click();
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
  await page.getByRole("button", { name: "Start Conversation" }).click();
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

test("a delayed interpretation reports Thinking instead of a false listening state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { speak: () => {}, cancel: () => {} },
    });
  });
  await page.route("**/api/interpret", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      json: {
        transcript: "Call Sam tomorrow at 9 AM",
        result: {
          intent: {
            kind: "new_task",
            fields: {
              ...blankFields,
              title: "call Sam",
              person: "Sam",
              date: "2026-10-20",
              time: "09:00",
            },
          },
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await page.getByRole("button", { name: "Start Conversation" }).click();
  await page.getByLabel("Or type your reply").fill("Call Sam tomorrow at 9 AM");
  await page.getByRole("button", { name: /Send reply/ }).click();
  await expect(page.getByText("Thinking", { exact: true })).toBeVisible();
  await expect(page.getByText("call Sam", { exact: true })).toBeVisible();
});

test("a single manual start alternates speech and recording, then a goodbye releases the microphone", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const recorders: Array<{
      state: string;
      stop: () => void;
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
    }> = [];
    let stoppedTracks = 0;
    class TestRecorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor(
        public stream: MediaStream,
        options?: MediaRecorderOptions,
      ) {
        this.mimeType = options?.mimeType || this.mimeType;
        recorders.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["voice"], { type: this.mimeType }),
        });
        this.onstop?.();
      }
    }
    const voiceFrames: number[] = [];
    class TestAudioContext {
      state = "running";
      createMediaStreamSource() {
        return { connect: () => {}, disconnect: () => {} };
      }
      createBiquadFilter() {
        return {
          type: "highpass",
          frequency: { value: 0 },
          connect: () => {},
          disconnect: () => {},
        };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (samples: Uint8Array) => {
            const index = Math.max(0, recorders.length - 1);
            const frame = voiceFrames[index] ?? 0;
            voiceFrames[index] = frame + 1;
            // A short utterance followed by sustained silence.
            samples.fill(frame < 14 ? 176 : 128);
          },
        };
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance),
        cancel: () => {},
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => stoppedTracks++ }],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: TestAudioContext,
    });
    Object.assign(window, {
      __spoken: spoken,
      __recorders: recorders,
      __stoppedTracks: () => stoppedTracks,
    });
  });
  const intents = [
    {
      kind: "new_task",
      fields: {
        ...blankFields,
        title: "talk to Brad",
        person: "Brad",
        date: "2026-10-20",
      },
    },
    {
      kind: "follow_up",
      fields: { ...blankFields, date: "2026-10-20", time: "15:00" },
    },
    { kind: "confirm", fields: blankFields },
    { kind: "end_conversation", fields: blankFields },
  ];
  let turn = 0;
  await page.route("**/api/voice", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: `voice turn ${turn}`, result: { intent } },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await page.getByRole("button", { name: "Start Conversation" }).click();
  const finishLatestReply = () =>
    page.evaluate(() => {
      (
        window as unknown as Window & {
          __spoken: SpeechSynthesisUtterance[];
        }
      ).__spoken
        .at(-1)
        ?.onend?.({} as SpeechSynthesisEvent);
    });
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(1);
  await expect(page.getByText(/What time should I remind you/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(1);
  await finishLatestReply();
  await expect(page.getByText(/Is that correct/)).toBeVisible();
  await finishLatestReply();
  await expect(page.getByText(/Your reminder is saved/)).toBeVisible();
  await finishLatestReply();
  await expect(
    page.getByText("Conversation ended — microphone off."),
  ).toBeVisible();
  await finishLatestReply();
  await page.waitForTimeout(300);
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(4);
  await expect
    .poll(() => page.evaluate(() => (window as any).__stoppedTracks()))
    .toBeGreaterThanOrEqual(4);
});
