import type { Weekday } from "@/lib/ics";
import type { BusySegment, WeekAvailability } from "@/lib/availability";
import { formatDuration, formatRange } from "@/lib/time";
import { spanFitsDetail, spanFitsLabel, spanStyle, WeekGridShell } from "./WeekGrid";

interface OverlapGridProps {
  availability: WeekAvailability;
  weekdays: Weekday[];
  /** Free windows shorter than this are not worth marking. */
  minWindowMinutes: number;
}

/**
 * The group's week, drawn as unavailability.
 *
 * Only busy time is asserted -- the tint darkens with the number of people who
 * have a class in that span, which is the one thing the calendar files actually
 * say. Each block names who is unavailable rather than showing a count: "Bob"
 * tells you something you can act on, where "1/3" makes you hover to find out
 * which third. Windows where nobody is busy are left clear and, when long
 * enough to be usable, marked.
 */
export function OverlapGrid({ availability, weekdays, minWindowMinutes }: OverlapGridProps) {
  const { dayStart, dayEnd, memberCount } = availability;
  const byWeekday = new Map(availability.days.map((day) => [day.weekday, day]));

  // Short labels are resolved across the whole group, so a name is only
  // shortened as far as it can go while staying unambiguous.
  const shortNameFor = makeShortNames(
    availability.days.flatMap((day) => day.segments.flatMap((s) => s.busy.map((b) => b.memberName))),
  );

  const emptyDays = new Set(
    weekdays.filter((weekday) => (byWeekday.get(weekday)?.segments.length ?? 0) === 0),
  );

  return (
    <div>
      <WeekGridShell
        dayStart={dayStart}
        dayEnd={dayEnd}
        weekdays={weekdays}
        emptyDays={emptyDays}
        renderDay={(weekday) => {
          const day = byWeekday.get(weekday);
          if (!day) return null;

          return (
            <>
              {/*
                Every clear window is washed, not just the long ones. Leaving
                short gaps blank made a 10-minute passing period look like
                missing data rather than free time; only the windows worth
                meeting in get a label.
              */}
              {day.freeWindows.map((window) => {
                const position = spanStyle(
                  window.startMinute,
                  window.endMinute,
                  dayStart,
                  dayEnd,
                );
                if (!position) return null;

                const usable = window.durationMinutes >= minWindowMinutes;
                return (
                  <div
                    key={`free-${window.startMinute}`}
                    className="absolute inset-x-0 flex justify-center pt-1"
                    style={{
                      ...position,
                      background: "var(--free-subtle)",
                      opacity: usable ? 1 : 0.45,
                    }}
                    title={`Everyone clear · ${formatRange(window.startMinute, window.endMinute)} (${formatDuration(window.durationMinutes)})`}
                  >
                    {usable && spanFitsLabel(window.startMinute, window.endMinute) && (
                      <span
                        className="text-[0.625rem] font-medium tabular-nums"
                        style={{ color: "var(--free)" }}
                      >
                        {formatDuration(window.durationMinutes)}
                      </span>
                    )}
                  </div>
                );
              })}

              {day.segments.map((segment) => {
                const position = spanStyle(
                  segment.startMinute,
                  segment.endMinute,
                  dayStart,
                  dayEnd,
                );
                if (!position) return null;

                const alpha = busyAlpha(segment.busyCount, memberCount);
                const names = uniqueNames(segment).map(shortNameFor);
                const roomy = spanFitsDetail(segment.startMinute, segment.endMinute);

                return (
                  <div
                    key={`busy-${segment.startMinute}-${segment.endMinute}`}
                    className="absolute inset-x-0 overflow-hidden px-1.5 py-0.5"
                    style={{
                      ...position,
                      background: `rgb(var(--busy) / ${alpha})`,
                      borderTop: "1px solid rgb(var(--busy) / 0.55)",
                    }}
                    title={busyTooltip(segment, memberCount)}
                  >
                    <div
                      className={`text-[0.625rem] font-semibold leading-tight ${
                        roomy ? "" : "truncate"
                      }`}
                      style={{ color: contrastText(alpha) }}
                    >
                      {names.join(", ")}
                    </div>
                    {roomy && (
                      <div
                        className="truncate text-[0.625rem] leading-tight"
                        style={{ color: contrastText(alpha, true) }}
                      >
                        {segment.busy[0]?.title}
                        {segment.busyCount > 1 ? " …" : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        }}
      />
      <Legend memberCount={memberCount} minWindowMinutes={minWindowMinutes} />
    </div>
  );
}

function Legend({
  memberCount,
  minWindowMinutes,
}: {
  memberCount: number;
  minWindowMinutes: number;
}) {
  const steps = Array.from({ length: Math.min(memberCount, 5) }, (_, i) => i + 1);

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"
      style={{ color: "var(--text-muted)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-6 rounded"
          style={{ background: "var(--free-subtle)", border: "1px solid var(--free)" }}
        />
        <span>Nobody has class ({formatDuration(minWindowMinutes)}+)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span>Named blocks are classes:</span>
        {steps.map((count) => (
          <span
            key={count}
            className="inline-block h-3 w-6 rounded"
            style={{ background: `rgb(var(--busy) / ${busyAlpha(count, memberCount)})` }}
          />
        ))}
        <span className="ml-1">darker = more people busy</span>
      </div>
    </div>
  );
}

/** People busy in a segment, in a stable order, without repeats. */
function uniqueNames(segment: BusySegment): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of segment.busy) {
    if (seen.has(entry.memberId)) continue;
    seen.add(entry.memberId);
    names.push(entry.memberName);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function busyTooltip(segment: BusySegment, memberCount: number): string {
  const detail = segment.busy
    .map((b) => `${b.memberName} — ${b.title}${b.detail ? ` (${b.detail})` : ""}`)
    .join("\n");
  const clear = memberCount - segment.busyCount;
  const header = `${formatRange(segment.startMinute, segment.endMinute)}`;
  const footer =
    clear > 0
      ? `\n\n${clear} other${clear === 1 ? "" : "s"} have nothing scheduled.`
      : "\n\nEveryone is in class.";
  return `${header}\n\n${detail}${footer}`;
}

/**
 * Shortens display names to first names, but only where that stays unique.
 *
 * "Yifan Li" is what a roster needs; "Yifan" is what fits in a 50-minute block.
 * Two people called Yifan get "Yifan L." and "Yifan Z." instead, so a label is
 * never ambiguous about who is busy.
 */
function makeShortNames(allNames: string[]): (name: string) => string {
  const names = [...new Set(allNames)];

  const firstNameCounts = new Map<string, number>();
  for (const name of names) {
    const first = firstToken(name);
    firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }

  const resolved = new Map<string, string>();
  for (const name of names) {
    const first = firstToken(name);
    if ((firstNameCounts.get(first) ?? 0) <= 1) {
      resolved.set(name, first);
      continue;
    }
    const rest = name.trim().split(/\s+/).slice(1);
    resolved.set(name, rest.length > 0 ? `${first} ${rest[rest.length - 1][0]}.` : name);
  }

  return (name: string) => resolved.get(name) ?? firstToken(name);
}

function firstToken(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Darker tint = more people in class. */
function busyAlpha(busyCount: number, memberCount: number): number {
  const fraction = memberCount <= 1 ? 1 : (busyCount - 1) / (memberCount - 1);
  return Number((0.2 + 0.62 * Math.min(1, Math.max(0, fraction))).toFixed(3));
}

/** Keep label text legible as the tint deepens. */
function contrastText(alpha: number, muted = false): string {
  if (alpha > 0.55) return muted ? "rgb(255 255 255 / 0.8)" : "rgb(255 255 255)";
  return muted ? "var(--text-muted)" : "var(--text)";
}
