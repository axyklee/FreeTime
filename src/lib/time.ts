/**
 * Wall-clock formatting. Everything here operates on minutes-from-midnight,
 * never on `Date`, because course schedules carry no timezone to anchor to.
 */

export const WEEKDAY_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const WEEKDAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** 840 -> "2:00 PM" */
export function formatTime(minute: number): string {
  const total = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minutes = total % 60;
  const meridiem = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

/** 840 -> "2 PM" — for axis labels, where minutes are always :00. */
export function formatHour(minute: number): string {
  const hour24 = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
  const meridiem = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12} ${meridiem}`;
}

/** Collapses a shared meridiem: "9:00 – 9:50 AM", but "11:00 AM – 12:20 PM". */
export function formatRange(start: number, end: number): string {
  const startPm = Math.floor(start / 60) >= 12;
  const endPm = Math.floor(end / 60) >= 12;
  if (startPm === endPm) {
    return `${formatTime(start).replace(/ [AP]M$/, "")} – ${formatTime(end)}`;
  }
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** 100 -> "1h 40m", 50 -> "50m", 120 -> "2h" */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "2026-08-24" -> "Aug 24, 2026", without constructing a zoned Date. */
export function formatIsoDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatRelativeDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
