export type TimeUnit = "day" | "week" | "month" | "quarter" | "year";

const MS_PER_DAY = 86400000;

// Smallest gap in pixels between two lower tier ticks before the axis moves to a coarser unit.
const MIN_TICK_GAP = 36;

const APPROX_DAYS: Record<TimeUnit, number> = { day: 1, week: 7, month: 30.4, quarter: 91.3, year: 365.25 };

const ORDER: TimeUnit[] = ["day", "week", "month", "quarter", "year"];

export function chooseUnit(pixelsPerDay: number): TimeUnit {
    for (const unit of ORDER) {
        if (pixelsPerDay * APPROX_DAYS[unit] >= MIN_TICK_GAP) {
            return unit;
        }
    }
    return "year";
}

// The coarser unit shown above the main ticks, or null when the main unit is already years.
export function upperUnit(unit: TimeUnit): TimeUnit | null {
    if (unit === "day" || unit === "week") {
        return "month";
    }
    if (unit === "month" || unit === "quarter") {
        return "year";
    }
    return null;
}

// Start of the unit that contains the date, in local time. Weeks start on Monday, as in ISO 8601.
export function unitStart(date: Date, unit: TimeUnit): Date {
    const year = date.getFullYear();
    const month = date.getMonth();
    switch (unit) {
        case "day":
            return new Date(year, month, date.getDate());
        case "week": {
            const offset = (date.getDay() + 6) % 7;
            return new Date(year, month, date.getDate() - offset);
        }
        case "month":
            return new Date(year, month, 1);
        case "quarter":
            return new Date(year, month - (month % 3), 1);
        case "year":
            return new Date(year, 0, 1);
    }
}

export function addUnits(date: Date, unit: TimeUnit, count: number): Date {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    switch (unit) {
        case "day":
            return new Date(year, month, day + count);
        case "week":
            return new Date(year, month, day + count * 7);
        case "month":
            return new Date(year, month + count, 1);
        case "quarter":
            return new Date(year, month + count * 3, 1);
        case "year":
            return new Date(year + count, 0, 1);
    }
}

export interface Band {
    start: number;
    end: number;
}

// Consecutive unit bands that cover min to max, clipped to that range so labels can be centred on the visible part.
export function bands(min: number, max: number, unit: TimeUnit): Band[] {
    const result: Band[] = [];
    if (!(max > min)) {
        return result;
    }
    let cursor = unitStart(new Date(min), unit);
    // The guard stops a runaway loop if a huge range is paired with a fine unit.
    for (let guard = 0; cursor.getTime() < max && guard < 5000; guard++) {
        const next = addUnits(cursor, unit, 1);
        result.push({ start: Math.max(min, cursor.getTime()), end: Math.min(max, next.getTime()) });
        cursor = next;
    }
    return result;
}

export function daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}
