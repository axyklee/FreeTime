import type { ActionState } from "@/lib/action-state";

/** Inline result banner for a server action, including parser warnings. */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";
  const accent = isError ? "var(--danger)" : "var(--free)";

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 rounded-lg px-3 py-2.5 text-sm"
      style={{
        background: `color-mix(in oklch, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in oklch, ${accent} 35%, transparent)`,
        color: "var(--text)",
      }}
    >
      <p>{state.message}</p>
      {state.details && state.details.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {state.details.map((detail) => (
            <li key={detail} className="flex gap-1.5">
              <span aria-hidden>·</span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
