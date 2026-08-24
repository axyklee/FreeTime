import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { allowedEmailDomain, devLoginEnabled, googleLoginEnabled, signIn } from "@/auth";
import { sessionContext } from "@/lib/session";
import { SubmitButton } from "@/components/SubmitButton";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user, onboarded } = await sessionContext();
  if (user) redirect(onboarded ? "/groups" : "/welcome");

  const [google, dev, domain, params] = await Promise.all([
    googleLoginEnabled(),
    devLoginEnabled(),
    allowedEmailDomain(),
    searchParams,
  ]);

  return (
    <div className="mx-auto max-w-md py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to FreeTime</h1>
      {domain && (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Open to <span className="font-medium">@{domain}</span> accounts.
        </p>
      )}

      {params.error && <ErrorNote code={params.error} domain={domain} />}

      <div className="mt-7 space-y-5">
        {google ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/welcome" });
            }}
          >
            <SubmitButton className="btn btn-primary w-full" pendingLabel="Redirecting…">
              <GoogleMark />
              Continue with Google
            </SubmitButton>
          </form>
        ) : (
          <div
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{
              background: "color-mix(in oklch, var(--danger) 8%, transparent)",
              border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
            }}
          >
            Google sign-in is not configured. Set <Code>AUTH_GOOGLE_ID</Code> and{" "}
            <Code>AUTH_GOOGLE_SECRET</Code> — see the README.
          </div>
        )}

        {dev && (
          <>
            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-faint)" }}>
              <span className="h-px flex-1" style={{ background: "var(--border)" }} />
              development only
              <span className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>

            <form
              action={async (formData: FormData) => {
                "use server";
                const email = String(formData.get("email") ?? "");
                try {
                  await signIn("dev-login", { email, redirectTo: "/welcome" });
                } catch (error) {
                  // AuthError means the sign-in was rejected; anything else is
                  // the redirect Next.js throws on success.
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
              className="card p-4"
            >
              <label className="label" htmlFor="dev-email">
                Sign in as any email
              </label>
              <input
                id="dev-email"
                className="input"
                type="email"
                name="email"
                required
                placeholder={domain ? `you@${domain}` : "you@example.com"}
              />
              <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
                No password, no Google account. Handy for creating a few test users and seeing a
                group with more than one schedule in it. Disabled automatically in production.
              </p>
              <div className="mt-3">
                <SubmitButton className="btn btn-secondary w-full" pendingLabel="Signing in…">
                  Continue
                </SubmitButton>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorNote({ code, domain }: { code: string; domain: string | null }) {
  const message =
    code === "AccessDenied"
      ? domain
        ? `That account is not an @${domain} address, so it cannot sign in.`
        : "That account is not allowed to sign in."
      : code === "CredentialsSignin"
        ? domain
          ? `Enter a valid @${domain} email address.`
          : "Enter a valid email address."
        : "Sign-in failed. Please try again.";

  return (
    <div
      role="alert"
      className="mt-5 rounded-lg px-3 py-2.5 text-sm"
      style={{
        background: "color-mix(in oklch, var(--danger) 10%, transparent)",
        border: "1px solid color-mix(in oklch, var(--danger) 35%, transparent)",
      }}
    >
      {message}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1 py-0.5 font-mono text-xs"
      style={{ background: "var(--bg-subtle)" }}
    >
      {children}
    </code>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="currentColor" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
      <path fill="currentColor" opacity="0.75" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H1.02v2.34A8.99 8.99 0 0 0 9 18Z" />
      <path fill="currentColor" opacity="0.55" d="M3.98 10.72a5.41 5.41 0 0 1 0-3.44V4.94H1.02a9 9 0 0 0 0 8.12l2.96-2.34Z" />
      <path fill="currentColor" opacity="0.85" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.99 8.99 0 0 0 1.02 4.94L3.98 7.28C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
