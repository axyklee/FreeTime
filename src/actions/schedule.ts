"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { getDb } from "@/db";
import { meetings, schedules } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { IcsParseError, parseIcs } from "@/lib/ics";
import { fail, ok, type ActionState } from "@/lib/action-state";

/** Course schedules are a few KB; anything far past that is not one. */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * D1 rejects a statement with more than 100 bound parameters
 * ("too many SQL variables"), so multi-row inserts have to be chunked by
 * parameter count rather than by row count.
 */
const D1_MAX_BOUND_PARAMS = 100;
const MEETING_COLUMNS = 16;
const INSERT_CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / MEETING_COLUMNS);

export async function importSchedule(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose an .ics file to upload.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Course schedule exports are a few KB — this looks like the wrong file.`,
    );
  }

  const looksLikeIcs =
    file.name.toLowerCase().endsWith(".ics") ||
    file.type === "text/calendar" ||
    file.type === "application/octet-stream";
  if (!looksLikeIcs) {
    return fail(`"${file.name}" is not an .ics file. Export your schedule as iCalendar first.`);
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail("That file could not be read. Try exporting it again.");
  }

  let parsed;
  try {
    parsed = parseIcs(text);
  } catch (error) {
    if (error instanceof IcsParseError) return fail(error.message);
    console.error("ics parse failed", error);
    return fail("That file could not be parsed as a calendar.");
  }

  const db = await getDb();
  const scheduleId = crypto.randomUUID();

  // Replace wholesale: the schedule is a single source of truth, not a log.
  const statements: BatchItem<"sqlite">[] = [
    db.delete(meetings).where(eq(meetings.userId, user.id)),
    db.delete(schedules).where(eq(schedules.userId, user.id)),
    db.insert(schedules).values({
      id: scheduleId,
      userId: user.id,
      fileName: file.name || "schedule.ics",
      importedAt: new Date(),
      termStart: parsed.termStart,
      termEnd: parsed.termEnd,
      courseCount: parsed.courseCount,
      warnings: parsed.warnings.length > 0 ? JSON.stringify(parsed.warnings) : null,
    }),
  ];

  for (let i = 0; i < parsed.blocks.length; i += INSERT_CHUNK) {
    const chunk = parsed.blocks.slice(i, i + INSERT_CHUNK);
    statements.push(
      db.insert(meetings).values(
        chunk.map((block) => ({
          userId: user.id,
          scheduleId,
          title: block.title,
          courseName: block.courseName,
          courseCode: block.courseCode,
          section: block.section,
          location: block.location,
          instructor: block.instructor,
          weekday: block.weekday,
          startMinute: block.startMinute,
          endMinute: block.endMinute,
          startDate: block.startDate,
          endDate: block.endDate,
          recurring: block.recurring,
          sourceKey: block.sourceKey,
        })),
      ),
    );
  }

  try {
    // D1 runs a batch as a single transaction, so a failure part-way through
    // cannot leave the user with half a schedule.
    await db.batch(toBatch(statements));
  } catch (error) {
    console.error("schedule import failed", error);
    return fail("Saving your schedule failed. Nothing was changed — please try again.");
  }

  revalidatePath("/schedule");
  revalidatePath("/groups");
  revalidatePath("/friends");
  revalidatePath("/", "layout");

  // Onboarding passes a destination so a first import lands the user in the app
  // instead of leaving them on a page that just says "done".
  const destination = safeInternalPath(formData.get("redirectTo"));
  if (destination) redirect(destination);

  const courses = `${parsed.courseCount} course${parsed.courseCount === 1 ? "" : "s"}`;
  const blocks = `${parsed.blocks.length} weekly meeting${parsed.blocks.length === 1 ? "" : "s"}`;
  return ok(`Imported ${courses} — ${blocks}.`, parsed.warnings);
}

/**
 * Accepts only same-origin absolute paths.
 *
 * The value reaches the server as a form field, so it is caller-supplied.
 * Rejecting anything that is not a bare `/path` keeps it from being turned into
 * an open redirect (`//evil.com` is protocol-relative, not a local path).
 */
function safeInternalPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

export async function deleteSchedule(): Promise<void> {
  const user = await requireUser();
  const db = await getDb();

  await db.batch([
    db.delete(meetings).where(eq(meetings.userId, user.id)),
    db.delete(schedules).where(eq(schedules.userId, user.id)),
  ]);

  revalidatePath("/schedule");
  revalidatePath("/groups");
  revalidatePath("/", "layout");
}

/** Drizzle's `batch` takes a non-empty tuple; this narrows the array to one. */
function toBatch(
  statements: BatchItem<"sqlite">[],
): [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
  return statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
}
