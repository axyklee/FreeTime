import type { MeetingBlock, Weekday } from "@/lib/ics";
import { formatRange } from "@/lib/time";
import {
  makeCourseHue,
  spanFitsDetail,
  spanFitsLabel,
  spanStyle,
  WeekGridShell,
} from "./WeekGrid";

interface ScheduleGridProps {
  blocks: MeetingBlock[];
  dayStart: number;
  dayEnd: number;
  weekdays: Weekday[];
}

/** One person's week, with each course in a consistent colour. */
export function ScheduleGrid({ blocks, dayStart, dayEnd, weekdays }: ScheduleGridProps) {
  const emptyDays = new Set(
    weekdays.filter((weekday) => !blocks.some((b) => b.weekday === weekday)),
  );
  const hueFor = makeCourseHue(blocks.map(courseKey));

  return (
    <WeekGridShell
      dayStart={dayStart}
      dayEnd={dayEnd}
      weekdays={weekdays}
      emptyDays={emptyDays}
      renderDay={(weekday) => {
        const dayBlocks = blocks
          .filter((b) => b.weekday === weekday)
          .sort((a, b) => a.startMinute - b.startMinute);

        // Lay overlapping classes side by side rather than hiding one.
        const lanes = assignLanes(dayBlocks);

        return dayBlocks.map((block, index) => {
          const position = spanStyle(block.startMinute, block.endMinute, dayStart, dayEnd);
          if (!position) return null;

          const { lane, laneCount } = lanes[index];
          const hue = hueFor(courseKey(block));
          const label = block.courseCode ?? block.courseName;

          return (
            <div
              key={block.sourceKey}
              className="absolute overflow-hidden rounded-md px-1.5 py-1 text-[0.6875rem] leading-tight"
              style={{
                ...position,
                left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                width: `calc(${(1 / laneCount) * 100}% - 4px)`,
                background: `color-mix(in oklch, hsl(${hue} 70% 50%) 20%, var(--surface))`,
                borderLeft: `3px solid hsl(${hue} 70% 50%)`,
                color: "var(--text)",
              }}
              title={`${block.courseName}${block.section ? ` (${block.section})` : ""}\n${formatRange(block.startMinute, block.endMinute)}${block.location ? `\n${block.location}` : ""}${block.instructor ? `\n${block.instructor}` : ""}`}
            >
              <div className="truncate font-semibold">{label}</div>
              {spanFitsLabel(block.startMinute, block.endMinute) && (
                <div className="truncate" style={{ color: "var(--text-muted)" }}>
                  {formatRange(block.startMinute, block.endMinute)}
                </div>
              )}
              {spanFitsDetail(block.startMinute, block.endMinute) && block.location && (
                <div className="truncate" style={{ color: "var(--text-faint)" }}>
                  {block.location}
                </div>
              )}
            </div>
          );
        });
      }}
    />
  );
}

/** Colour identity: a course, not an individual meeting. */
function courseKey(block: MeetingBlock): string {
  return block.courseCode ?? block.courseName;
}

/**
 * Greedy lane packing so simultaneous classes sit next to each other.
 * `laneCount` is the width of the whole overlapping cluster, so blocks in one
 * cluster divide the column evenly.
 */
function assignLanes(
  blocks: MeetingBlock[],
): { lane: number; laneCount: number }[] {
  const result: { lane: number; laneCount: number }[] = blocks.map(() => ({
    lane: 0,
    laneCount: 1,
  }));

  let clusterStart = 0;
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const closeCluster = (upto: number) => {
    for (let i = clusterStart; i < upto; i++) {
      result[i].laneCount = Math.max(1, laneEnds.length);
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.startMinute >= clusterEnd) {
      // No overlap with the running cluster: close it and start fresh.
      closeCluster(i);
      clusterStart = i;
      laneEnds = [];
      clusterEnd = -Infinity;
    }

    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinute);
    } else {
      laneEnds[lane] = block.endMinute;
    }
    result[i].lane = lane;
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  closeCluster(blocks.length);

  return result;
}
