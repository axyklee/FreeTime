"use client";

import { useActionState, useState } from "react";
import { renameGroup } from "@/actions/groups";
import { IDLE } from "@/lib/action-state";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

export function RenameGroupForm({ groupId, name }: { groupId: string; name: string }) {
  const [state, action] = useActionState(renameGroup, IDLE);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost text-xs" onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  }

  return (
    <form action={action} className="w-full max-w-md">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input" name="name" defaultValue={name} maxLength={60} required autoFocus />
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
