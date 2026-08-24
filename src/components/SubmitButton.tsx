"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Native confirm before submitting — used for destructive actions. */
  confirm?: string;
}

export function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
  confirm,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending && <Spinner />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12" cy="12" r="10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeLinecap="round"
      />
    </svg>
  );
}
