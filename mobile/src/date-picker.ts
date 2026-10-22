function localNoon(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Dates in the picker are calendar fields, not instants. Local noon avoids a
 * device-zone offset changing the day shown by iOS; the shared task parser
 * later applies the workspace's IANA time zone to the chosen date and time.
 */
export function datePickerValue(value: string, fallback = new Date()) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    const candidate = localNoon(year, month, day);
    if (
      candidate.getFullYear() === year &&
      candidate.getMonth() === month - 1 &&
      candidate.getDate() === day
    ) {
      return candidate;
    }
  }
  return localNoon(
    fallback.getFullYear(),
    fallback.getMonth() + 1,
    fallback.getDate(),
  );
}

export function dateInputFromPicker(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate(),
  ).padStart(2, "0")}`;
}

export function datePickerLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(datePickerValue(value));
}
