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
  const transcripts = [
    "Talk to Bill about washing his clothes.",
    "Tomorrow at 5 PM.",
    "Actually, make that 6 PM.",
    "Yes.",
    "Remind me to call Sarah tomorrow at 9 AM.",
    "Cancel.",
  ];
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
        transcript: transcripts[turn - 1],
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

test("partial month and weekday details stay incomplete until an exact valid date and time", async ({
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
  const intents = [
    {
      kind: "new_task",
      fields: {
        ...blankFields,
        title: "Set a reminder for",
        date: "2027-07-01",
        time: "12:00",
      },
    },
    {
      kind: "follow_up",
      fields: {
        ...blankFields,
        title: "Call Brad about his project",
        person: "Brad",
      },
    },
    {
      kind: "follow_up",
      fields: { ...blankFields, date: "2027-07-01", time: "15:00" },
    },
    { kind: "confirm", fields: blankFields },
  ];
  const transcripts = [
    "I want a reminder next July on a Saturday.",
    "Call Brad about his project.",
    "July 10 at 3 PM.",
    "Yes.",
  ];
  let turn = 0;
  await page.route("**/api/interpret", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: transcripts[turn - 1], result: { intent } },
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

  await reply.fill("I want a reminder next July on a Saturday.");
  await send.click();
  await expect(
    page.getByText("What would you like me to remind you about?"),
  ).toBeVisible();
  await expect(page.getByText("Listening for the task")).toBeVisible();
  await finishSpeech();

  await reply.fill("Call Brad about his project.");
  await send.click();
  await expect(
    page.getByText(/Which Saturday in July, and what time/),
  ).toBeVisible();
  await finishSpeech();

  await reply.fill("July 10 at 3 PM.");
  await send.click();
  await expect(page.locator(".assistant-message strong")).toContainText(
    "Saturday, July 10, 2027 at 3:00 PM",
  );
  await finishSpeech();

  await reply.fill("Yes.");
  await send.click();
  await expect(page.getByText("Reminder saved on this device.")).toBeVisible();
});

test("an ordinal follow-up resolves the current month and weekday without trusting the AI date", async ({
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
  const intents = [
    {
      kind: "new_task",
      fields: { ...blankFields, title: "Call Brad", date: "2027-07-01" },
    },
    {
      kind: "follow_up",
      fields: { ...blankFields, date: "2027-07-01" },
    },
    { kind: "follow_up", fields: { ...blankFields, time: "15:00" } },
  ];
  const transcripts = [
    "Remind me to call Brad on a Thursday next July.",
    "The fourth one.",
    "3 PM.",
  ];
  let turn = 0;
  await page.route("**/api/interpret", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: transcripts[turn - 1], result: { intent } },
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

  await reply.fill(transcripts[0]);
  await send.click();
  await expect(page.getByText(/Which Thursday in July/)).toBeVisible();
  await finishSpeech();

  await reply.fill(transcripts[1]);
  await send.click();
  await expect(page.getByText(/What time should I remind you/)).toBeVisible();
  await finishSpeech();

  await reply.fill(transcripts[2]);
  await send.click();
  await expect(page.locator(".assistant-message strong")).toContainText(
    "Thursday, July 22, 2027 at 3:00 PM",
  );
});

test("typed fifth Saturday resolves the pending July constraint instead of repeating its question", async ({
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
  const intents = [
    {
      kind: "new_task",
      fields: { ...blankFields, title: "order supplies", date: "2027-07-01" },
    },
    { kind: "none", fields: blankFields },
  ];
  const transcripts = [
    "Remind me to order supplies on a Saturday next July.",
    "The fifth Saturday.",
  ];
  let turn = 0;
  await page.route("**/api/interpret", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: transcripts[turn - 1], result: { intent } },
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

  await reply.fill(transcripts[0]);
  await send.click();
  await expect(page.getByText(/Which Saturday in July/)).toBeVisible();
  await finishSpeech();

  await reply.fill(transcripts[1]);
  await send.click();
  await expect(page.getByText(/What time should I remind you/)).toBeVisible();
  await expect(page.getByText(/Which Saturday in July/)).not.toBeVisible();
});

test("typed combined ordinal and time goes directly to reminder read-back", async ({
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
  const intents = [
    {
      kind: "new_task",
      fields: { ...blankFields, title: "order supplies", date: "2027-07-01" },
    },
    { kind: "confirm", fields: blankFields },
  ];
  const transcripts = [
    "Remind me to order supplies on a Saturday next July.",
    "The fifth Saturday at 5 PM.",
  ];
  let turn = 0;
  await page.route("**/api/interpret", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: transcripts[turn - 1], result: { intent } },
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

  await reply.fill(transcripts[0]);
  await send.click();
  await expect(page.getByText(/Which Saturday in July/)).toBeVisible();
  await finishSpeech();

  await reply.fill(transcripts[1]);
  await send.click();
  await expect(page.locator(".assistant-message strong")).toContainText(
    "Saturday, July 31, 2027 at 5:00 PM",
  );
  await expect(
    page.getByText(/What time should I remind you/),
  ).not.toBeVisible();
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
  const transcripts = [
    "Remind me to talk to Brad tomorrow.",
    "3 PM.",
    "Yes.",
    "No, that's all.",
  ];
  let turn = 0;
  await page.route("**/api/voice", async (route) => {
    const intent = intents[turn++];
    await route.fulfill({
      json: { transcript: transcripts[turn - 1], result: { intent } },
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

test("the first and next hands-free turns submit exactly once", async ({
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
          getTracks: () => [{ stop: () => {} }],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.assign(window, { __spoken: spoken, __recorders: recorders });
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
      fields: { ...blankFields, time: "05:00" },
    },
  ];
  let requests = 0;
  await page.route("**/api/voice", async (route) => {
    const index = requests++;
    await route.fulfill({
      json: {
        transcript:
          index === 0 ? "Talk to Brad tomorrow" : "Five in the morning",
        result: { intent: intents[index] },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await page.getByRole("button", { name: "Start Conversation" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(1);
  await page.evaluate(() => (window as any).__recorders[0].stop());
  await expect(page.getByText(/What time should I remind you/)).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await page.waitForTimeout(150);
  await expect.poll(() => requests).toBe(1);

  await page.evaluate(() =>
    (window as any).__spoken.at(-1)?.onend?.({} as SpeechSynthesisEvent),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(2);
  await page.evaluate(() => (window as any).__recorders[1].stop());
  await expect(page.locator(".assistant-message strong")).toContainText(
    "5:00 AM",
  );
  await expect(page.getByLabel("Or type your reply")).toHaveValue(
    "Five in the morning",
  );
  await expect.poll(() => requests).toBe(2);
  await page.waitForTimeout(150);
  await expect.poll(() => requests).toBe(2);
});

test("a stale microphone request cannot capture a new session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const recorders: unknown[] = [];
    const resolvers: Array<(stream: MediaStream) => void> = [];
    class TestRecorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      constructor(_stream: MediaStream) {
        recorders.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => resolvers.push(resolve)),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestRecorder,
    });
    Object.assign(window, {
      __recorders: recorders,
      __microphoneRequests: () => resolvers.length,
      __resolveStream: (index: number) =>
        resolvers[index]?.({
          getTracks: () => [{ stop: () => {} }],
        } as unknown as MediaStream),
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await page
    .getByRole("button", { name: "Start Conversation" })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__microphoneRequests()))
    .toBe(1);
  await page.getByRole("button", { name: "End Conversation" }).click();
  await page
    .getByRole("button", { name: "Start Conversation" })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__microphoneRequests()))
    .toBe(2);
  await page.evaluate(() => (window as any).__resolveStream(0));
  await page.waitForTimeout(100);
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(0);
  await page.evaluate(() => (window as any).__resolveStream(1));
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(1);
});

test("speech playback failure keeps the reply visible and safely resumes listening", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const recorders: Array<{
      state: string;
      stop: () => void;
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
    }> = [];
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
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) =>
          queueMicrotask(() =>
            utterance.onerror?.({} as SpeechSynthesisErrorEvent),
          ),
        cancel: () => {},
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.assign(window, { __recorders: recorders });
  });
  await page.route("**/api/voice", async (route) => {
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
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(1);
  await page.evaluate(() => (window as any).__recorders[0].stop());
  await expect(page.getByText(/Is that correct/)).toBeVisible();
  await expect(page.locator(".voice-alert")).toContainText(
    "couldn't play that response aloud",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__recorders.length))
    .toBe(2);
});

test("ten consecutive voice turns submit once each without overlapping recordings", async ({
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
          getTracks: () => [{ stop: () => {} }],
        }),
      },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestRecorder,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.assign(window, { __spoken: spoken, __recorders: recorders });
  });
  let requests = 0;
  await page.route("**/api/voice", async (route) => {
    const turn = requests++;
    const taskNumber = Math.floor(turn / 2) + 1;
    const intent =
      turn % 2 === 0
        ? {
            kind: "new_task",
            fields: {
              ...blankFields,
              title: `call person ${taskNumber}`,
              person: `Person ${taskNumber}`,
              date: "2026-10-20",
              time: "09:00",
            },
          }
        : { kind: "confirm", fields: blankFields };
    await route.fulfill({
      json: { transcript: `voice turn ${turn + 1}`, result: { intent } },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation/ })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await page.getByRole("button", { name: "Start Conversation" }).click();
  for (let turn = 0; turn < 10; turn += 1) {
    await expect
      .poll(() => page.evaluate(() => (window as any).__recorders.length))
      .toBe(turn + 1);
    await page.evaluate(
      (index) => (window as any).__recorders[index].stop(),
      turn,
    );
    await expect.poll(() => requests).toBe(turn + 1);
    if (turn < 9) {
      await page.evaluate(() =>
        (window as any).__spoken.at(-1)?.onend?.({} as SpeechSynthesisEvent),
      );
    }
  }
  await page.waitForTimeout(150);
  await expect.poll(() => requests).toBe(10);
  await expect(
    page.getByText("Conversation ended — microphone off."),
  ).toHaveCount(0);
});

test("one browser session keeps consecutive reminder drafts independent", async ({
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
  const turns = [
    {
      // No year: this must use the active draft's frozen local reference and
      // choose the next upcoming June, even after later drafts start.
      transcript: "Remind me to order supplies on a Saturday in June.",
      intent: {
        kind: "new_task",
        fields: { ...blankFields, title: "order supplies" },
      },
    },
    {
      transcript: "The second Saturday at 5 PM.",
      intent: { kind: "none", fields: blankFields },
    },
    { transcript: "Yes.", intent: { kind: "confirm", fields: blankFields } },
    {
      transcript: "Remind me to review invoices on a Saturday in August 2027.",
      intent: {
        kind: "new_task",
        fields: { ...blankFields, title: "review invoices" },
      },
    },
    {
      transcript: "The second Saturday at 10 AM.",
      intent: { kind: "confirm", fields: blankFields },
    },
    { transcript: "Yes.", intent: { kind: "confirm", fields: blankFields } },
    {
      transcript: "Remind me to call Dana on a Friday in July 2027.",
      intent: {
        kind: "new_task",
        fields: { ...blankFields, title: "call Dana" },
      },
    },
    {
      transcript: "The second Friday at 9 AM.",
      intent: { kind: "new_task", fields: blankFields },
    },
    { transcript: "Yes.", intent: { kind: "confirm", fields: blankFields } },
    {
      transcript: "Remind me to draft a proposal.",
      intent: {
        kind: "new_task",
        fields: { ...blankFields, title: "draft a proposal" },
      },
    },
    { transcript: "Cancel.", intent: { kind: "cancel", fields: blankFields } },
    {
      transcript: "Remind me to renew the license on July 1 2028 at 9 AM.",
      intent: {
        kind: "new_task",
        fields: { ...blankFields, title: "renew the license" },
      },
    },
    { transcript: "Yes.", intent: { kind: "confirm", fields: blankFields } },
  ];
  let index = 0;
  await page.route("**/api/interpret", async (route) => {
    const turn = turns[index++];
    await route.fulfill({
      json: { transcript: turn.transcript, result: { intent: turn.intent } },
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
  for (const [turnIndex, turn] of turns.entries()) {
    await reply.fill(turn.transcript);
    await send.click();
    await page.waitForFunction(
      (count) =>
        (
          window as unknown as Window & {
            __spoken: SpeechSynthesisUtterance[];
          }
        ).__spoken.length >= count,
      turnIndex + 1,
    );
    await finishSpeech();
  }
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("leadloop.phase1.v1");
    return raw
      ? (JSON.parse(raw).tasks as Array<{ title: string; due: string }>)
      : [];
  });
  for (const title of [
    "order supplies",
    "review invoices",
    "call Dana",
    "renew the license",
  ])
    expect(saved.filter((task) => task.title === title)).toHaveLength(1);
  expect(saved.some((task) => task.title === "draft a proposal")).toBeFalsy();
  expect(saved).toHaveLength(9); // five samples plus four confirmed reminders
});
