import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { getDb } from "@/db";
import { schedules, users } from "@/db/schema";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface SessionContext {
  user: SessionUser | null;
  /** Whether the user has imported a schedule -- the onboarding gate. */
  onboarded: boolean;
}

/**
 * The signed-in user, or null.
 *
 * Sessions are JWTs, so the cookie alone does not prove the account still
 * exists -- a deleted user keeps a technically valid token until it expires,
 * and every write they attempt then fails on a foreign key with a generic
 * error. One primary-key lookup turns that into a clean sign-out.
 *
 * `cache` scopes the read to a single request, so the layout and the page it
 * renders share one query rather than issuing one each.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const claim = session?.user;
  if (!claim?.id || !claim.email) return null;

  const db = await getDb();
  const row = await db
    .select({ id: users.id, email: users.email, name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, claim.id))
    .get();
  if (!row) return null;

  return { id: row.id, email: row.email, name: row.name, image: row.image };
});

/** Whether this user has imported a schedule. */
export const hasSchedule = cache(async (userId: string): Promise<boolean> => {
  const db = await getDb();
  const row = await db
    .select({ userId: schedules.userId })
    .from(schedules)
    .where(eq(schedules.userId, userId))
    .get();
  return Boolean(row);
});

/** User plus onboarding state, for deciding what navigation to render. */
export const sessionContext = cache(async (): Promise<SessionContext> => {
  const user = await currentUser();
  if (!user) return { user: null, onboarded: false };
  return { user, onboarded: await hasSchedule(user.id) };
});

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

/**
 * A signed-in user who has imported a schedule.
 *
 * The whole app compares schedules, so every screen past onboarding is either
 * empty or misleading without one -- a member with no schedule reads as free
 * all week. Sending people to /welcome until they have uploaded keeps that from
 * being something they have to notice and fix themselves.
 */
export async function requireOnboardedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await hasSchedule(user.id))) redirect("/welcome");
  return user;
}
