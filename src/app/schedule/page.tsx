import { deriveVisibleWindow, deriveWeekdays } from "@/lib/availability";
import { getMySchedule } from "@/lib/queries";
import { requireOnboardedUser } from "@/lib/session";
import { formatDuration, formatIsoDate, formatRelativeDate } from "@/lib/time";
import { deleteSchedule } from "@/actions/schedule";
import { ScheduleGrid } from "@/components/ScheduleGrid";
import { UploadForm } from "@/components/UploadForm";
import { SubmitButton } from "@/components/SubmitButton";

export default async function SchedulePage() {
  const user = await requireOnboardedUser();
  const { schedule, blocks } = await getMySchedule(user.id);

  const { dayStart, dayEnd } = deriveVisibleWindow(blocks);
  const weekdays = deriveWeekdays(blocks);
  const weeklyMinutes = blocks.reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My schedule</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          This is your single source of truth. Everyone in your groups sees these classes.
        </p>
      </header>

      <section className="card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">
          {schedule ? "Replace your schedule" : "Import your schedule"}
        </h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Export your courses from your registrar as an iCalendar (.ics) file and upload it.
          Importing replaces whatever is here now.
        </p>
        <UploadForm hasExisting={Boolean(schedule)} />
      </section>

      {schedule ? (
        <>
          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
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

              <form action={deleteSchedule}>
                <SubmitButton
                  className="btn btn-danger text-xs"
                  pendingLabel="Removing…"
                  confirm="Remove your schedule? Your groups will show you as having no classes."
                >
                  Remove schedule
                </SubmitButton>
              </form>
            </div>

            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              From <span className="font-mono">{schedule.fileName}</span>, imported{" "}
              {formatRelativeDate(schedule.importedAt)}.
            </p>

            {schedule.warnings.length > 0 && (
              <div
                className="mt-4 rounded-lg px-3 py-2.5"
                style={{
                  background: "color-mix(in oklch, var(--danger) 8%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--danger) 25%, transparent)",
                }}
              >
                <p className="text-xs font-semibold">
                  {schedule.warnings.length} thing
                  {schedule.warnings.length === 1 ? "" : "s"} we could not read cleanly
                </p>
                <ul className="mt-1.5 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {schedule.warnings.map((warning) => (
                    <li key={warning}>· {warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Your typical week</h2>
            <ScheduleGrid
              blocks={blocks}
              dayStart={dayStart}
              dayEnd={dayEnd}
              weekdays={weekdays}
            />
            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              Every meeting in the file repeats weekly for the whole term, so one week describes
              all of it. Times are shown exactly as the file states them — course exports carry
              no timezone.
            </p>
          </section>
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing imported yet. Upload an .ics file above to get started.
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
