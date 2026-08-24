import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildWeekAvailability,
  DEFAULT_MIN_WINDOW,
  deriveVisibleWindow,
  deriveWeekdays,
  findCommonFreeWindows,
  summarizeMemberLoad,
} from "@/lib/availability";
import { getGroupDetail, toMemberSchedules } from "@/lib/queries";
import { requireOnboardedUser } from "@/lib/session";
import { allowedEmailDomain } from "@/auth";
import { formatDuration } from "@/lib/time";
import {
  cancelInvite,
  deleteGroup,
  leaveGroup,
  removeMember,
  sendInviteAgain,
} from "@/actions/groups";
import { FreeWindowList } from "@/components/FreeWindowList";
import { InviteForm } from "@/components/InviteForm";
import { OverlapGrid } from "@/components/OverlapGrid";
import { RenameGroupForm } from "@/components/RenameGroupForm";
import { SubmitButton } from "@/components/SubmitButton";

const MIN_WINDOW_CHOICES = [30, 45, 60, 90, 120];

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ min?: string }>;
}) {
  const user = await requireOnboardedUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const group = await getGroupDetail(user.id, id);
  if (!group) notFound();

  const domain = await allowedEmailDomain();

  const minWindow = MIN_WINDOW_CHOICES.includes(Number(query.min))
    ? Number(query.min)
    : DEFAULT_MIN_WINDOW;

  const members = toMemberSchedules(group.members);
  const allBlocks = members.flatMap((m) => m.blocks);

  const { dayStart, dayEnd } = deriveVisibleWindow(allBlocks);
  const weekdays = deriveWeekdays(allBlocks);

  const availability = buildWeekAvailability(members, { dayStart, dayEnd, weekdays });
  const freeWindows = findCommonFreeWindows(availability, minWindow);
  const load = summarizeMemberLoad(members);
  const isOwner = group.viewerRole === "owner";
  const withoutSchedule = group.members.filter((m) => !m.hasSchedule);

  return (
    <div className="space-y-8">
      <header>
        <Link href="/groups" className="text-xs" style={{ color: "var(--text-muted)" }}>
          ← All groups
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
          {isOwner && <RenameGroupForm groupId={group.id} name={group.name} />}
        </div>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {group.members.length} member{group.members.length === 1 ? "" : "s"}
          {withoutSchedule.length > 0 &&
            ` · ${withoutSchedule.length} without a schedule imported`}
        </p>
      </header>

      {withoutSchedule.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "var(--accent-subtle)",
            border: "1px solid color-mix(in oklch, var(--accent) 28%, transparent)",
          }}
        >
          {withoutSchedule.map((m) => m.name).join(", ")}{" "}
          {withoutSchedule.length === 1 ? "has" : "have"} not imported a schedule, so they count
          as free all week. Treat the windows below as optimistic until they do.
        </div>
      )}

      {/* The answer first, then the evidence for it. */}
      <section className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">When everyone is clear</h2>
          <div className="flex items-center gap-1.5 text-xs">
            <span style={{ color: "var(--text-faint)" }}>At least</span>
            {MIN_WINDOW_CHOICES.map((choice) => (
              <Link
                key={choice}
                href={`/groups/${group.id}?min=${choice}`}
                scroll={false}
                className="rounded-md px-2 py-1 tabular-nums transition-colors"
                style={
                  choice === minWindow
                    ? { background: "var(--accent)", color: "var(--accent-text)" }
                    : { color: "var(--text-muted)", background: "var(--bg-subtle)" }
                }
              >
                {formatDuration(choice)}
              </Link>
            ))}
          </div>
        </div>
        <FreeWindowList windows={freeWindows} memberCount={members.length} />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">The group&rsquo;s week</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Shaded blocks are classes. Hover any block to see who is in what.
        </p>
        {availability.empty ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nobody in this group has imported a schedule yet, so there is nothing to block out.
          </p>
        ) : (
          <OverlapGrid
            availability={availability}
            weekdays={weekdays}
            minWindowMinutes={minWindow}
          />
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Members</h2>
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {group.members.map((member) => {
            const stats = load.find((l) => l.memberId === member.userId);
            const isSelf = member.userId === user.id;
            return (
              <li key={member.userId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <Link
                      href={isSelf ? "/schedule" : `/friends/${member.userId}`}
                      className="hover:underline"
                    >
                      {member.name}
                    </Link>
                    {isSelf && (
                      <span className="ml-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
                        (you)
                      </span>
                    )}
                    {member.role === "owner" && (
                      <span className="ml-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
                        · owner
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {member.email}
                  </p>
                </div>

                <span
                  className="shrink-0 text-xs tabular-nums"
                  style={{ color: member.hasSchedule ? "var(--text-muted)" : "var(--text-faint)" }}
                >
                  {member.hasSchedule
                    ? `${stats?.meetingCount ?? 0} meetings · ${formatDuration(stats?.busyMinutes ?? 0)}`
                    : "no schedule"}
                </span>

                {isOwner && !isSelf && (
                  <form action={removeMember}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="userId" value={member.userId} />
                    <SubmitButton
                      className="btn btn-ghost text-xs"
                      pendingLabel="…"
                      confirm={`Remove ${member.name} from ${group.name}?`}
                    >
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        {group.pendingInvites.length > 0 && (
          <div className="mt-4">
            <h3
              className="mb-2 text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--text-faint)" }}
            >
              Awaiting acceptance
            </h3>
            <ul className="space-y-1.5">
              {group.pendingInvites.map((invite) => (
                <li key={invite.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-muted)" }}>
                    {invite.email}
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--text-faint)" }}>
                    not joined yet
                  </span>
                  <form action={sendInviteAgain}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <SubmitButton className="btn btn-ghost text-xs" pendingLabel="Sending…">
                      Send again
                    </SubmitButton>
                  </form>
                  <form action={cancelInvite}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <SubmitButton className="btn btn-ghost text-xs" pendingLabel="…">
                      Cancel
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
            Invite a friend
          </h3>
          <InviteForm groupId={group.id} allowedDomain={domain} />
          <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
            They choose whether to join. Nobody&rsquo;s schedule is shared until they accept.
          </p>
        </div>
      </section>

      <section className="flex justify-end">
        {isOwner ? (
          <form action={deleteGroup}>
            <input type="hidden" name="groupId" value={group.id} />
            <SubmitButton
              className="btn btn-danger text-xs"
              pendingLabel="Deleting…"
              confirm={`Delete "${group.name}"? Everyone loses access to this view. Schedules are not affected.`}
            >
              Delete group
            </SubmitButton>
          </form>
        ) : (
          <form action={leaveGroup}>
            <input type="hidden" name="groupId" value={group.id} />
            <SubmitButton
              className="btn btn-danger text-xs"
              pendingLabel="Leaving…"
              confirm={`Leave "${group.name}"?`}
            >
              Leave group
            </SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}
