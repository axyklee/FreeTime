import type { ReactNode } from "react";
import type { Weekday } from "@/lib/ics";
import { formatHour, WEEKDAY_INITIAL, WEEKDAY_SHORT } from "@/lib/time";

/** Vertical scale. 14 visible hours at 0.85px/min is ~715px — one screen. */
const PX_PER_MINUTE = 0.85;

export interface WeekGridShellProps {
  dayStart: number;
  dayEnd: number;
  weekdays: Weekday[];
  /** Rendered inside each day column, absolutely positioned by `spanStyle`. */
  renderDay: (weekday: Weekday) => ReactNode;
  /** Days with nothing to show at all get a muted header. */
  emptyDays?: Set<Weekday>;
}

/**
 * The shared chrome: weekday headers, an hour axis, and hour gridlines.
 *
 * Both the personal schedule and the group overlap view render into this, so
 * the two grids line up pixel-for-pixel and can be compared by eye.
 */
export function WeekGridShell({
  dayStart,
  dayEnd,
  weekdays,
  renderDay,
  emptyDays,
}: WeekGridShellProps) {
  const totalMinutes = Math.max(60, dayEnd - dayStart);
  const height = totalMinutes * PX_PER_MINUTE;

  // Gridlines on the hour, starting at the first whole hour in range.
  const firstHour = Math.ceil(dayStart / 60) * 60;
  const hourMarks: number[] = [];
  for (let m = firstHour; m <= dayEnd; m += 60) hourMarks.push(m);

  const columns = `3.5rem repeat(${weekdays.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${weekdays.length * 92 + 56}px` }}>
        {/* Weekday headers */}
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div />
          {weekdays.map((weekday) => (
            <div
              key={weekday}
              className="pb-2 text-center text-xs font-semibold uppercase tracking-wider"
              style={{
                color: emptyDays?.has(weekday) ? "var(--text-faint)" : "var(--text-muted)",
              }}
            >
              <span className="hidden sm:inline">{WEEKDAY_SHORT[weekday]}</span>
              <span className="sm:hidden">{WEEKDAY_INITIAL[weekday]}</span>
            </div>
          ))}
        </div>

        {/* Axis + day columns */}
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="relative" style={{ height }}>
            {hourMarks.map((minute) => (
              <div
                key={minute}
                className="absolute right-2 -translate-y-1/2 text-[0.6875rem] tabular-nums"
                style={{
                  top: pct(minute, dayStart, totalMinutes),
                  color: "var(--text-faint)",
                }}
              >
                {formatHour(minute)}
              </div>
            ))}
          </div>

          {weekdays.map((weekday, index) => (
            <div
              key={weekday}
              className="relative"
              style={{
                height,
                background: "var(--surface)",
                borderLeft: index === 0 ? "1px solid var(--border)" : "none",
                borderRight: "1px solid var(--border)",
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {/* Hour gridlines */}
              {hourMarks.map((minute) => (
                <div
                  key={minute}
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0"
                  style={{
                    top: pct(minute, dayStart, totalMinutes),
                    borderTop: "1px solid var(--border)",
                    opacity: 0.7,
                  }}
                />
              ))}
              {renderDay(weekday)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Position within a day column, as a percentage of the visible window. */
export function spanStyle(
  startMinute: number,
  endMinute: number,
  dayStart: number,
  dayEnd: number,
): { top: string; height: string } | null {
  const totalMinutes = Math.max(60, dayEnd - dayStart);
  const clampedStart = Math.max(startMinute, dayStart);
  const clampedEnd = Math.min(endMinute, dayEnd);
  if (clampedEnd <= clampedStart) return null;

  return {
    top: pct(clampedStart, dayStart, totalMinutes),
    height: `${((clampedEnd - clampedStart) / totalMinutes) * 100}%`,
  };
}

/** Whether a span is tall enough to hold a text label. */
export function spanFitsLabel(startMinute: number, endMinute: number): boolean {
  return (endMinute - startMinute) * PX_PER_MINUTE >= 34;
}

export function spanFitsDetail(startMinute: number, endMinute: number): boolean {
  return (endMinute - startMinute) * PX_PER_MINUTE >= 52;
}

function pct(minute: number, dayStart: number, totalMinutes: number): string {
  return `${((minute - dayStart) / totalMinutes) * 100}%`;
}

/** Widely separated hues, ordered so consecutive picks stay distinguishable. */
const COURSE_HUES = [265, 200, 155, 30, 340, 180, 95, 310, 230, 15];

/**
 * Assigns each course a hue by its position in the sorted list of courses,
 * rather than by hashing its code.
 *
 * Hashing is tempting because it needs no state, but it collides: three of the
 * five courses in a typical schedule landed on neighbouring greens, which
 * defeats the point of colouring them at all. Sorting first keeps the mapping
 * stable across renders while guaranteeing the colours are spread out.
 */
export function makeCourseHue(keys: string[]): (key: string) => number {
  const ordered = [...new Set(keys)].sort();
  return (key: string) => {
    const index = ordered.indexOf(key);
    return COURSE_HUES[(index < 0 ? 0 : index) % COURSE_HUES.length];
  };
}
