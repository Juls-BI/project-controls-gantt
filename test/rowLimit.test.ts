import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_LIMIT, rowLimitWarning } from "../src/rowLimit.ts";

test("row limit matches the data reduction window in capabilities.json", () => {
    const capabilities = JSON.parse(readFileSync(new URL("../capabilities.json", import.meta.url), "utf8"));
    assert.equal(capabilities.dataViewMappings[0].table.rows.dataReductionAlgorithm.window.count, ROW_LIMIT);
});

test("no warning below the limit", () => {
    assert.equal(rowLimitWarning(ROW_LIMIT - 1, false), null);
});

test("warns when the limit is reached or Power BI holds back rows", () => {
    assert.match(rowLimitWarning(ROW_LIMIT, false) ?? "", /first 30,000 rows/);
    assert.notEqual(rowLimitWarning(10, true), null);
});
