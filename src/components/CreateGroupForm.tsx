"use client";

import { useActionState } from "react";
import { createGroup } from "@/actions/groups";
import { IDLE } from "@/lib/action-state";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

export function CreateGroupForm() {
  const [state, action] = useActionState(createGroup, IDLE);

  return (
    <form action={action}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          name="name"
          placeholder="e.g. Physics study group"
          maxLength={60}
          required
          aria-label="Group name"
        />
        <SubmitButton pendingLabel="Creating…">Create group</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
