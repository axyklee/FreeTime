import Link from "next/link";
import { notFound } from "next/navigation";

import { deriveVisibleWindow, deriveWeekdays } from "@/lib/availability";
import { getFriendSchedule } from "@/lib/queries";
import { requireOnboardedUser } from "@/lib/session";
import { formatDuration, formatIsoDate, formatRelativeDate } from "@/lib/time";
import { ScheduleGrid } from "@/components/ScheduleGrid";

export default async function FriendSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOnboardedUser();
  const { id } = await params;

  // Returns null unless the two share a group, which both sides consented to.
  const view = await getFriendSchedule(user.id, id);
  if (!view) notFound();

  const { friend, blocks, schedule, sharedGroups } = view;
  const { dayStart, dayEnd } = deriveVisibleWindow(blocks);
  const weekdays = deriveWeekdays(blocks);
  const weeklyMinutes = blocks.reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0);

  return (
    <div className="space-y-8">
      <header>
        <Link href="/friends" className="text-xs" style={{ color: "var(--text-muted)" }}>
          ← All friends
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{friend.name}</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {friend.email} · shared with you in {sharedGroups.join(", ")}
        </p>
      </header>

      {schedule ? (
        <>
          <section className="card p-4 sm:p-5">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <Stat label="Courses" value={String(schedule.courseCount)} />
              <Stat label="Weekly meetings" value={String(schedule.meetingCount)} />
              <Stat label="Hours in class" value={formatDuration(weeklyMinutes)} />
              <Stat
                label="Term"
                value={
                  schedule.termStart && schedule.termEnd
                    ? `${formatIsoDate(schedule.termStart)} – ${formatIsoDate(schedule.termEnd)}`
                    : "—"
                }
              />
            </dl>
            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              Imported {formatRelativeDate(schedule.importedAt)}.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">{friend.name}&rsquo;s typical week</h2>
            <ScheduleGrid
              blocks={blocks}
              dayStart={dayStart}
              dayEnd={dayEnd}
              weekdays={weekdays}
            />
            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              This is only what {friend.name} imported from their registrar. It is not a full
              picture of their availability.
            </p>
          </section>
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {friend.name} has not imported a schedule yet, so there is nothing to show. They count
          as free all week in any group you share.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}
