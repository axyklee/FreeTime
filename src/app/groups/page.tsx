import Link from "next/link";
import { getIncomingInvites, getMyGroups } from "@/lib/queries";
import { requireOnboardedUser } from "@/lib/session";
import { CreateGroupForm } from "@/components/CreateGroupForm";
import { InviteInbox } from "@/components/InviteInbox";

export default async function GroupsPage() {
  const user = await requireOnboardedUser();
  const [groups, invites] = await Promise.all([
    getMyGroups(user.id),
    getIncomingInvites(user.email),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          A group is a set of friends whose schedules you want to compare.
        </p>
      </header>

      <InviteInbox invites={invites} />

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">New group</h2>
        <CreateGroupForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Your groups{" "}
          {groups.length > 0 && <span style={{ color: "var(--text-faint)" }}>({groups.length})</span>}
        </h2>

        {groups.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No groups yet. Create one above, then invite friends by email.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="card block p-4 transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium">{group.name}</h3>
                    {group.role === "owner" && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide"
                        style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                      >
                        Owner
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                    {group.pendingInviteCount > 0 &&
                      ` · ${group.pendingInviteCount} awaiting acceptance`}
                  </p>
                  {group.membersWithoutSchedule > 0 && (
                    <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                      {group.membersWithoutSchedule} member
                      {group.membersWithoutSchedule === 1 ? " has" : "s have"} not imported a
                      schedule
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
