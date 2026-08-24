/**
 * Minimal, dependency-free RFC 5545 (iCalendar) reader, scoped to what course
 * schedule exports actually contain: weekly recurring meeting patterns.
 *
 * Written against a CMU SIO export, which has three traits worth knowing:
 *
 *  1. Times are FLOATING -- `DTSTART:20260824T140000` with no `Z`, no `TZID`,
 *     and no `VTIMEZONE` block. These are campus wall-clock times. We keep them
 *     as wall clock rather than inventing a timezone the file never stated.
 *  2. There is NO `UID` property on any VEVENT, so we cannot key events on UID
 *     the way most parsers do. We synthesize a stable key instead.
 *  3. Long values are folded across lines with a leading space, and TEXT values
 *     escape `;` `,` `\` and newlines.
 *
 * Anything richer than that (UTC times, explicit TZIDs, all-day events,
 * non-weekly rules) is handled defensively so a real export from some other
 * school does not blow up, but it is not the primary path.
 */

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 0 = Sunday .. 6 = Saturday, matching `Date.prototype.getUTCDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One meeting on one weekday. A single VEVENT with `BYDAY=MO,WE` expands into
 * two of these -- which is exactly the shape the week grid wants to render.
 */
export interface MeetingBlock {
  /** Raw SUMMARY, e.g. "Concepts of Mathematics :: 21127 1". */
  title: string;
  /** Course title with the trailing `:: code section` stripped off. */
  courseName: string;
  /** e.g. "21127", or null when SUMMARY does not follow the `::` convention. */
  courseCode: string | null;
  /** Section/lecture id, e.g. "1", "A", "E". */
  section: string | null;
  location: string | null;
  instructor: string | null;
  weekday: Weekday;
  /** Minutes from local midnight, e.g. 14:00 -> 840. */
  startMinute: number;
  /** Exclusive. Always > startMinute; midnight-spanning events are split. */
  endMinute: number;
  /** ISO date of the first occurrence on this weekday, or null if unknown. */
  startDate: string | null;
  /** ISO date the pattern stops recurring (from RRULE UNTIL/COUNT), or null. */
  endDate: string | null;
  recurring: boolean;
  /** Stable synthetic identity, since these exports carry no UID. */
  sourceKey: string;
}

export interface ParseResult {
  blocks: MeetingBlock[];
  /** Non-fatal problems worth showing the user after an import. */
  warnings: string[];
  /** Earliest first-occurrence date across all blocks. */
  termStart: string | null;
  /** Latest recurrence-end date across all blocks. */
  termEnd: string | null;
  /** Distinct courses found, for the post-import summary. */
  courseCount: number;
}

export interface ParseOptions {
  /**
   * Zone used only to place absolute (`Z`) or foreign-`TZID` times onto a
   * wall clock. Floating times -- the common case -- ignore this entirely.
   */
  timeZone?: string;
}

const DEFAULT_TIME_ZONE = "America/New_York";

/* ------------------------------------------------------------------ *
 * Lexing: unfolding and property parsing
 * ------------------------------------------------------------------ */

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Undo RFC 5545 line folding: a CRLF followed by a space or tab is a
 * continuation of the previous line, not a new one.
 */
function unfold(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.trim().length > 0);
}

function parseProp(line: string): RawProp | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon === -1) return null;

  const namePart = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = splitUnquoted(namePart, ";");
  const name = (segments.shift() ?? "").trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const seg of segments) {
    const eq = seg.indexOf("=");
    if (eq === -1) continue;
    params[seg.slice(0, eq).trim().toUpperCase()] = stripQuotes(seg.slice(eq + 1).trim());
  }
  return { name, params, value };
}

/** Parameter values may be DQUOTE-wrapped and contain `:` or `;`. */
function indexOfUnquoted(s: string, ch: string): number {
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inQuotes = !inQuotes;
    else if (s[i] === ch && !inQuotes) return i;
  }
  return -1;
}

function splitUnquoted(s: string, ch: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const c of s) {
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (c === ch && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;
}

/** Reverse TEXT escaping: `\n` `\N` -> newline, `\,` `\;` `\\` -> literal. */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[++i];
    if (next === "n" || next === "N") out += "\n";
    else if (next === undefined) out += "\\";
    else out += next; // covers \, \; \\ and anything unexpected
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Date / time handling
 * ------------------------------------------------------------------ */

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  minuteOfDay: number;
  /** True for `VALUE=DATE` (all-day) values, which carry no time. */
  dateOnly: boolean;
}

const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

function parseDateTime(
  value: string,
  params: Record<string, string>,
  timeZone: string,
): WallTime | null {
  const m = DATETIME_RE.exec(value.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s, utcFlag] = m;
  const dateOnly = h === undefined || params.VALUE === "DATE";
  const wall: WallTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    minuteOfDay: dateOnly ? 0 : Number(h) * 60 + Number(mi),
    dateOnly,
  };
  if (dateOnly) return wall;

  const seconds = Number(s ?? "0");

  // Absolute UTC time: shift onto the target zone's wall clock.
  if (utcFlag) {
    const utcMs = Date.UTC(wall.year, wall.month - 1, wall.day, Number(h), Number(mi), seconds);
    return wallTimeFromInstant(utcMs, timeZone);
  }

  // Explicit TZID that differs from our display zone: reinterpret.
  const tzid = params.TZID;
  if (tzid && tzid !== timeZone && isValidTimeZone(tzid)) {
    const utcMs = wallTimeToInstant(wall, tzid);
    return wallTimeFromInstant(utcMs, timeZone);
  }

  // Floating time (or TZID == display zone): already the wall clock we want.
  return wall;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock reading of an absolute instant in a given zone. */
function wallTimeFromInstant(utcMs: number, timeZone: string): WallTime {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl renders midnight as hour 24 in some ICU versions; normalize it.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    minuteOfDay: hour * 60 + get("minute"),
    dateOnly: false,
  };
}

/**
 * Inverse of the above: the instant at which a zone's clock reads this wall
 * time. Two passes converge because the offset error is itself bounded by the
 * offset, and DST shifts are far smaller than the initial guess's accuracy.
 */
function wallTimeToInstant(wall: WallTime, timeZone: string): number {
  const asIfUTC = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    Math.floor(wall.minuteOfDay / 60),
    wall.minuteOfDay % 60,
  );
  let guess = asIfUTC;
  for (let i = 0; i < 2; i++) {
    guess = asIfUTC - zoneOffsetMs(guess, timeZone);
  }
  return guess;
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const w = wallTimeFromInstant(utcMs, timeZone);
  const asIfUTC = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    Math.floor(w.minuteOfDay / 60),
    w.minuteOfDay % 60,
    new Date(utcMs).getUTCSeconds(),
  );
  return asIfUTC - utcMs;
}

/** Days since epoch for a wall-clock date -- timezone-free day arithmetic. */
function toDayNumber(w: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / 86_400_000);
}

function fromDayNumber(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOfDayNumber(days: number): Weekday {
  // 1970-01-01 was a Thursday (4).
  return (((days % 7) + 7 + 4) % 7) as Weekday;
}

/* ------------------------------------------------------------------ *
 * RRULE
 * ------------------------------------------------------------------ */

const BYDAY_TO_WEEKDAY: Record<string, Weekday> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface RRule {
  freq: string;
  interval: number;
  byDay: Weekday[];
  until: WallTime | null;
  count: number | null;
}

function parseRRule(value: string, timeZone: string): RRule {
  const rule: RRule = { freq: "", interval: 1, byDay: [], until: null, count: null };
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const val = part.slice(eq + 1).trim();
    switch (key) {
      case "FREQ":
        rule.freq = val.toUpperCase();
        break;
      case "INTERVAL": {
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) rule.interval = n;
        break;
      }
      case "COUNT": {
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) rule.count = n;
        break;
      }
      case "UNTIL":
        rule.until = parseDateTime(val, {}, timeZone);
        break;
      case "BYDAY":
        for (const token of val.split(",")) {
          // Strip any ordinal prefix ("-1FR", "2MO"); meaningless for weekly.
          const day = BYDAY_TO_WEEKDAY[token.trim().toUpperCase().replace(/^[+-]?\d+/, "")];
          if (day !== undefined && !rule.byDay.includes(day)) rule.byDay.push(day);
        }
        break;
    }
  }
  return rule;
}

/* ------------------------------------------------------------------ *
 * SUMMARY / DESCRIPTION shredding
 * ------------------------------------------------------------------ */

/** "Concepts of Mathematics :: 21127 A" -> name, code, section. */
export function parseSummary(summary: string): {
  courseName: string;
  courseCode: string | null;
  section: string | null;
} {
  const idx = summary.lastIndexOf("::");
  if (idx === -1) return { courseName: summary.trim(), courseCode: null, section: null };

  const courseName = summary.slice(0, idx).trim();
  const tail = summary.slice(idx + 2).trim();
  const m = /^(\d{3,6})\s*(\S+)?$/.exec(tail);
  if (!m) return { courseName, courseCode: null, section: tail || null };
  return { courseName, courseCode: m[1], section: m[2] ?? null };
}

/** Pulls "Instructor: Zhu" / "Instructors: Anderson; Gaytan Villarreal". */
export function parseInstructor(description: string): string | null {
  const m = /Instructors?:\s*([^\n]+)/i.exec(description);
  if (!m) return null;
  const raw = m[1].trim().replace(/[;,]\s*$/, "");
  return raw.length > 0 ? raw : null;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

export function parseIcs(text: string, options: ParseOptions = {}): ParseResult {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const warnings: string[] = [];
  const blocks: MeetingBlock[] = [];

  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l))) {
    throw new IcsParseError(
      "That does not look like an .ics calendar file (no BEGIN:VCALENDAR found).",
    );
  }

  // Collect VEVENT blocks. Nested components (VALARM) are skipped.
  const events: RawProp[][] = [];
  let current: RawProp[] | null = null;
  let nestedDepth = 0;

  for (const line of lines) {
    const prop = parseProp(line);
    if (!prop) continue;

    if (prop.name === "BEGIN") {
      const component = prop.value.trim().toUpperCase();
      if (component === "VEVENT") current = [];
      else if (current) nestedDepth++;
      continue;
    }
    if (prop.name === "END") {
      const component = prop.value.trim().toUpperCase();
      if (component === "VEVENT" && current) {
        events.push(current);
        current = null;
      } else if (nestedDepth > 0) {
        nestedDepth--;
      }
      continue;
    }
    if (current && nestedDepth === 0) current.push(prop);
  }

  if (events.length === 0) {
    throw new IcsParseError("No calendar events found in that file.");
  }

  const seenKeys = new Set<string>();

  for (const [index, props] of events.entries()) {
    const find = (name: string) => props.find((p) => p.name === name);

    const summaryProp = find("SUMMARY");
    const summary = summaryProp ? unescapeText(summaryProp.value).trim() : "";
    const label = summary || `Event ${index + 1}`;

    const dtStartProp = find("DTSTART");
    if (!dtStartProp) {
      warnings.push(`Skipped "${label}": no start time (DTSTART).`);
      continue;
    }
    const dtStart = parseDateTime(dtStartProp.value, dtStartProp.params, timeZone);
    if (!dtStart) {
      warnings.push(`Skipped "${label}": unreadable start time "${dtStartProp.value}".`);
      continue;
    }

    // End time: DTEND if present, else DTSTART + DURATION, else a 1h default.
    const dtEndProp = find("DTEND");
    let endWall = dtEndProp ? parseDateTime(dtEndProp.value, dtEndProp.params, timeZone) : null;
    if (!endWall) {
      const durationProp = find("DURATION");
      const durationMinutes = durationProp ? parseDuration(durationProp.value) : null;
      if (durationMinutes !== null) {
        endWall = addMinutes(dtStart, durationMinutes);
      } else {
        warnings.push(`"${label}" had no end time; assumed 1 hour.`);
        endWall = addMinutes(dtStart, 60);
      }
    }

    const startDay = toDayNumber(dtStart);
    const endDay = toDayNumber(endWall);

    // All-day events occupy the whole day and block it out entirely.
    if (dtStart.dateOnly) {
      const spanDays = Math.max(1, endDay - startDay);
      if (spanDays > 7) {
        warnings.push(`Skipped all-day event "${label}": spans ${spanDays} days.`);
        continue;
      }
      for (let d = 0; d < spanDays; d++) {
        pushBlock(blocks, seenKeys, {
          summary,
          props,
          weekday: weekdayOfDayNumber(startDay + d),
          startMinute: 0,
          endMinute: 1440,
          startDate: fromDayNumber(startDay + d),
          endDate: null,
          recurring: false,
          index,
        });
      }
      continue;
    }

    // Absolute duration in minutes, so multi-day events split correctly.
    const totalMinutes =
      (endDay - startDay) * 1440 + (endWall.minuteOfDay - dtStart.minuteOfDay);

    if (totalMinutes <= 0) {
      warnings.push(`Skipped "${label}": end time is not after start time.`);
      continue;
    }
    if (totalMinutes > 1440) {
      warnings.push(
        `Skipped "${label}": ${Math.round(totalMinutes / 60)}h long, which is not a class meeting.`,
      );
      continue;
    }

    const rruleProp = find("RRULE");
    const rule = rruleProp ? parseRRule(rruleProp.value, timeZone) : null;

    // Which weekdays does this pattern land on?
    let weekdays: Weekday[];
    let recurring = false;

    if (!rule || !rule.freq) {
      weekdays = [weekdayOfDayNumber(startDay)];
    } else if (rule.freq === "WEEKLY") {
      recurring = true;
      weekdays = rule.byDay.length > 0 ? [...rule.byDay] : [weekdayOfDayNumber(startDay)];
      // RFC 5545: DTSTART is always an occurrence, even if BYDAY omits its day.
      const startWeekday = weekdayOfDayNumber(startDay);
      if (!weekdays.includes(startWeekday)) {
        weekdays.push(startWeekday);
        warnings.push(
          `"${label}" starts on a ${WEEKDAY_NAMES[startWeekday]} that its repeat rule omits; kept it anyway.`,
        );
      }
      if (rule.interval > 1) {
        warnings.push(
          `"${label}" repeats every ${rule.interval} weeks; shown as if it were every week.`,
        );
      }
    } else if (rule.freq === "DAILY") {
      recurring = true;
      weekdays = rule.byDay.length > 0 ? [...rule.byDay] : ([0, 1, 2, 3, 4, 5, 6] as Weekday[]);
    } else {
      // MONTHLY/YEARLY do not map onto a typical week; keep the first instance.
      weekdays = [weekdayOfDayNumber(startDay)];
      warnings.push(
        `"${label}" repeats ${rule.freq.toLowerCase()}; only its first meeting is shown.`,
      );
    }

    const untilDate = rule?.until ? fromDayNumber(toDayNumber(rule.until)) : null;
    const endDateIso = untilDate ?? estimateEndFromCount(startDay, rule, weekdays.length);

    for (const weekday of weekdays) {
      // First real occurrence on this weekday, at or after DTSTART.
      const offset = (weekday - weekdayOfDayNumber(startDay) + 7) % 7;
      const firstDay = startDay + offset;
      const firstDate = fromDayNumber(firstDay);

      // Split meetings that run past midnight across the two weekdays.
      const endMinuteRaw = dtStart.minuteOfDay + totalMinutes;
      if (endMinuteRaw <= 1440) {
        pushBlock(blocks, seenKeys, {
          summary, props, weekday,
          startMinute: dtStart.minuteOfDay,
          endMinute: endMinuteRaw,
          startDate: firstDate,
          endDate: endDateIso,
          recurring, index,
        });
      } else {
        pushBlock(blocks, seenKeys, {
          summary, props, weekday,
          startMinute: dtStart.minuteOfDay,
          endMinute: 1440,
          startDate: firstDate,
          endDate: endDateIso,
          recurring, index,
        });
        pushBlock(blocks, seenKeys, {
          summary, props,
          weekday: ((weekday + 1) % 7) as Weekday,
          startMinute: 0,
          endMinute: endMinuteRaw - 1440,
          startDate: fromDayNumber(firstDay + 1),
          endDate: endDateIso,
          recurring, index,
        });
      }
    }
  }

  if (blocks.length === 0) {
    throw new IcsParseError(
      warnings.length > 0
        ? `No usable class meetings found. ${warnings[0]}`
        : "No usable class meetings found in that file.",
    );
  }

  const startDates = blocks.map((b) => b.startDate).filter((d): d is string => d !== null);
  const endDates = blocks.map((b) => b.endDate).filter((d): d is string => d !== null);
  const courses = new Set(blocks.map((b) => b.courseCode ?? b.courseName));

  return {
    blocks,
    warnings,
    termStart: startDates.length > 0 ? startDates.sort()[0] : null,
    termEnd: endDates.length > 0 ? endDates.sort()[endDates.length - 1] : null,
    courseCount: courses.size,
  };
}

export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsParseError";
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function pushBlock(
  blocks: MeetingBlock[],
  seenKeys: Set<string>,
  input: {
    summary: string;
    props: RawProp[];
    weekday: Weekday;
    startMinute: number;
    endMinute: number;
    startDate: string | null;
    endDate: string | null;
    recurring: boolean;
    index: number;
  },
): void {
  const { summary, props } = input;
  const find = (name: string) => props.find((p) => p.name === name);

  const locationProp = find("LOCATION");
  const descriptionProp = find("DESCRIPTION");
  const location = locationProp
    ? normalizeLocation(unescapeText(locationProp.value))
    : null;
  const description = descriptionProp ? unescapeText(descriptionProp.value) : "";
  const { courseName, courseCode, section } = parseSummary(summary);

  // These exports carry no UID, so identity is derived from the content that
  // actually distinguishes one meeting from another. The UID is used when
  // present so re-importing a normal calendar stays stable.
  const uid = find("UID")?.value.trim();
  const identity = uid ?? `${summary}|${location ?? ""}`;
  let sourceKey = `${identity}|${input.weekday}|${input.startMinute}`;
  if (seenKeys.has(sourceKey)) sourceKey += `|${input.index}`;
  seenKeys.add(sourceKey);

  blocks.push({
    title: summary,
    courseName,
    courseCode,
    section,
    location,
    instructor: parseInstructor(description),
    weekday: input.weekday,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    startDate: input.startDate,
    endDate: input.endDate,
    recurring: input.recurring,
    sourceKey,
  });
}

/** "SH- 105" and "DH- A302" read better as "SH 105" / "DH A302". */
function normalizeLocation(raw: string): string | null {
  const cleaned = raw.replace(/-\s+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function addMinutes(wall: WallTime, minutes: number): WallTime {
  const total = wall.minuteOfDay + minutes;
  const dayShift = Math.floor(total / 1440);
  const iso = fromDayNumber(toDayNumber(wall) + dayShift);
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
    minuteOfDay: ((total % 1440) + 1440) % 1440,
    dateOnly: false,
  };
}

/** ISO 8601 duration, e.g. `PT1H20M`, `P1D`, `-PT30M`. Returns minutes. */
function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const minutes =
    Number(w ?? 0) * 10080 +
    Number(d ?? 0) * 1440 +
    Number(h ?? 0) * 60 +
    Number(mi ?? 0) +
    Number(s ?? 0) / 60;
  if (minutes === 0) return null;
  return sign === "-" ? -minutes : minutes;
}

/** With COUNT instead of UNTIL, approximate when the pattern stops. */
function estimateEndFromCount(
  startDay: number,
  rule: RRule | null,
  weekdayCount: number,
): string | null {
  if (!rule?.count || weekdayCount === 0) return null;
  const weeks = Math.ceil(rule.count / weekdayCount) * rule.interval;
  return fromDayNumber(startDay + weeks * 7);
}
