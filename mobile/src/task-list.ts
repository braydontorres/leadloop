import type { Task } from "../../lib/tasks";

export type MobileTaskSection = {
  title: "Today" | "Upcoming" | "Overdue" | "No scheduled time";
  data: Task[];
};

export type MobileTaskFilter = "Upcoming" | "Overdue" | "Completed" | "All";

export function localIsoDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function localTimeInput(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("hour")}:${part("minute")}`;
}

function taskDate(task: Task, timeZone: string) {
  if (!task.due || Number.isNaN(Date.parse(task.due))) return null;
  return localIsoDate(new Date(task.due), timeZone);
}

function byDue(left: Task, right: Task) {
  const leftTime = left.due ? Date.parse(left.due) : Number.POSITIVE_INFINITY;
  const rightTime = right.due
    ? Date.parse(right.due)
    : Number.POSITIVE_INFINITY;
  return leftTime - rightTime || left.title.localeCompare(right.title);
}

/**
 * The Tasks screen and its tests share one timezone-aware definition of a
 * reminder's status. An unscheduled open task stays visible in Upcoming so it
 * cannot disappear just because it needs a date.
 */
export function filterMobileTasks(
  tasks: Task[],
  timeZone: string,
  filter: MobileTaskFilter,
  search: string,
  now = new Date(),
) {
  const today = localIsoDate(now, timeZone);
  const query = search.trim().toLowerCase();
  return tasks
    .filter((task) => {
      const date = taskDate(task, timeZone);
      const matchesFilter =
        filter === "All" ||
        (filter === "Completed" && task.completed === true) ||
        (filter === "Upcoming" &&
          task.completed !== true &&
          (!date || date >= today)) ||
        (filter === "Overdue" &&
          task.completed !== true &&
          date !== null &&
          date < today);
      return (
        matchesFilter &&
        (!query || `${task.title} ${task.person}`.toLowerCase().includes(query))
      );
    })
    .sort(byDue);
}

/**
 * Keep current-day reminders visible without hiding the next scheduled work.
 * Database instants are always compared in the workspace's configured zone.
 */
export function mobileTaskSections(
  tasks: Task[],
  timeZone: string,
  now = new Date(),
): MobileTaskSection[] {
  const today = localIsoDate(now, timeZone);
  const sections: MobileTaskSection[] = [
    { title: "Today", data: [] },
    { title: "Upcoming", data: [] },
    { title: "Overdue", data: [] },
    { title: "No scheduled time", data: [] },
  ];
  const [todaySection, upcoming, overdue, unscheduled] = sections;

  for (const task of tasks) {
    // A boolean false from PostgREST must remain open. Treat only an actual
    // true value as completed so inconsistent legacy payloads cannot hide it.
    if (task.completed === true) continue;
    const dueDate = taskDate(task, timeZone);
    if (!dueDate) unscheduled.data.push(task);
    else if (dueDate === today) todaySection.data.push(task);
    else if (dueDate > today) upcoming.data.push(task);
    else overdue.data.push(task);
  }
  return sections
    .map((section) => ({ ...section, data: section.data.sort(byDue) }))
    .filter((section) => section.data.length > 0);
}
