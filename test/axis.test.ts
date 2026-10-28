import { test } from "node:test";
import assert from "node:assert/strict";
import { addUnits, bands, chooseUnit, unitStart, upperUnit } from "../src/axis.ts";

test("the unit gets coarser as pixels per day fall", () => {
    assert.equal(chooseUnit(40), "day");
    assert.equal(chooseUnit(6), "week");
    assert.equal(chooseUnit(1.5), "month");
    assert.equal(chooseUnit(0.5), "quarter");
    assert.equal(chooseUnit(0.05), "year");
});

test("upper tier pairs with the main unit", () => {
    assert.equal(upperUnit("week"), "month");
    assert.equal(upperUnit("quarter"), "year");
    assert.equal(upperUnit("year"), null);
});

test("weeks start on Monday and quarters on the first month", () => {
    assert.equal(unitStart(new Date(2024, 3, 14), "week").getDate(), 8);
    assert.equal(unitStart(new Date(2024, 4, 20), "quarter").getMonth(), 3);
});

test("adding months from the first of a month never skips a month", () => {
    assert.equal(addUnits(new Date(2024, 0, 1), "month", 1).getMonth(), 1);
});

test("month bands cover the range and are clipped at both ends", () => {
    const min = new Date(2024, 0, 15).getTime();
    const max = new Date(2024, 3, 10).getTime();
    const result = bands(min, max, "month");
    assert.equal(result.length, 4);
    assert.equal(result[0].start, min);
    assert.equal(result[1].start, new Date(2024, 1, 1).getTime());
    assert.equal(result[3].end, max);
});
