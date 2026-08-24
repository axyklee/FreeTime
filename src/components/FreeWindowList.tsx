import type { FreeWindow } from "@/lib/availability";
import { formatDuration, formatRange, WEEKDAY_LONG } from "@/lib/time";

/**
 * The ranked answer to "so when can we actually meet".
 *
 * A grid shows *where* the week is blocked but is genuinely bad at surfacing
 * the widest gap — that means scanning seven columns and comparing heights.
 * This states it outright, longest first.
 */
export function FreeWindowList({
  windows,
  memberCount,
  limit = 8,
}: {
  windows: FreeWindow[];
  memberCount: number;
  limit?: number;
}) {
  if (windows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        No window long enough for everyone to be clear at once. Try widening the day range or
        lowering the minimum length.
      </p>
    );
  }

  const shown = windows.slice(0, limit);
  const people = memberCount === 1 ? "you are" : `all ${memberCount} are`;

  return (
    <div>
      <ol className="space-y-1.5">
        {shown.map((window, index) => (
          <li
            key={`${window.weekday}-${window.startMinute}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{
              background: index === 0 ? "var(--free-subtle)" : "var(--bg-subtle)",
              border: `1px solid ${index === 0 ? "var(--free)" : "var(--border)"}`,
            }}
          >
            <span
              className="w-20 shrink-0 text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              {WEEKDAY_LONG[window.weekday]}
            </span>
            <span className="flex-1 text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
              {formatRange(window.startMinute, window.endMinute)}
            </span>
            <span
              className="shrink-0 text-sm font-semibold tabular-nums"
              style={{ color: index === 0 ? "var(--free)" : "var(--text-muted)" }}
            >
              {formatDuration(window.durationMinutes)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        {windows.length > limit &&
          `${windows.length - limit} shorter ${windows.length - limit === 1 ? "window" : "windows"} not shown. `}
        Windows where {people} free of scheduled classes. FreeTime only knows about imported
        course schedules — it cannot see anything else on anyone&rsquo;s calendar.
      </p>
    </div>
  );
}
