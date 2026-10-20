export type Task = {
  id: string;
  title: string;
  person: string;
  /** Optional stable link to a local customer record. Legacy person text stays supported. */
  personId?: string;
  due: string;
  completed: boolean;
  notes: string;
};

export type CustomerInteraction = {
  id: string;
  note: string;
  createdAt: string;
};

export type Person = {
  id: string;
  name: string;
  business: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  interactions: CustomerInteraction[];
  createdAt: string;
  updatedAt: string;
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

export function persistStore(storage: Pick<Storage, "setItem">, store: Store) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function normalizeWorkingDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKING_DAYS];
  const days = [
    ...new Set(
      value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ].sort((left, right) => left - right);
  return days.length ? days : [...DEFAULT_WORKING_DAYS];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function validDate(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

/** Adds Phase 1 customer fields without changing old IDs, reminders, or timezone data. */
export function migrateStore(
  value: unknown,
  now = new Date().toISOString(),
): Store {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved workspace.");
  const saved = value as Record<string, unknown>;
  if (
    !Array.isArray(saved.tasks) ||
    !Array.isArray(saved.people) ||
    typeof saved.timezone !== "string"
  )
    throw new Error("Invalid saved workspace.");
  return {
    tasks: saved.tasks.map((task) => {
      const record = task as Record<string, unknown>;
      return {
        id: stringValue(record.id),
        title: stringValue(record.title),
        person: stringValue(record.person),
        ...(typeof record.personId === "string" && record.personId
          ? { personId: record.personId }
          : {}),
        due: stringValue(record.due),
        completed: Boolean(record.completed),
        notes: stringValue(record.notes),
      };
    }),
    people: saved.people.map((person) => {
      const record = person as Record<string, unknown>;
      const createdAt = validDate(record.createdAt, now);
      return {
        id: stringValue(record.id),
        name: stringValue(record.name),
        business: stringValue(record.business),
        email: stringValue(record.email),
        phone: stringValue(record.phone),
        address: stringValue(record.address),
        notes: stringValue(record.notes),
        interactions: Array.isArray(record.interactions)
          ? record.interactions
              .filter(
                (entry) =>
                  entry &&
                  typeof entry === "object" &&
                  typeof (entry as Record<string, unknown>).note === "string",
              )
              .map((entry, index) => {
                const note = entry as Record<string, unknown>;
                return {
                  id:
                    typeof note.id === "string" && note.id
                      ? note.id
                      : `${record.id || "legacy-person"}-interaction-${index}`,
                  note: note.note as string,
                  createdAt: validDate(note.createdAt, createdAt),
                };
              })
          : [],
        createdAt,
        updatedAt: validDate(record.updatedAt, createdAt),
      };
    }),
    name: stringValue(saved.name),
    business: stringValue(saved.business),
    timezone: saved.timezone,
    workingDays: normalizeWorkingDays(saved.workingDays),
  };
}
export function saveTask(tasks: Task[], task: Task): Task[] {
  if (!task.title.trim()) throw new Error("Give your task a name.");
  if (task.due && Number.isNaN(Date.parse(task.due)))
    throw new Error("Choose a valid date and time.");
  return tasks.some((t) => t.id === task.id)
    ? tasks.map((t) => (t.id === task.id ? task : t))
    : [...tasks, task];
}

function normalizedPersonName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Returns the reminders that safely belong to one customer.
 *
 * A stable `personId` always wins. Older reminders with only a `person` name
 * can be shown only when exactly one saved customer has that exact name; this
 * deliberately leaves legacy reminders unlinked when names are ambiguous.
 */
export function remindersForPerson(
  tasks: Task[],
  people: Person[],
  person: Person,
): Task[] {
  const name = normalizedPersonName(person.name);
  const uniqueName =
    Boolean(name) &&
    people.filter((candidate) => normalizedPersonName(candidate.name) === name)
      .length === 1;

  return tasks
    .filter((task) => {
      if (task.personId) return task.personId === person.id;
      return uniqueName && normalizedPersonName(task.person) === name;
    })
    .slice()
    .sort((left, right) => {
      if (!left.due && !right.due) return left.title.localeCompare(right.title);
      if (!left.due) return 1;
      if (!right.due) return -1;
      return (
        left.due.localeCompare(right.due) ||
        left.title.localeCompare(right.title)
      );
    });
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
        phone: "",
        address: "",
        notes: "Interested in a kitchen renovation. Follow up on the estimate.",
        interactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        name: "Sarah Chen",
        business: "Customer · New project",
        email: "",
        phone: "",
        address: "",
        notes: "Prefers a call in the morning.",
        interactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p3",
        name: "Bill Davis",
        business: "Business contact",
        email: "",
        phone: "",
        address: "",
        notes: "Send updated proposal.",
        interactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
