import type { IncomingInvite } from "@/lib/queries";
import { acceptInvite, declineInvite } from "@/actions/groups";
import { SubmitButton } from "./SubmitButton";

/**
 * Pending invitations, awaiting the signed-in user's decision.
 *
 * Nothing is joined on their behalf: accepting a group publishes your whole
 * class schedule to its members, so it stays an explicit choice.
 */
export function InviteInbox({ invites }: { invites: IncomingInvite[] }) {
  if (invites.length === 0) return null;

  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{
        background: "var(--accent-subtle)",
        border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
      }}
    >
      <h2 className="text-sm font-semibold">
        {invites.length === 1 ? "You have an invitation" : `You have ${invites.length} invitations`}
      </h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Accepting lets the group see your class schedule, and lets you see theirs.
      </p>

      <ul className="mt-4 space-y-2">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{invite.groupName}</p>
              <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                From {invite.invitedByName} ({invite.invitedByEmail}) ·{" "}
                {invite.memberCount} member{invite.memberCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <form action={acceptInvite}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <SubmitButton className="btn btn-primary text-xs" pendingLabel="Joining…">
                  Accept
                </SubmitButton>
              </form>
              <form action={declineInvite}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="…">
                  Decline
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
