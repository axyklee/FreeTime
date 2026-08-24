"use client";

import { useActionState } from "react";
import { inviteToGroup } from "@/actions/groups";
import { IDLE } from "@/lib/action-state";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

export function InviteForm({
  groupId,
  allowedDomain,
}: {
  groupId: string;
  allowedDomain: string | null;
}) {
  const [state, action] = useActionState(inviteToGroup, IDLE);

  return (
    <form action={action}>
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          type="email"
          name="email"
          placeholder={allowedDomain ? `friend@${allowedDomain}` : "friend@example.com"}
          required
          aria-label="Friend's email address"
        />
        <SubmitButton pendingLabel="Inviting…" className="btn btn-secondary">
          Invite
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
