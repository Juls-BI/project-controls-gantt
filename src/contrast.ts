export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export interface Pick {
    colour: string;
    ratio: number;
    passed: boolean;
}

export function parseColour(value: string): Rgb | null {
    const text = value.trim().toLowerCase();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
    if (short) {
        return {
            r: parseInt(short[1] + short[1], 16),
            g: parseInt(short[2] + short[2], 16),
            b: parseInt(short[3] + short[3], 16)
        };
    }
    const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/.exec(text);
    if (long) {
        return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) };
    }
    const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text);
    if (fn) {
        return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]) };
    }
    return null;
}

function channel(value: number): number {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(colour: Rgb): number {
    return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

// WCAG 2.x contrast ratio between two colours, or null when either colour cannot be parsed.
export function contrastRatio(a: string, b: string): number | null {
    const first = parseColour(a);
    const second = parseColour(b);
    if (!first || !second) {
        return null;
    }
    const la = relativeLuminance(first);
    const lb = relativeLuminance(second);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

// Blends two colours and returns a hex string. weightOfA is between 0 and 1.
export function mixColours(a: string, b: string, weightOfA: number): string | null {
    const first = parseColour(a);
    const second = parseColour(b);
    if (!first || !second) {
        return null;
    }
    const mix = (x: number, y: number): string => {
        const value = Math.round(x * weightOfA + y * (1 - weightOfA));
        return (value < 16 ? "0" : "") + value.toString(16);
    };
    return "#" + mix(first.r, second.r) + mix(first.g, second.g) + mix(first.b, second.b);
}

// Returns the first candidate that reaches the minimum ratio against the background, otherwise the best attempt with passed set to false.
export function pickAccessible(candidates: string[], against: string, minimum: number): Pick | null {
    let best: Pick | null = null;
    for (const candidate of candidates) {
        const ratio = contrastRatio(candidate, against);
        if (ratio === null) {
            continue;
        }
        if (ratio >= minimum) {
            return { colour: candidate, ratio, passed: true };
        }
        if (best === null || ratio > best.ratio) {
            best = { colour: candidate, ratio, passed: false };
        }
    }
    return best;
}
