const MS_PER_DAY = 86400000;

export interface WorkCalendar {
    // Indexed like Date.getDay(): 0 is Sunday, 6 is Saturday.
    nonWorking: boolean[];
    holidays: Set<string>;
}

export function dayKey(date: Date): string {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function midnight(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isWorkday(date: Date, calendar: WorkCalendar): boolean {
    return !calendar.nonWorking[date.getDay()] && !calendar.holidays.has(dayKey(date));
}

// Signed count of working days after one date up to and including the other, so a finish moved from Friday to the next Monday is 1 working day late.
export function workdaysBetween(from: Date, to: Date, calendar: WorkCalendar): number {
    const start = midnight(from);
    const end = midnight(to);
    if (end.getTime() === start.getTime()) {
        return 0;
    }
    if (end < start) {
        return -workdaysBetween(end, start, calendar);
    }
    const workPerWeek = calendar.nonWorking.filter((off) => !off).length;
    const totalDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
    // Whole weeks are counted at once, then the remaining days one by one, so long spans stay fast.
    const weeks = Math.floor(totalDays / 7);
    let count = weeks * workPerWeek;
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7);
    for (let i = weeks * 7; i < totalDays; i++) {
        cursor.setDate(cursor.getDate() + 1);
        if (!calendar.nonWorking[cursor.getDay()]) {
            count++;
        }
    }
    // Holidays inside the span only count when they fall on a day that would otherwise be worked.
    calendar.holidays.forEach((key) => {
        const parts = key.split("-").map(Number);
        const holiday = new Date(parts[0], parts[1] - 1, parts[2]);
        if (holiday > start && holiday <= end && !calendar.nonWorking[holiday.getDay()]) {
            count--;
        }
    });
    return count;
}

// Reads dates from text separated by commas, semicolons or line breaks. ISO dates (2026-12-25) are read exactly; anything else falls back to the browser's date parser.
export function parseHolidays(text: string): Set<string> {
    const result = new Set<string>();
    text.split(/[,;\r\n]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .forEach((part) => {
            const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(part);
            const date = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(part);
            if (!isNaN(date.getTime())) {
                result.add(dayKey(date));
            }
        });
    return result;
}
