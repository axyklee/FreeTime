import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { sessionContext } from "@/lib/session";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "FreeTime — when is everyone free?",
  description:
    "Import your course schedule once, group up with friends, and see when the group is collectively clear.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#131317" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, onboarded } = await sessionContext();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header
          className="sticky top-0 z-20 backdrop-blur"
          style={{
            background: "color-mix(in oklch, var(--bg) 85%, transparent)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
            <Link href={user ? (onboarded ? "/groups" : "/welcome") : "/"} className="flex items-center gap-2">
              <Logo />
              <span className="text-sm font-semibold tracking-tight">FreeTime</span>
            </Link>

            {/*
              Navigation appears only once there is a schedule to compare.
              During onboarding every one of these links would redirect straight
              back to /welcome, which reads as the app being broken.
            */}
            {user && onboarded && (
              <nav className="flex items-center gap-1 text-sm">
                <NavLink href="/schedule">My schedule</NavLink>
                <NavLink href="/friends">Friends</NavLink>
                <NavLink href="/groups">Groups</NavLink>
              </nav>
            )}

            <div className="ml-auto flex items-center gap-3">
              {user ? (
                <>
                  <span
                    className="hidden max-w-[16rem] truncate text-xs sm:block"
                    style={{ color: "var(--text-muted)" }}
                    title={user.email}
                  >
                    {user.email}
                  </span>
                  <SignOutButton />
                </>
              ) : (
                <Link href="/signin" className="btn btn-primary text-xs">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
            style={{ color: "var(--text-faint)" }}
          >
            <span>
              FreeTime reads only the .ics file you upload. It never connects to your calendar
              account.
            </span>
            <a
              href="mailto:aaronl3@andrew.cmu.edu?subject=FreeTime"
              className="btn btn-secondary text-xs"
            >
              Contact us
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-subtle)]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </Link>
  );
}

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="1.5" y="3.5" width="17" height="15" rx="3" fill="none"
        stroke="var(--accent)" strokeWidth="1.6" />
      <path d="M6 1.5v4M14 1.5v4" stroke="var(--accent)" strokeWidth="1.6"
        strokeLinecap="round" />
      <rect x="4.5" y="8.5" width="4" height="3" rx="1" fill="var(--accent)" opacity="0.35" />
      <rect x="11.5" y="12.5" width="4" height="3" rx="1" fill="var(--accent)" opacity="0.35" />
      <rect x="11.5" y="8.5" width="4" height="3" rx="1" fill="var(--accent)" />
    </svg>
  );
}
