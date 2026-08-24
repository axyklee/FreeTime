/** Shared shape for `useActionState` form results. */
export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
  /** Non-fatal notes, e.g. iCalendar parser warnings after an import. */
  details?: string[];
}

export const IDLE: ActionState = { status: "idle", message: "" };

export function ok(message: string, details?: string[]): ActionState {
  return { status: "success", message, ...(details?.length ? { details } : {}) };
}

export function fail(message: string, details?: string[]): ActionState {
  return { status: "error", message, ...(details?.length ? { details } : {}) };
}
