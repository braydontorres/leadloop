/**
 * The native picker owns the presentation (including AM/PM); this module
 * converts its local clock value to the existing canonical HH:mm input used
 * by the shared timezone-aware task parser.
 */
export function timePickerValue(time: string) {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  const hour = match ? Number(match[1]) : 9;
  const minute = match ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return new Date(2000, 0, 1, 9, 0);
  return new Date(2000, 0, 1, hour, minute);
}

export function timeInputFromPicker(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes(),
  ).padStart(2, "0")}`;
}

export function timePickerLabel(time: string) {
  const value = timePickerValue(time);
  const hour = value.getHours();
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}
