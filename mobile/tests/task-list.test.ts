import assert from "node:assert/strict";
import test from "node:test";
import { mobileTaskSections } from "../src/task-list";
import { loadMobileWorkspace, type MobileWorkspace } from "../src/repository";

const workspace: MobileWorkspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Test Business",
  businessName: "Test Business",
  role: "owner",
};

function workspaceClient(taskRows: unknown[]) {
  const resultFor = (table: string) => ({
    data:
      table === "workspace_preferences"
        ? { timezone: "America/Chicago" }
        : table === "tasks"
          ? taskRows
          : [],
    error: null,
  });
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                single: () => resultFor(table),
                order: () => resultFor(table),
                ...resultFor(table),
              };
            },
          };
        },
      };
    },
  } as never;
}

test("a fresh cloud reload keeps tomorrow's open 3 PM reminder in Upcoming", async () => {
  const data = await loadMobileWorkspace(
    workspaceClient([
      {
        id: "call-mike-tomorrow",
        title: "Call Mike",
        person: "Mike",
        due: "2026-10-23T20:00:00.000Z",
        completed: false,
        notes: "",
      },
      {
        id: "today-task",
        title: "Finish today's work",
        person: "",
        // October 23 UTC is still 11:30 PM on October 22 in Chicago.
        due: "2026-10-23T04:30:00.000Z",
        completed: false,
        notes: "",
      },
    ]),
    workspace,
  );

  const sections = mobileTaskSections(
    data.tasks,
    data.timezone,
    new Date("2026-10-22T17:00:00.000Z"),
  );
  assert.deepEqual(
    sections.map((section) => [
      section.title,
      section.data.map((task) => task.id),
    ]),
    [
      ["Today", ["today-task"]],
      ["Upcoming", ["call-mike-tomorrow"]],
    ],
  );
});

test("a string false from an older payload cannot hide an open cloud reminder", () => {
  const sections = mobileTaskSections(
    [
      {
        id: "legacy-open-task",
        title: "Call Mike",
        person: "Mike",
        due: "2026-10-23T20:00:00.000Z",
        completed: "false" as unknown as boolean,
        notes: "",
      },
    ],
    "America/Chicago",
    new Date("2026-10-22T17:00:00.000Z"),
  );
  assert.deepEqual(
    sections[0]?.data.map((task) => task.id),
    ["legacy-open-task"],
  );
});
