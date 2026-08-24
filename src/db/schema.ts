/**
 * D1 (SQLite) schema.
 *
 * The `user` / `account` / `session` / `verificationToken` tables match what
 * @auth/drizzle-adapter expects -- including its camelCase column names, which
 * is why they differ in style from the application tables below.
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ------------------------------------------------------------------ *
 * Auth.js tables
 * ------------------------------------------------------------------ */

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
    index("account_user_idx").on(account.userId),
  ],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

/* ------------------------------------------------------------------ *
 * Schedules
 * ------------------------------------------------------------------ */

/**
 * One row per user: their single source of truth. Re-importing replaces it,
 * so there is no notion of schedule history to reconcile.
 */
export const schedules = sqliteTable("schedule", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  importedAt: integer("imported_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  termStart: text("term_start"),
  termEnd: text("term_end"),
  courseCount: integer("course_count").notNull().default(0),
  /** JSON array of non-fatal parser warnings, surfaced after import. */
  warnings: text("warnings"),
});

/**
 * One row per (meeting, weekday). A `BYDAY=MO,WE` lecture becomes two rows,
 * which makes rendering the week grid a plain indexed read with no expansion
 * at request time.
 */
export const meetings = sqliteTable(
  "meeting",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    courseName: text("course_name").notNull(),
    courseCode: text("course_code"),
    section: text("section"),
    location: text("location"),
    instructor: text("instructor"),
    /** 0 = Sunday .. 6 = Saturday. */
    weekday: integer("weekday").notNull(),
    /** Wall-clock minutes from midnight; .ics course exports are floating. */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    recurring: integer("recurring", { mode: "boolean" }).notNull().default(true),
    sourceKey: text("source_key").notNull(),
  },
  (meeting) => [
    index("meeting_user_idx").on(meeting.userId),
    index("meeting_user_weekday_idx").on(meeting.userId, meeting.weekday),
  ],
);

/* ------------------------------------------------------------------ *
 * Groups
 * ------------------------------------------------------------------ */

export const groups = sqliteTable(
  "group",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (group) => [index("group_owner_idx").on(group.ownerId)],
);

export const groupMembers = sqliteTable(
  "group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (member) => [
    primaryKey({ columns: [member.groupId, member.userId] }),
    index("group_member_user_idx").on(member.userId),
  ],
);

/**
 * Invites to email addresses that have no account yet. On first sign-in these
 * are converted into real memberships, so inviting someone who has not joined
 * FreeTime still works -- they simply appear in the group once they arrive.
 */
export const groupInvites = sqliteTable(
  "group_invite",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Always stored lowercased, so lookups are case-insensitive. */
    email: text("email").notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (invite) => [
    uniqueIndex("group_invite_unique").on(invite.groupId, invite.email),
    index("group_invite_email_idx").on(invite.email),
  ],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many, one }) => ({
  schedule: one(schedules, { fields: [users.id], references: [schedules.userId] }),
  meetings: many(meetings),
  memberships: many(groupMembers),
}));

export const groupsRelations = relations(groups, ({ many, one }) => ({
  owner: one(users, { fields: [groups.ownerId], references: [users.id] }),
  members: many(groupMembers),
  invites: many(groupInvites),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  user: one(users, { fields: [meetings.userId], references: [users.id] }),
  schedule: one(schedules, { fields: [meetings.scheduleId], references: [schedules.id] }),
}));

export type User = typeof users.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type GroupInvite = typeof groupInvites.$inferSelect;
