import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";

import { getDb, getEnv } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

/**
 * Auth.js is configured lazily (via the function form of `NextAuth`) because
 * Cloudflare only exposes secrets through the per-request environment. A
 * module-level config object would be built before any of them existed.
 */
async function buildConfig(): Promise<NextAuthConfig> {
  const env = await readEnv();
  const db = await getDb();

  const providers: NextAuthConfig["providers"] = [];

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        // Nudges Google's account chooser toward the school account and asks
        // for nothing beyond identity -- FreeTime never reads your calendar.
        authorization: {
          params: {
            scope: "openid email profile",
            prompt: "select_account",
            ...(env.ALLOWED_EMAIL_DOMAIN ? { hd: env.ALLOWED_EMAIL_DOMAIN } : {}),
          },
        },
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (env.DEV_LOGIN_ENABLED) {
    providers.push(
      Credentials({
        id: "dev-login",
        name: "Development sign-in",
        credentials: { email: { label: "Email", type: "email" } },
        async authorize(raw) {
          // Belt and braces: this provider must never exist in production, but
          // check again here in case the flag is set on a deployed instance.
          if (process.env.NODE_ENV === "production") return null;

          const email = normalizeEmail(raw?.email);
          if (!email || !isAllowedDomain(email, env.ALLOWED_EMAIL_DOMAIN)) return null;

          const existing = await db.select().from(users).where(eq(users.email, email)).get();
          if (existing) return existing;

          const created = await db
            .insert(users)
            .values({ email, name: nameFromEmail(email), emailVerified: new Date() })
            .returning()
            .get();
          return created;
        },
      }),
    );
  }

  return {
    // Passed explicitly rather than left to `process.env`: on Cloudflare the
    // secret arrives through the Worker env (and `.dev.vars` locally), which
    // Auth.js does not read on its own.
    secret: env.AUTH_SECRET,
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers,
    // JWT sessions, not database sessions: the Credentials provider requires
    // them, and it spares every request a D1 round trip for session lookup.
    session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
    trustHost: true,
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      /** Domain gate. Applies to every provider, including the dev login. */
      async signIn({ user }) {
        const email = normalizeEmail(user.email);
        if (!email) return false;
        return isAllowedDomain(email, env.ALLOWED_EMAIL_DOMAIN);
      },

      async jwt({ token, user }) {
        // `user` is only present on the request that establishes the session.
        if (user?.id) token.sub = user.id;
        if (user?.email) token.email = user.email;
        return token;
      },

      async session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
}

export const { handlers, signIn, signOut, auth } = NextAuth(buildConfig);

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */

interface AuthEnv {
  AUTH_SECRET: string | undefined;
  AUTH_GOOGLE_ID: string | undefined;
  AUTH_GOOGLE_SECRET: string | undefined;
  ALLOWED_EMAIL_DOMAIN: string | null;
  DEV_LOGIN_ENABLED: boolean;
}

/**
 * Prefers the Cloudflare binding and falls back to `process.env`, so the same
 * code path works under `next dev`, `wrangler dev`, and a real deployment.
 */
async function readEnv(): Promise<AuthEnv> {
  let cf: Record<string, unknown> = {};
  try {
    cf = (await getEnv()) as unknown as Record<string, unknown>;
  } catch {
    // No Cloudflare context (e.g. during build): process.env is enough.
  }
  const read = (key: string): string | undefined => {
    const value = cf[key] ?? process.env[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const domain = read("ALLOWED_EMAIL_DOMAIN")?.trim().toLowerCase().replace(/^@/, "");

  return {
    AUTH_SECRET: read("AUTH_SECRET"),
    AUTH_GOOGLE_ID: read("AUTH_GOOGLE_ID"),
    AUTH_GOOGLE_SECRET: read("AUTH_GOOGLE_SECRET"),
    ALLOWED_EMAIL_DOMAIN: domain && domain.length > 0 ? domain : null,
    DEV_LOGIN_ENABLED:
      process.env.NODE_ENV !== "production" && read("ENABLE_DEV_LOGIN") === "true",
  };
}

/** Whether the app currently offers the password-free development sign-in. */
export async function devLoginEnabled(): Promise<boolean> {
  return (await readEnv()).DEV_LOGIN_ENABLED;
}

export async function googleLoginEnabled(): Promise<boolean> {
  const env = await readEnv();
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

export async function allowedEmailDomain(): Promise<string | null> {
  return (await readEnv()).ALLOWED_EMAIL_DOMAIN;
}

/* ------------------------------------------------------------------ *
 * Email helpers -- shared with group invites, which key on email.
 * ------------------------------------------------------------------ */

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Deliberately loose: real validation is "can this address sign in".
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isAllowedDomain(email: string, domain: string | null): boolean {
  if (!domain) return true;
  return email.endsWith(`@${domain}`);
}

/** "yifan.li" -> "Yifan Li", a decent stand-in until Google supplies a name. */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
