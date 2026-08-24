/**
 * Read-side data access. Every function that reaches another person's schedule
 * takes the viewing user's id and proves the relationship itself, so a page can
 * never expose a schedule by trusting an id from the URL.
 */

import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { groupInvites, groupMembers, groups, meetings, schedules, users } from "@/db/schema";
import type { MeetingBlock, Weekday } from "./ics";
import type { MemberSchedule } from "./availability";

export interface ScheduleSummary {
  fileName: string;
  importedAt: Date;
  termStart: string | null;
  termEnd: string | null;
  courseCount: number;
  warnings: string[];
  meetingCount: number;
}

export interface MyScheduleView {
  schedule: ScheduleSummary | null;
  blocks: MeetingBlock[];
}

export interface GroupSummary {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  pendingInviteCount: number;
  /** Members who have not imported a schedule yet. */
  membersWithoutSchedule: number;
}

export interface GroupMemberView {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "member";
  hasSchedule: boolean;
  blocks: MeetingBlock[];
}

export interface GroupDetail {
  id: string;
  name: string;
  ownerId: string;
  viewerRole: "owner" | "member";
  members: GroupMemberView[];
  pendingInvites: { id: string; email: string }[];
}

/** An invitation waiting on the signed-in user's decision. */
export interface IncomingInvite {
  id: string;
  groupId: string;
  groupName: string;
  invitedByName: string;
  invitedByEmail: string;
  memberCount: number;
}

export interface FriendSummary {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** Names of the groups this person shares with the viewer. */
  sharedGroups: string[];
  hasSchedule: boolean;
  meetingCount: number;
  busyMinutes: number;
}

export interface FriendScheduleView {
  friend: { userId: string; name: string; email: string; image: string | null };
  sharedGroups: string[];
  schedule: ScheduleSummary | null;
  blocks: MeetingBlock[];
}

/* ------------------------------------------------------------------ *
 * Schedules
 * ------------------------------------------------------------------ */

export async function getMySchedule(userId: string): Promise<MyScheduleView> {
  const db = await getDb();

  const schedule = await db.select().from(schedules).where(eq(schedules.userId, userId)).get();
  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.userId, userId))
    .orderBy(asc(meetings.weekday), asc(meetings.startMinute))
    .all();

  const blocks = rows.map(rowToBlock);
  return { schedule: schedule ? toSummary(schedule, blocks.length) : null, blocks };
}

/* ------------------------------------------------------------------ *
 * Invitations
 * ------------------------------------------------------------------ */

/**
 * Invitations addressed to this email, awaiting acceptance.
 *
 * Invites are keyed by email rather than user id so someone can be invited
 * before they have an account. They are never converted into a membership
 * automatically: joining a group exposes your whole class schedule to everyone
 * in it, so it has to be the invitee's decision, not the inviter's.
 */
export async function getIncomingInvites(email: string): Promise<IncomingInvite[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: groupInvites.id,
      groupId: groupInvites.groupId,
      groupName: groups.name,
      invitedByName: users.name,
      invitedByEmail: users.email,
    })
    .from(groupInvites)
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .innerJoin(users, eq(users.id, groupInvites.invitedByUserId))
    .where(eq(groupInvites.email, email.toLowerCase()))
    .orderBy(desc(groupInvites.createdAt))
    .all();

  if (rows.length === 0) return [];

  const counts = await db
    .select({ groupId: groupMembers.groupId, total: count() })
    .from(groupMembers)
    .where(
      inArray(
        groupMembers.groupId,
        rows.map((r) => r.groupId),
      ),
    )
    .groupBy(groupMembers.groupId)
    .all();

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    invitedByName: row.invitedByName?.trim() || row.invitedByEmail.split("@")[0],
    invitedByEmail: row.invitedByEmail,
    memberCount: counts.find((c) => c.groupId === row.groupId)?.total ?? 0,
  }));
}

/* ------------------------------------------------------------------ *
 * Groups
 * ------------------------------------------------------------------ */

export async function getMyGroups(userId: string): Promise<GroupSummary[]> {
  const db = await getDb();

  const memberships = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(groups.name))
    .all();

  if (memberships.length === 0) return [];

  const groupIds = memberships.map((m) => m.groupId);

  // Counting in application code keeps this to a few flat reads rather than a
  // correlated subquery per group.
  const allMembers = await db
    .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds))
    .all();

  const allInvites = await db
    .select({ groupId: groupInvites.groupId })
    .from(groupInvites)
    .where(inArray(groupInvites.groupId, groupIds))
    .all();

  const memberUserIds = [...new Set(allMembers.map((m) => m.userId))];
  const withSchedule = new Set(
    memberUserIds.length > 0
      ? (
          await db
            .select({ userId: schedules.userId })
            .from(schedules)
            .where(inArray(schedules.userId, memberUserIds))
            .all()
        ).map((s) => s.userId)
      : [],
  );

  return memberships.map((membership) => {
    const members = allMembers.filter((m) => m.groupId === membership.groupId);
    return {
      id: membership.groupId,
      name: membership.name,
      role: membership.role,
      memberCount: members.length,
      pendingInviteCount: allInvites.filter((i) => i.groupId === membership.groupId).length,
      membersWithoutSchedule: members.filter((m) => !withSchedule.has(m.userId)).length,
    };
  });
}

/** Null when the group does not exist or the viewer is not a member of it. */
export async function getGroupDetail(
  userId: string,
  groupId: string,
): Promise<GroupDetail | null> {
  const db = await getDb();

  const membership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();
  if (!membership) return null;

  const group = await db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!group) return null;

  const memberRows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(users.email))
    .all();

  const memberIds = memberRows.map((m) => m.userId);
  const meetingRows =
    memberIds.length > 0
      ? await db
          .select()
          .from(meetings)
          .where(inArray(meetings.userId, memberIds))
          .orderBy(asc(meetings.weekday), asc(meetings.startMinute))
          .all()
      : [];

  const invites = await db
    .select({ id: groupInvites.id, email: groupInvites.email })
    .from(groupInvites)
    .where(eq(groupInvites.groupId, groupId))
    .orderBy(asc(groupInvites.email))
    .all();

  const members: GroupMemberView[] = memberRows.map((member) => {
    const blocks = meetingRows.filter((m) => m.userId === member.userId).map(rowToBlock);
    return {
      userId: member.userId,
      name: displayName(member.name, member.email),
      email: member.email,
      image: member.image,
      role: member.role,
      hasSchedule: blocks.length > 0,
      blocks,
    };
  });

  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    viewerRole: membership.role,
    members,
    pendingInvites: invites,
  };
}

/* ------------------------------------------------------------------ *
 * Friends -- people who share at least one group with the viewer
 * ------------------------------------------------------------------ */

/** Group ids the user is an accepted member of. */
async function myGroupIds(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all();
  return rows.map((r) => r.groupId);
}

export async function getFriends(userId: string): Promise<FriendSummary[]> {
  const db = await getDb();
  const groupIds = await myGroupIds(db, userId);
  if (groupIds.length === 0) return [];

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      groupName: groups.name,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(inArray(groupMembers.groupId, groupIds), ne(groupMembers.userId, userId)))
    .orderBy(asc(users.email))
    .all();

  if (rows.length === 0) return [];

  const friendIds = [...new Set(rows.map((r) => r.userId))];
  const loads = await db
    .select({
      userId: meetings.userId,
      meetingCount: count(),
      busyMinutes: sql<number>`sum(${meetings.endMinute} - ${meetings.startMinute})`,
    })
    .from(meetings)
    .where(inArray(meetings.userId, friendIds))
    .groupBy(meetings.userId)
    .all();

  const byId = new Map<string, FriendSummary>();
  for (const row of rows) {
    const existing = byId.get(row.userId);
    if (existing) {
      if (!existing.sharedGroups.includes(row.groupName)) {
        existing.sharedGroups.push(row.groupName);
      }
      continue;
    }
    const load = loads.find((l) => l.userId === row.userId);
    byId.set(row.userId, {
      userId: row.userId,
      name: displayName(row.name, row.email),
      email: row.email,
      image: row.image,
      sharedGroups: [row.groupName],
      hasSchedule: (load?.meetingCount ?? 0) > 0,
      meetingCount: load?.meetingCount ?? 0,
      busyMinutes: Number(load?.busyMinutes ?? 0),
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A friend's schedule, or null when the two share no group.
 *
 * The shared-group check is the authorization boundary for this page: sharing a
 * group is the only thing that entitles you to see someone's classes, and both
 * sides had to consent to that group.
 */
export async function getFriendSchedule(
  viewerId: string,
  friendId: string,
): Promise<FriendScheduleView | null> {
  if (viewerId === friendId) return null;

  const db = await getDb();
  const groupIds = await myGroupIds(db, viewerId);
  if (groupIds.length === 0) return null;

  const shared = await db
    .select({ name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, friendId), inArray(groupMembers.groupId, groupIds)))
    .orderBy(asc(groups.name))
    .all();
  if (shared.length === 0) return null;

  const friend = await db.select().from(users).where(eq(users.id, friendId)).get();
  if (!friend) return null;

  const schedule = await db.select().from(schedules).where(eq(schedules.userId, friendId)).get();
  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.userId, friendId))
    .orderBy(asc(meetings.weekday), asc(meetings.startMinute))
    .all();

  const blocks = rows.map(rowToBlock);

  return {
    friend: {
      userId: friend.id,
      name: displayName(friend.name, friend.email),
      email: friend.email,
      image: friend.image,
    },
    sharedGroups: shared.map((s) => s.name),
    schedule: schedule ? toSummary(schedule, blocks.length) : null,
    blocks,
  };
}

/** Adapts group members into the shape the availability engine expects. */
export function toMemberSchedules(members: GroupMemberView[]): MemberSchedule[] {
  return members.map((member) => ({
    memberId: member.userId,
    memberName: member.name,
    blocks: member.blocks,
  }));
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type MeetingRow = typeof meetings.$inferSelect;
type ScheduleRow = typeof schedules.$inferSelect;

function rowToBlock(row: MeetingRow): MeetingBlock {
  return {
    title: row.title,
    courseName: row.courseName,
    courseCode: row.courseCode,
    section: row.section,
    location: row.location,
    instructor: row.instructor,
    weekday: row.weekday as Weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    startDate: row.startDate,
    endDate: row.endDate,
    recurring: row.recurring,
    sourceKey: row.sourceKey,
  };
}

function toSummary(row: ScheduleRow, meetingCount: number): ScheduleSummary {
  return {
    fileName: row.fileName,
    importedAt: row.importedAt,
    termStart: row.termStart,
    termEnd: row.termEnd,
    courseCount: row.courseCount,
    warnings: parseWarnings(row.warnings),
    meetingCount,
  };
}

function displayName(name: string | null, email: string): string {
  return name?.trim() || email.split("@")[0];
}

function parseWarnings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}
