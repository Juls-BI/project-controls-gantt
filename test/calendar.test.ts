import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHolidays, workdaysBetween } from "../src/calendar.ts";
import type { WorkCalendar } from "../src/calendar.ts";

// Saturday and Sunday off, as in most schedules.
const WEEKDAYS: WorkCalendar = { nonWorking: [true, false, false, false, false, false, true], holidays: new Set() };

test("Friday to the next Monday is one working day", () => {
    assert.equal(workdaysBetween(new Date(2026, 9, 16), new Date(2026, 9, 19), WEEKDAYS), 1);
});

test("a later baseline gives a negative count", () => {
    assert.equal(workdaysBetween(new Date(2026, 9, 19), new Date(2026, 9, 16), WEEKDAYS), -1);
});

test("same day is zero", () => {
    assert.equal(workdaysBetween(new Date(2026, 9, 16, 9), new Date(2026, 9, 16, 17), WEEKDAYS), 0);
});

test("whole weeks and remainders add up", () => {
    // Monday 5 Oct to Monday 26 Oct 2026 spans three weeks: 15 working days.
    assert.equal(workdaysBetween(new Date(2026, 9, 5), new Date(2026, 9, 26), WEEKDAYS), 15);
    // Monday to Wednesday of the same week.
    assert.equal(workdaysBetween(new Date(2026, 9, 5), new Date(2026, 9, 7), WEEKDAYS), 2);
});

test("holidays on working days are skipped, holidays at weekends are not counted twice", () => {
    const calendar: WorkCalendar = { nonWorking: WEEKDAYS.nonWorking, holidays: parseHolidays("2026-12-25, 2026-12-26; 2026-12-28") };
    // Thursday 24 Dec to Thursday 31 Dec 2026: 25th (Fri) and 28th (Mon) are holidays, 26th is a Saturday anyway.
    assert.equal(workdaysBetween(new Date(2026, 11, 24), new Date(2026, 11, 31), calendar), 3);
});

test("a six-day week only skips Sunday", () => {
    const calendar: WorkCalendar = { nonWorking: [true, false, false, false, false, false, false], holidays: new Set() };
    assert.equal(workdaysBetween(new Date(2026, 9, 16), new Date(2026, 9, 19), calendar), 2);
});

test("holiday text accepts ISO dates and ignores rubbish", () => {
    assert.deepEqual([...parseHolidays("2026-01-01\n2026-4-3; not a date")].sort(), ["2026-01-01", "2026-04-03"]);
});
