export type DateConstraint = {
  year: number | null;
  month: number | null;
  weekday: number | null;
};

const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function isMeaningfulReminderTitle(value: string | null) {
  if (!value?.trim()) return false;
  const normalized = value
    .toLowerCase()
    .replace(/[.,!?]+$/g, "")
    .trim();
  if (
    [
      "reminder",
      "a reminder",
      "set a reminder",
      "set a reminder for",
      "i want a reminder",
      "i want a reminder for",
      "remind me",
      "remind me to",
    ].includes(normalized)
  )
    return false;
  const withoutReminderPrefix = normalized
    .replace(
      /^(?:(?:please\s+)?(?:i want|i need|set|create)(?:\s+a)?\s+reminder(?:\s+for)?|remind me(?:\s+to)?)\s*/i,
      "",
    )
    .trim();
  if (!withoutReminderPrefix) return false;
  return !/^(?:(?:next\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|today|tomorrow|on|in|at|a|an|\d{1,2}|\d{4}|am|pm|noon|midnight|and|the|of|\s)+$/i.test(
    withoutReminderPrefix,
  );
}

export function mentionsExplicitTime(text: string) {
  return /\b(?:at\s*)?(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|1[0-2]|0?[1-9])(?::[0-5]\d)?\s+(?:in\s+the\s+)?(?:morning|afternoon|evening|night)\b|\b(?:noon|midnight)\b/i.test(
    text,
  );
}

export function deriveDateConstraint(
  text: string,
  timeZone: string,
  now = new Date(),
): DateConstraint | null {
  const monthIndex = months.findIndex((month) =>
    new RegExp(`\\b${month}\\b`, "i").test(text),
  );
  const weekdayIndex = weekdays.findIndex((weekday) =>
    new RegExp(`\\b${weekday}\\b`, "i").test(text),
  );
  if (monthIndex < 0 || weekdayIndex < 0) return null;
  // A numbered day makes this an exact date, not a month/weekday constraint.
  if (new RegExp(`\\b${months[monthIndex]}\\s+\\d{1,2}\\b`, "i").test(text))
    return null;
  const local = localParts(now, timeZone);
  const next = /\bnext\b/i.test(text);
  const explicitYear = text.match(/\b(20\d{2})\b/);
  const year = explicitYear
    ? Number(explicitYear[1])
    : next
      ? local.year + (monthIndex + 1 <= local.month ? 1 : 0)
      : null;
  return { year, month: monthIndex + 1, weekday: weekdayIndex };
}

export function explicitMonthDay(
  text: string,
  constraint: DateConstraint | null,
) {
  const match = text.match(
    new RegExp(
      `\\b(${months.join("|")})\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?\\b`,
      "i",
    ),
  );
  if (!match) return null;
  const month = months.indexOf(match[1].toLowerCase()) + 1;
  const day = Number(match[2]);
  const year = match[3]
    ? Number(match[3])
    : (constraint?.year ?? new Date().getUTCFullYear());
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateString(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function deterministicDateFromText(
  text: string,
  timeZone: string,
  constraint: DateConstraint | null,
  now = new Date(),
) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const monthDay = explicitMonthDay(text, constraint);
  if (monthDay && constraint?.year !== null) return monthDay;
  const local = localParts(now, timeZone);
  if (/\btoday\b/i.test(text))
    return dateString(local.year, local.month, local.day);
  if (/\btomorrow\b/i.test(text)) {
    const tomorrow = new Date(
      Date.UTC(local.year, local.month - 1, local.day + 1),
    );
    return dateString(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
    );
  }
  const nextWeekday = weekdays.findIndex((weekday) =>
    new RegExp(`\\bnext\\s+${weekday}\\b`, "i").test(text),
  );
  if (nextWeekday >= 0) {
    const current = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const days = (nextWeekday - current.getUTCDay() + 7) % 7 || 7;
    current.setUTCDate(current.getUTCDate() + days);
    return dateString(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      current.getUTCDate(),
    );
  }
  return null;
}

export function matchesDateConstraint(
  date: string,
  constraint: DateConstraint | null,
) {
  if (!constraint) return true;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const actual = new Date(timestamp);
  if (
    actual.getUTCFullYear() !== year ||
    actual.getUTCMonth() + 1 !== month ||
    actual.getUTCDate() !== day
  )
    return false;
  return (
    (constraint.year === null || constraint.year === year) &&
    (constraint.month === null || constraint.month === month) &&
    (constraint.weekday === null || constraint.weekday === actual.getUTCDay())
  );
}

export function dateConstraintQuestion(constraint: DateConstraint) {
  const title = (value: string) => value[0].toUpperCase() + value.slice(1);
  const weekday =
    constraint.weekday === null ? "date" : title(weekdays[constraint.weekday]);
  const month =
    constraint.month === null
      ? ""
      : ` in ${title(months[constraint.month - 1])}`;
  return `Which ${weekday}${month}`;
}

export function mentionsUnambiguousDate(text: string) {
  return /\b(?:today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b|\b20\d{2}-\d{2}-\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i.test(
    text,
  );
}
