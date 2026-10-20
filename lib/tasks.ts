export type Task = {
  id: string;
  title: string;
  person: string;
  due: string;
  completed: boolean;
  notes: string;
};
export type Person = {
  id: string;
  name: string;
  business: string;
  email: string;
  notes: string;
};
export type Store = {
  tasks: Task[];
  people: Person[];
  name: string;
  business: string;
  timezone: string;
  /** User preference for future working-day language; weekends stay valid unless requested otherwise. */
  workingDays: number[];
};
export const STORAGE_KEY = "leadloop.phase1.v1";
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] as const;

export function normalizeWorkingDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKING_DAYS];
  const days = [
    ...new Set(
      value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((left, right) => left - right);
  return days.length ? days : [...DEFAULT_WORKING_DAYS];
}
export function saveTask(tasks: Task[], task: Task): Task[] {
  if (!task.title.trim()) throw new Error("Give your task a name.");
  if (task.due && Number.isNaN(Date.parse(task.due)))
    throw new Error("Choose a valid date and time.");
  return tasks.some((t) => t.id === task.id)
    ? tasks.map((t) => (t.id === task.id ? task : t))
    : [...tasks, task];
}
export function sampleStore(): Store {
  const due = (days: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  return {
    name: "Alex",
    business: "My business",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    workingDays: [...DEFAULT_WORKING_DAYS],
    tasks: [
      {
        id: "sample-1",
        title: "Follow up on the kitchen estimate",
        person: "James Wilson",
        due: due(0, 14),
        completed: false,
        notes: "Check whether James has any questions before the weekend.",
      },
      {
        id: "sample-2",
        title: "Order supplies for next week",
        person: "",
        due: due(0, 16),
        completed: false,
        notes: "Check inventory before placing the order.",
      },
      {
        id: "sample-3",
        title: "Call Sarah about the new project",
        person: "Sarah Chen",
        due: due(1, 10),
        completed: false,
        notes: "",
      },
      {
        id: "sample-4",
        title: "Send the updated proposal",
        person: "Bill Davis",
        due: due(-1, 15),
        completed: false,
        notes: "",
      },
      {
        id: "sample-5",
        title: "Review this week’s schedule",
        person: "",
        due: due(-1, 9),
        completed: true,
        notes: "",
      },
    ],
    people: [
      {
        id: "p1",
        name: "James Wilson",
        business: "Customer · Kitchen renovation",
        email: "",
        notes: "Interested in a kitchen renovation. Follow up on the estimate.",
      },
      {
        id: "p2",
        name: "Sarah Chen",
        business: "Customer · New project",
        email: "",
        notes: "Prefers a call in the morning.",
      },
      {
        id: "p3",
        name: "Bill Davis",
        business: "Business contact",
        email: "",
        notes: "Send updated proposal.",
      },
    ],
  };
}
export function dateLabel(iso: string, timezone: string): string {
  return iso
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(iso))
    : "No reminder time";
}
export function isToday(iso: string, timezone: string): boolean {
  if (!iso) return false;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  return f.format(new Date(iso)) === f.format(new Date());
}
export function toLocalInput(iso: string, timezone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function zonedParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(
    parts
      .filter((entry) => entry.type !== "literal")
      .map((entry) => [entry.type, Number(entry.value)]),
  ) as Record<string, number>;
}

export function fromLocalInput(value: string, timezone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Choose a valid date and time.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wanted = { year, month, day, hour, minute };
  let timestamp = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedParts(timestamp, timezone);
    const wallClock = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    timestamp += Date.UTC(year, month - 1, day, hour, minute) - wallClock;
  }
  const verified = zonedParts(timestamp, timezone);
  if (
    verified.year !== wanted.year ||
    verified.month !== wanted.month ||
    verified.day !== wanted.day ||
    verified.hour !== wanted.hour ||
    verified.minute !== wanted.minute
  ) {
    throw new Error(
      "That local time does not exist in your selected time zone.",
    );
  }
  return new Date(timestamp).toISOString();
}
