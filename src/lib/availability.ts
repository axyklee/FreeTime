/**
 * Turns several people's weekly meeting patterns into a single picture of the
 * group's week.
 *
 * The unit of truth here is *unavailability*: we only ever assert that someone
 * has a class at a given time, which is the one thing the .ics file actually
 * tells us. "Free" is derived -- it is simply the absence of any known class,
 * and is presented that way rather than as a positive claim about someone's
 * availability.
 *
 * All arithmetic is on wall-clock minutes-from-midnight and a weekday index.
 * Course schedule exports use floating local times, so there is no instant in
 * time to convert and no timezone to get wrong.
 */

import type { MeetingBlock, Weekday } from "./ics";

/** Default visible window; classes outside 8am-10pm are vanishingly rare. */
export const DEFAULT_DAY_START = 8 * 60;
export const DEFAULT_DAY_END = 22 * 60;

/** Below this, a gap is a passing period, not a window to meet in. */
export const DEFAULT_MIN_WINDOW = 45;

export interface MemberSchedule {
  memberId: string;
  memberName: string;
  blocks: MeetingBlock[];
}

/** One person being busy for one reason, inside a segment. */
export interface MemberBusy {
  memberId: string;
  memberName: string;
  /** Course name, or event title for non-course events. */
  title: string;
  /** Section / location line, when known. */
  detail: string | null;
  /** The person's own block bounds, which may extend past the segment. */
  blockStart: number;
  blockEnd: number;
}

/** A span in which the set of busy people does not change. */
export interface BusySegment {
  startMinute: number;
  endMinute: number;
  busy: MemberBusy[];
  /** Distinct people busy here. Never 0 -- free spans are not segments. */
  busyCount: number;
}

export interface FreeWindow {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
}

export interface DayAvailability {
  weekday: Weekday;
  /** Spans where at least one person is busy, ordered and non-overlapping. */
  segments: BusySegment[];
  /** Spans inside the visible window where nobody is known to be busy. */
  freeWindows: FreeWindow[];
}

export interface WeekAvailability {
  days: DayAvailability[];
  memberCount: number;
  dayStart: number;
  dayEnd: number;
  /** True when no member has a single class all week. */
  empty: boolean;
}

export interface AvailabilityOptions {
  dayStart?: number;
  dayEnd?: number;
  /** Restrict to these weekdays (e.g. weekdays only). Defaults to all seven. */
  weekdays?: Weekday[];
}

const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Builds the week view for a set of people.
 *
 * Segment boundaries come from a sweep over every block edge, so a span is
 * emitted wherever the busy set changes. Adjacent spans with an identical busy
 * set are then coalesced, which keeps the rendered grid from being shredded
 * into slivers by back-to-back classes.
 */
export function buildWeekAvailability(
  members: MemberSchedule[],
  options: AvailabilityOptions = {},
): WeekAvailability {
  const dayStart = options.dayStart ?? DEFAULT_DAY_START;
  const dayEnd = options.dayEnd ?? DEFAULT_DAY_END;
  const weekdays = options.weekdays ?? ALL_WEEKDAYS;

  const days: DayAvailability[] = weekdays.map((weekday) => {
    // Every block anyone has on this weekday, tagged with its owner.
    const entries: MemberBusy[] = [];
    for (const member of members) {
      for (const block of member.blocks) {
        if (block.weekday !== weekday) continue;
        entries.push({
          memberId: member.memberId,
          memberName: member.memberName,
          title: block.courseName,
          detail: describeBlock(block),
          blockStart: block.startMinute,
          blockEnd: block.endMinute,
        });
      }
    }

    if (entries.length === 0) {
      return {
        weekday,
        segments: [],
        freeWindows:
          dayEnd > dayStart
            ? [
                {
                  weekday,
                  startMinute: dayStart,
                  endMinute: dayEnd,
                  durationMinutes: dayEnd - dayStart,
                },
              ]
            : [],
      };
    }

    // Sweep over all distinct edges.
    const edges = new Set<number>();
    for (const e of entries) {
      edges.add(e.blockStart);
      edges.add(e.blockEnd);
    }
    const boundaries = [...edges].sort((a, b) => a - b);

    const rawSegments: BusySegment[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (end <= start) continue;

      const busy = entries.filter((e) => e.blockStart <= start && e.blockEnd >= end);
      if (busy.length === 0) continue;

      rawSegments.push({
        startMinute: start,
        endMinute: end,
        busy,
        busyCount: new Set(busy.map((b) => b.memberId)).size,
      });
    }

    const segments = coalesce(rawSegments);
    return { weekday, segments, freeWindows: complement(segments, weekday, dayStart, dayEnd) };
  });

  return {
    days,
    memberCount: members.length,
    dayStart,
    dayEnd,
    empty: days.every((d) => d.segments.length === 0),
  };
}

/** "21127 A · DH A302" -- whatever detail we actually have. */
function describeBlock(block: MeetingBlock): string | null {
  const code = [block.courseCode, block.section].filter(Boolean).join(" ");
  const parts = [code || null, block.location].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Merge touching segments whose busy set is identical. */
function coalesce(segments: BusySegment[]): BusySegment[] {
  const out: BusySegment[] = [];
  for (const segment of segments) {
    const previous = out[out.length - 1];
    if (previous && previous.endMinute === segment.startMinute && sameBusySet(previous, segment)) {
      previous.endMinute = segment.endMinute;
    } else {
      out.push({ ...segment, busy: [...segment.busy] });
    }
  }
  return out;
}

function sameBusySet(a: BusySegment, b: BusySegment): boolean {
  if (a.busy.length !== b.busy.length) return false;
  const keyOf = (m: MemberBusy) => `${m.memberId}|${m.title}|${m.blockStart}|${m.blockEnd}`;
  const aKeys = new Set(a.busy.map(keyOf));
  return b.busy.every((m) => aKeys.has(keyOf(m)));
}

/** The gaps between busy segments, clipped to the visible window. */
function complement(
  segments: BusySegment[],
  weekday: Weekday,
  dayStart: number,
  dayEnd: number,
): FreeWindow[] {
  const windows: FreeWindow[] = [];
  let cursor = dayStart;

  for (const segment of segments) {
    if (segment.endMinute <= dayStart) continue;
    if (segment.startMinute >= dayEnd) break;
    if (segment.startMinute > cursor) {
      windows.push(makeWindow(weekday, cursor, Math.min(segment.startMinute, dayEnd)));
    }
    cursor = Math.max(cursor, segment.endMinute);
  }
  if (cursor < dayEnd) windows.push(makeWindow(weekday, cursor, dayEnd));

  return windows.filter((w) => w.durationMinutes > 0);
}

function makeWindow(weekday: Weekday, start: number, end: number): FreeWindow {
  return { weekday, startMinute: start, endMinute: end, durationMinutes: end - start };
}

/**
 * The group's open windows, longest first.
 *
 * A grid is good at showing *where* the group is busy but bad at answering
 * "so when can we actually meet" -- scanning seven columns for the widest gap
 * is exactly the task human eyes are worst at. This ranks them instead.
 */
export function findCommonFreeWindows(
  availability: WeekAvailability,
  minDurationMinutes: number = DEFAULT_MIN_WINDOW,
): FreeWindow[] {
  return availability.days
    .flatMap((day) => day.freeWindows)
    .filter((w) => w.durationMinutes >= minDurationMinutes)
    .sort(
      (a, b) =>
        b.durationMinutes - a.durationMinutes ||
        a.weekday - b.weekday ||
        a.startMinute - b.startMinute,
    );
}

/** Per-person busy load, for the group roster. */
export function summarizeMemberLoad(
  members: MemberSchedule[],
): { memberId: string; memberName: string; meetingCount: number; busyMinutes: number }[] {
  return members
    .map((member) => ({
      memberId: member.memberId,
      memberName: member.memberName,
      meetingCount: member.blocks.length,
      busyMinutes: member.blocks.reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0),
    }))
    .sort((a, b) => b.busyMinutes - a.busyMinutes);
}

/* ------------------------------------------------------------------ *
 * View window derivation
 * ------------------------------------------------------------------ */

/**
 * Picks the visible hour range from the schedules themselves, so a 6am lab or
 * a 9pm seminar is not silently cropped out of the grid.
 */
export function deriveVisibleWindow(
  blocks: { startMinute: number; endMinute: number }[],
  padMinutes = 30,
): { dayStart: number; dayEnd: number } {
  if (blocks.length === 0) return { dayStart: DEFAULT_DAY_START, dayEnd: DEFAULT_DAY_END };

  const earliest = Math.min(...blocks.map((b) => b.startMinute));
  const latest = Math.max(...blocks.map((b) => b.endMinute));

  // Round outward to whole hours so the axis labels land on gridlines.
  let dayStart = Math.max(0, Math.floor((earliest - padMinutes) / 60) * 60);
  let dayEnd = Math.min(1440, Math.ceil((latest + padMinutes) / 60) * 60);

  // Never narrower than the default window: a nearly-empty day should not
  // zoom in so far that the grid misrepresents how open it is.
  dayStart = Math.min(dayStart, DEFAULT_DAY_START);
  dayEnd = Math.max(dayEnd, DEFAULT_DAY_END);

  return { dayStart, dayEnd };
}

/**
 * Weekdays worth rendering.
 *
 * If anyone has a class on either weekend day, the whole week is shown --
 * including the empty weekend day. Showing Sunday but hiding Saturday makes the
 * grid look like Saturday does not exist, when in fact it is the most open day
 * of the week; a weekend that is genuinely free is information, not filler.
 * When nobody has weekend classes at all, the weekend is dropped entirely and
 * the grid stays at five columns.
 */
export function deriveWeekdays(blocks: { weekday: Weekday }[]): Weekday[] {
  const used = new Set(blocks.map((b) => b.weekday));
  const weekendInUse = used.has(0) || used.has(6);
  return weekendInUse ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
}
