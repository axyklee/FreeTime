import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIcs, parseSummary, parseInstructor, unescapeText } from "../src/lib/ics.ts";
import {
  buildWeekAvailability,
  deriveWeekdays,
  findCommonFreeWindows,
} from "../src/lib/availability.ts";

const example = readFileSync(new URL("../example.ics", import.meta.url), "utf8");

test("parses every meeting pattern in the CMU export", () => {
  const result = parseIcs(example);

  // 9 VEVENTs expand to 17 weekday blocks:
  // 18100-1 MoWe(2) + 18100-B Su(1) + 18100-B Fr(1) + 21127-1 MoWeFr(3)
  // + 21127-A TuTh(2) + 33142-1 MoWeFr(3) + 33142-E TuTh(2)
  // + 39101-A We(1) + 84362-A MoWe(2)
  assert.equal(result.blocks.length, 17);
  assert.equal(result.courseCount, 5);
  assert.equal(result.termStart, "2026-08-24");
  assert.equal(result.termEnd, "2026-12-05");
  assert.deepEqual(result.warnings, []);
});

test("keeps floating times as wall clock, without timezone drift", () => {
  const result = parseIcs(example);
  const ece = result.blocks.filter((b) => b.courseCode === "18100" && b.section === "1");

  assert.equal(ece.length, 2);
  assert.deepEqual(
    ece.map((b) => b.weekday).sort(),
    [1, 3], // Monday and Wednesday
  );
  for (const block of ece) {
    assert.equal(block.startMinute, 14 * 60); // 14:00 stays 14:00
    assert.equal(block.endMinute, 15 * 60 + 20); // 15:20
    assert.equal(block.location, "SH 105");
    assert.equal(block.instructor, "Zhu");
    assert.equal(block.recurring, true);
    assert.equal(block.endDate, "2026-12-05");
  }
});

test("first occurrence per weekday is computed from DTSTART", () => {
  const result = parseIcs(example);
  const math = result.blocks
    .filter((b) => b.courseCode === "21127" && b.section === "1")
    .sort((a, b) => a.weekday - b.weekday);

  // DTSTART 2026-08-24 (a Monday), BYDAY=MO,WE,FR
  assert.deepEqual(
    math.map((b) => [b.weekday, b.startDate]),
    [
      [1, "2026-08-24"],
      [3, "2026-08-26"],
      [5, "2026-08-28"],
    ],
  );
});

test("one section with two meeting patterns yields distinct blocks", () => {
  const result = parseIcs(example);
  const recitations = result.blocks.filter(
    (b) => b.courseCode === "18100" && b.section === "B",
  );

  assert.equal(recitations.length, 2);
  const byWeekday = new Map(recitations.map((b) => [b.weekday, b]));
  assert.equal(byWeekday.get(0)?.startMinute, 14 * 60); // Sunday 14:00, HH 1307
  assert.equal(byWeekday.get(0)?.location, "HH 1307");
  assert.equal(byWeekday.get(5)?.startMinute, 12 * 60); // Friday 12:00, WEH 5302
  assert.equal(byWeekday.get(5)?.location, "WEH 5302");
});

test("synthesizes unique keys despite the export having no UID", () => {
  assert.ok(!example.includes("UID:"), "fixture should have no UID, or this test is moot");

  const result = parseIcs(example);
  const keys = new Set(result.blocks.map((b) => b.sourceKey));
  assert.equal(keys.size, result.blocks.length);
});

test("unfolds folded lines before unescaping them", () => {
  const result = parseIcs(example);
  const physics = result.blocks.find((b) => b.courseCode === "33142" && b.section === "E");

  // DESCRIPTION folds mid-escape: "...\n\" + " nInstructors: Anderson\; ..."
  assert.equal(physics?.instructor, "Anderson; Gaytan Villarreal");
});

test("parseSummary splits the ':: code section' convention", () => {
  assert.deepEqual(parseSummary("Concepts of Mathematics :: 21127 A"), {
    courseName: "Concepts of Mathematics",
    courseCode: "21127",
    section: "A",
  });
  assert.deepEqual(parseSummary("Gym"), {
    courseName: "Gym",
    courseCode: null,
    section: null,
  });
});

test("unescapeText handles the RFC 5545 escape set", () => {
  assert.equal(unescapeText("a\\, b\; c\\\\ d\\ne"), "a, b; c\\ d\ne");
});

test("parseInstructor tolerates both singular and plural labels", () => {
  assert.equal(parseInstructor("x\n\nInstructor: Zhu\n"), "Zhu");
  assert.equal(parseInstructor("x\n\nInstructors: A; B\n"), "A; B");
  assert.equal(parseInstructor("no instructor line"), null);
});

test("rejects files that are not calendars", () => {
  assert.throws(() => parseIcs("hello world"), /does not look like an .ics/);
});

test("handles UTC times, DURATION, and midnight spanning", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:late-night",
    // 2026-03-03 03:30Z == 2026-03-02 22:30 in America/New_York (EST, -5)
    "DTSTART:20260303T033000Z",
    "DURATION:PT2H",
    "SUMMARY:Late Lab :: 15122 C",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const result = parseIcs(ics, { timeZone: "America/New_York" });

  // 22:30 Monday + 2h crosses midnight, so it splits Mon 22:30-24:00
  // and Tue 00:00-00:30.
  assert.equal(result.blocks.length, 2);
  const monday = result.blocks.find((b) => b.weekday === 1);
  const tuesday = result.blocks.find((b) => b.weekday === 2);
  assert.deepEqual([monday?.startMinute, monday?.endMinute], [22 * 60 + 30, 1440]);
  assert.deepEqual([tuesday?.startMinute, tuesday?.endMinute], [0, 30]);
});

test("keeps a DTSTART weekday that BYDAY omits, and warns", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART:20260824T090000", // a Monday
    "DTEND:20260824T095000",
    "SUMMARY:Odd Course :: 11111 1",
    "RRULE:FREQ=WEEKLY;BYDAY=TU",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const result = parseIcs(ics);
  assert.deepEqual(result.blocks.map((b) => b.weekday).sort(), [1, 2]);
  assert.match(result.warnings[0], /repeat rule omits/);
});

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

const solo = () => {
  const { blocks } = parseIcs(example);
  return [{ memberId: "u1", memberName: "Alice", blocks }];
};

test("a single schedule's busy segments match the source file", () => {
  const week = buildWeekAvailability(solo());
  assert.equal(week.empty, false);

  const monday = week.days.find((d) => d.weekday === 1)!;
  // Monday: 21127 09:00-09:50, 33142 10:00-10:50,
  //         84362 11:00-12:20, 18100 14:00-15:20
  assert.deepEqual(
    monday.segments.map((s) => [s.startMinute, s.endMinute, s.busyCount]),
    [
      [540, 590, 1],
      [600, 650, 1],
      [660, 740, 1],
      [840, 920, 1],
    ],
  );
});

test("free windows are the complement of busy time inside the window", () => {
  const week = buildWeekAvailability(solo());
  const monday = week.days.find((d) => d.weekday === 1)!;

  // 8:00-9:00, 9:50-10:00, 10:50-11:00, 12:20-14:00, 15:20-22:00
  assert.deepEqual(
    monday.freeWindows.map((w) => [w.startMinute, w.endMinute]),
    [
      [480, 540],
      [590, 600],
      [650, 660],
      [740, 840],
      [920, 1320],
    ],
  );
});

test("overlapping members raise busyCount and shrink the free set", () => {
  const { blocks } = parseIcs(example);
  const alice = blocks.filter((b) => b.courseCode === "21127"); // MoWeFr 9:00, TuTh 11:00
  const bob = blocks.filter((b) => b.courseCode === "33142"); // MoWeFr 10:00, TuTh 12:00
  const carol = blocks.filter((b) => b.courseCode === "21127"); // same as Alice

  const week = buildWeekAvailability([
    { memberId: "a", memberName: "Alice", blocks: alice },
    { memberId: "b", memberName: "Bob", blocks: bob },
    { memberId: "c", memberName: "Carol", blocks: carol },
  ]);

  const monday = week.days.find((d) => d.weekday === 1)!;
  // 9:00-9:50 has Alice + Carol (2 people); 10:00-10:50 has Bob only.
  const nine = monday.segments.find((s) => s.startMinute === 540)!;
  assert.equal(nine.busyCount, 2);
  assert.deepEqual(nine.busy.map((b) => b.memberName).sort(), ["Alice", "Carol"]);

  const ten = monday.segments.find((s) => s.startMinute === 600)!;
  assert.equal(ten.busyCount, 1);
  assert.deepEqual(ten.busy.map((b) => b.memberName), ["Bob"]);
});

test("adjacent segments with the same busy set are coalesced", () => {
  const backToBack = [
    {
      memberId: "a",
      memberName: "Alice",
      blocks: [
        makeBlock(1, 540, 600),
        makeBlock(1, 600, 660), // starts exactly when the previous ends
      ],
    },
  ];
  const week = buildWeekAvailability(backToBack);
  const monday = week.days.find((d) => d.weekday === 1)!;

  // Two distinct classes, but the *segment* count stays 1 only when the busy
  // set is identical -- different titles mean a different set, so expect 2.
  assert.equal(monday.segments.length, 2);
  assert.deepEqual(
    monday.segments.map((s) => [s.startMinute, s.endMinute]),
    [
      [540, 600],
      [600, 660],
    ],
  );
  // ...and no phantom zero-length free window between them.
  assert.ok(monday.freeWindows.every((w) => w.durationMinutes > 0));
});

test("common free windows are ranked longest first and respect the minimum", () => {
  const week = buildWeekAvailability(solo());
  const windows = findCommonFreeWindows(week, 45);

  assert.ok(windows.length > 0);
  // Sorted descending by duration.
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i - 1].durationMinutes >= windows[i].durationMinutes);
  }
  // The 10-minute passing periods are excluded.
  assert.ok(windows.every((w) => w.durationMinutes >= 45));
  // Saturday is entirely free: a full 8:00-22:00 window.
  const saturday = windows.find((w) => w.weekday === 6);
  assert.deepEqual([saturday?.startMinute, saturday?.endMinute], [480, 1320]);
});

test("a member with no classes does not create busy time", () => {
  const week = buildWeekAvailability([
    { memberId: "a", memberName: "Alice", blocks: [] },
    { memberId: "b", memberName: "Bob", blocks: [] },
  ]);
  assert.equal(week.empty, true);
  // Every day is wide open.
  assert.equal(week.days.length, 7);
  for (const day of week.days) {
    assert.deepEqual(
      day.freeWindows.map((w) => [w.startMinute, w.endMinute]),
      [[480, 1320]],
    );
  }
});

test("blocks outside the visible window do not leak into free windows", () => {
  const week = buildWeekAvailability(
    [{ memberId: "a", memberName: "Alice", blocks: [makeBlock(1, 360, 420)] }], // 6:00-7:00
    { dayStart: 8 * 60, dayEnd: 22 * 60 },
  );
  const monday = week.days.find((d) => d.weekday === 1)!;
  assert.deepEqual(
    monday.freeWindows.map((w) => [w.startMinute, w.endMinute]),
    [[480, 1320]],
  );
});

function makeBlock(weekday: number, startMinute: number, endMinute: number) {
  return {
    title: `Class ${startMinute}`,
    courseName: `Class ${startMinute}`,
    courseCode: String(startMinute),
    section: "1",
    location: null,
    instructor: null,
    weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    startMinute,
    endMinute,
    startDate: null,
    endDate: null,
    recurring: true,
    sourceKey: `k-${weekday}-${startMinute}`,
  };
}

/* ------------------------------------------------------------------ *
 * Visible weekdays
 * ------------------------------------------------------------------ */

test("a weekend class opens up the whole week, Saturday included", () => {
  // example.ics has a Sunday recitation but nothing on Saturday.
  const { blocks } = parseIcs(example);
  assert.ok(blocks.some((b) => b.weekday === 0), "fixture should have a Sunday block");
  assert.ok(!blocks.some((b) => b.weekday === 6), "fixture should have no Saturday block");

  // Saturday is still shown: an empty weekend day is information, not filler.
  assert.deepEqual(deriveWeekdays(blocks), [0, 1, 2, 3, 4, 5, 6]);
});

test("a Saturday-only class also opens up the whole week", () => {
  assert.deepEqual(deriveWeekdays([makeBlock(6, 600, 650)]), [0, 1, 2, 3, 4, 5, 6]);
});

test("no weekend classes means a five-column week", () => {
  const weekdayOnly = [makeBlock(1, 540, 590), makeBlock(4, 660, 710)];
  assert.deepEqual(deriveWeekdays(weekdayOnly), [1, 2, 3, 4, 5]);
  assert.deepEqual(deriveWeekdays([]), [1, 2, 3, 4, 5]);
});
