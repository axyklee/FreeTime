"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { getDb, type Db } from "@/db";
import { groupInvites, groupMembers, groups, users } from "@/db/schema";
import { hasSchedule, requireUser } from "@/lib/session";
import { allowedEmailDomain, isAllowedDomain, normalizeEmail } from "@/auth";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { sendInviteEmail, type EmailResult } from "@/lib/email";

const MAX_NAME_LENGTH = 60;

export async function createGroup(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return fail("Give the group a name.");
  if (name.length > MAX_NAME_LENGTH) {
    return fail(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }

  const db = await getDb();
  const groupId = crypto.randomUUID();

  try {
    await db.batch([
      db.insert(groups).values({ id: groupId, name, ownerId: user.id }),
      db
        .insert(groupMembers)
        .values({ groupId, userId: user.id, role: "owner" })
        .onConflictDoNothing(),
    ]);
  } catch (error) {
    console.error("create group failed", error);
    return fail("Creating the group failed. Please try again.");
  }

  revalidatePath("/groups");
  redirect(`/groups/${groupId}`);
}

export async function inviteToGroup(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const groupId = String(formData.get("groupId") ?? "");
  const email = normalizeEmail(formData.get("email"));
  if (!groupId) return fail("Missing group.");
  if (!email) return fail("Enter a valid email address.");

  const domain = await allowedEmailDomain();
  if (!isAllowedDomain(email, domain)) {
    return fail(`Only @${domain} addresses can join FreeTime.`);
  }
  if (email === user.email.toLowerCase()) {
    return fail("You are already in this group.");
  }

  const db = await getDb();
  const role = await roleInGroup(db, groupId, user.id);
  if (!role) return fail("You are not a member of that group.");

  // Already a member? Say so rather than creating a dead invite.
  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    const already = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, existingUser.id)))
      .get();
    if (already) return fail(`${email} is already in this group.`);
  }

  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return fail("That group no longer exists.");

  let created;
  try {
    // An invite is only ever an invite. Joining a group publishes your entire
    // class schedule to everyone in it, so that has to be the invitee's
    // decision -- never a side effect of someone else typing your address.
    // Invites are keyed by email so this works whether or not they have an
    // account yet.
    //
    // `returning()` tells us whether a row was actually written. On a conflict
    // nothing is inserted, and we must not send another email -- otherwise
    // re-submitting the form is a way to mail someone repeatedly.
    created = await db
      .insert(groupInvites)
      .values({ groupId, email, invitedByUserId: user.id })
      .onConflictDoNothing()
      .returning({ id: groupInvites.id })
      .get();
  } catch (error) {
    console.error("invite failed", error);
    return fail("Saving that invite failed. Please try again.");
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");

  if (!created) {
    return fail(
      `${email} has already been invited and hasn't responded yet. Use "Send again" if the email went missing.`,
    );
  }

  const delivery = await sendInviteEmail({
    to: email,
    groupName: group.name,
    inviterName: user.name?.trim() || user.email.split("@")[0],
    inviterEmail: user.email,
    memberCount: await memberCountOf(db, groupId),
  });

  const pending = existingUser
    ? `They will appear in this group once they accept.`
    : `They have no FreeTime account yet — the invitation will be waiting when they first sign in.`;

  // The invite is stored either way; email is a notification, not the record.
  // Say plainly which happened rather than implying an email went out.
  return describeDelivery(delivery, email, pending);
}

/** Sends the invitation email again, for when the first one went missing. */
export async function sendInviteAgain(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!groupId || !inviteId) return;

  const db = await getDb();
  if (!(await roleInGroup(db, groupId, user.id))) return;

  const invite = await db
    .select()
    .from(groupInvites)
    .where(and(eq(groupInvites.id, inviteId), eq(groupInvites.groupId, groupId)))
    .get();
  if (!invite) return;

  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return;

  await sendInviteEmail({
    to: invite.email,
    groupName: group.name,
    inviterName: user.name?.trim() || user.email.split("@")[0],
    inviterEmail: user.email,
    memberCount: await memberCountOf(db, groupId),
  });

  revalidatePath(`/groups/${groupId}`);
}

export async function acceptInvite(formData: FormData): Promise<void> {
  const user = await requireUser();
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return;

  const db = await getDb();

  // Match on both id and email: an invite may only be accepted by the address
  // it was addressed to, so knowing an invite id is not enough to join.
  const invite = await db
    .select()
    .from(groupInvites)
    .where(
      and(eq(groupInvites.id, inviteId), eq(groupInvites.email, user.email.toLowerCase())),
    )
    .get();
  if (!invite) return;

  await db.batch([
    db
      .insert(groupMembers)
      .values({ groupId: invite.groupId, userId: user.id, role: "member" })
      .onConflictDoNothing(),
    db.delete(groupInvites).where(eq(groupInvites.id, invite.id)),
  ]);

  revalidatePath("/groups");
  revalidatePath("/friends");
  revalidatePath(`/groups/${invite.groupId}`);

  // Invites can be accepted during onboarding; the group page is gated, so send
  // them back to finish rather than through a redirect they did not ask for.
  if (!(await hasSchedule(user.id))) redirect("/welcome");
  redirect(`/groups/${invite.groupId}`);
}

export async function declineInvite(formData: FormData): Promise<void> {
  const user = await requireUser();
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return;

  const db = await getDb();
  await db
    .delete(groupInvites)
    .where(
      and(eq(groupInvites.id, inviteId), eq(groupInvites.email, user.email.toLowerCase())),
    )
    .run();

  revalidatePath("/groups");
}

export async function removeMember(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("userId") ?? "");
  if (!groupId || !memberId) return;

  const db = await getDb();
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return;

  // Only the owner removes people, and the owner cannot be removed.
  if (group.ownerId !== user.id || memberId === group.ownerId) return;

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId)))
    .run();

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");
  revalidatePath("/friends");
}

export async function cancelInvite(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!groupId || !inviteId) return;

  const db = await getDb();
  if (!(await roleInGroup(db, groupId, user.id))) return;

  await db
    .delete(groupInvites)
    .where(and(eq(groupInvites.id, inviteId), eq(groupInvites.groupId, groupId)))
    .run();

  revalidatePath(`/groups/${groupId}`);
}

export async function leaveGroup(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!groupId) return;

  const db = await getDb();
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return;

  // The owner deletes the group instead of leaving it, so a group is never
  // left without someone able to manage it.
  if (group.ownerId === user.id) return;

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    .run();

  revalidatePath("/groups");
  revalidatePath("/friends");
  redirect("/groups");
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  if (!groupId) return;

  const db = await getDb();
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group || group.ownerId !== user.id) return;

  // Members and invites cascade from the group row.
  await db.delete(groups).where(eq(groups.id, groupId)).run();

  revalidatePath("/groups");
  revalidatePath("/friends");
  redirect("/groups");
}

export async function renameGroup(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!groupId) return fail("Missing group.");
  if (name.length === 0) return fail("Give the group a name.");
  if (name.length > MAX_NAME_LENGTH) {
    return fail(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }

  const db = await getDb();
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group || group.ownerId !== user.id) {
    return fail("Only the group owner can rename it.");
  }

  await db.update(groups).set({ name }).where(eq(groups.id, groupId)).run();

  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");
  return ok("Group renamed.");
}

/** Turns a delivery outcome into an honest message for the inviter. */
function describeDelivery(
  delivery: EmailResult,
  email: string,
  pending: string,
): ActionState {
  switch (delivery.status) {
    case "sent":
      return ok(`Invited ${email} and emailed them. ${pending}`);
    case "skipped":
      return ok(
        `Invited ${email}, but no email was sent (${delivery.reason}) — tell them to sign in and check their invitations. ${pending}`,
      );
    case "error":
      return ok(
        `Invited ${email}, but the invitation email could not be sent (${delivery.reason}). The invite is saved — try "Send again", or tell them directly. ${pending}`,
      );
  }
}

async function memberCountOf(db: Db, groupId: string): Promise<number> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all();
  return rows.length;
}

/** The viewer's role in a group, or null when they are not a member. */
async function roleInGroup(
  db: Db,
  groupId: string,
  userId: string,
): Promise<"owner" | "member" | null> {
  const row = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();
  return row?.role ?? null;
}
