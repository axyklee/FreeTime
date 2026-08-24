import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionContext } from "@/lib/session";

export default async function HomePage() {
  const { user, onboarded } = await sessionContext();
  if (user) redirect(onboarded ? "/groups" : "/welcome");

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        When is everyone
        <br />
        actually free?
      </h1>
      <p className="mt-5 text-lg" style={{ color: "var(--text-muted)" }}>
        Import your course schedule once. Group up with friends by email. FreeTime shows the
        week with everyone&rsquo;s classes blocked out, so the gaps you all share are the only
        thing left.
      </p>

      <ol className="mt-10 space-y-4">
        <Step n={1} title="Upload your .ics">
          Export your schedule from your registrar as iCalendar and drop it in. It stays your
          single source of truth — re-upload to update it.
        </Step>
        <Step n={2} title="Add friends by email">
          Create a group and invite people. If they haven&rsquo;t signed up yet, they join the
          group automatically the first time they do.
        </Step>
        <Step n={3} title="Read the gaps">
          Every group gets a week grid shaded by how many people are in class, plus a ranked
          list of the longest windows when nobody is.
        </Step>
      </ol>

      <div className="mt-10">
        <Link href="/signin" className="btn btn-primary">
          Get started
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
      >
        {n}
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {children}
        </p>
      </div>
    </li>
  );
}
