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
};
export const STORAGE_KEY = "leadloop.phase1.v1";
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
export function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
