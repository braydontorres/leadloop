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
