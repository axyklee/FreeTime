"use client";

import { useActionState, useRef, useState } from "react";
import { importSchedule } from "@/actions/schedule";
import { IDLE } from "@/lib/action-state";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

export function UploadForm({
  hasExisting,
  redirectTo,
  submitLabel,
}: {
  hasExisting: boolean;
  /** Where to land after a successful import. Stays put when omitted. */
  redirectTo?: string;
  submitLabel?: string;
}) {
  const [state, action] = useActionState(importSchedule, IDLE);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action}>
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <div
        className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center"
        style={{ borderColor: "var(--border-strong)", background: "var(--bg-subtle)" }}
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".ics,text/calendar"
          required
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          className="sr-only"
          id="ics-file"
        />
        <label htmlFor="ics-file" className="btn btn-secondary cursor-pointer">
          Choose .ics file
        </label>
        <span className="flex-1 truncate text-sm" style={{ color: "var(--text-muted)" }}>
          {fileName ?? "No file selected"}
        </span>
        <SubmitButton pendingLabel="Importing…">
          {submitLabel ?? (hasExisting ? "Replace schedule" : "Import schedule")}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
