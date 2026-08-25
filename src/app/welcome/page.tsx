import { redirect } from "next/navigation";

import { getIncomingInvites } from "@/lib/queries";
import { hasSchedule, requireUser } from "@/lib/session";
import { allowedEmailDomain } from "@/auth";
import { UploadForm } from "@/components/UploadForm";
import { InviteInbox } from "@/components/InviteInbox";

/**
 * Onboarding. The one screen a signed-in user without a schedule can reach.
 *
 * Everything else in the app compares schedules, so arriving there first with
 * nothing imported means empty grids and being counted as free all week. This
 * asks for the file once, up front, and explains where to get it.
 */
export default async function WelcomePage() {
  const user = await requireUser();
  if (await hasSchedule(user.id)) redirect("/groups");

  const [invites, domain] = await Promise.all([
    getIncomingInvites(user.email),
    allowedEmailDomain(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <header>
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--accent)" }}
        >
          Step 1 of 1
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Add your class schedule
        </h1>
        <p className="mt-3 text-base" style={{ color: "var(--text-muted)" }}>
          FreeTime works by comparing everyone&rsquo;s classes, so it needs yours before it can
          show you anything useful. This is the only setup step.
        </p>
      </header>

      {invites.length > 0 && (
        <div className="mt-8">
          <InviteInbox invites={invites} />
          <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
            You can accept now — you will still need a schedule before the group view has
            anything to show for you.
          </p>
        </div>
      )}

      <section className="card mt-8 p-5">
        <h2 className="text-sm font-semibold">Where to find your .ics file</h2>
        <ol className="mt-3 space-y-2.5 text-sm" style={{ color: "var(--text-muted)" }}>
          <Step n={1}>
            Open your university&rsquo;s course registration or student information system
            {domain === "andrew.cmu.edu" && (
              <>
                {" "}
                — at CMU that is <strong>SIO</strong>
              </>
            )}
            .
          </Step>
          <Step n={2}>
            Find your schedule for the current term (Course Schedule ... Semester Schedule).
          </Step>
          <Step n={3}>
            Choose <strong>Calendar Export</strong> and it will download a file ending in
            <Code>.ics</Code>. Save it, then upload it below.
          </Step>
        </ol>

        <img
          src="/screenshots/sio-export.png"
          alt="The export option in SIO, on the course schedule page"
          className="mt-4 w-full rounded-lg"
          style={{ border: "1px solid var(--border)" }}
        />

        <div className="mt-5">
          <UploadForm hasExisting={false} redirectTo="/groups" submitLabel="Upload and continue" />
        </div>

        <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
          FreeTime only reads the file you upload — it never connects to your calendar account,
          and only people in groups you join can see your classes. You can replace or remove your
          schedule at any time.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">What happens next</h2>
        <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <li>· Create a group and invite friends by email, or accept an invitation.</li>
          <li>· Nobody sees your classes until you join a group with them.</li>
          <li>
            · Each group shows the week with everyone&rsquo;s classes blocked out, and ranks the
            longest windows when nobody has class.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold"
        style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1 py-0.5 font-mono text-xs"
      style={{ background: "var(--bg-subtle)" }}
    >
      {children}
    </code>
  );
}
