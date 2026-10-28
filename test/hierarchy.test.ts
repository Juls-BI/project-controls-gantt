import { test } from "node:test";
import assert from "node:assert/strict";
import { BLANK_LABEL, buildGroups, flatten } from "../src/hierarchy.ts";

const PATHS = [
    ["Design", "Civil"],
    ["Build", "Civil"],
    ["Design", "Electrical"],
    ["Design", "Civil"],
    ["", "Civil"]
];

test("groups keep first-appearance order and collect every row", () => {
    const groups = buildGroups(PATHS);
    assert.deepEqual(groups.map((node) => node.label), ["Design", "Build", BLANK_LABEL]);
    assert.deepEqual(groups[0].rows, [0, 2, 3]);
    assert.deepEqual(groups[0].children[0].direct, [0, 3]);
    assert.equal(groups[0].children[0].level, 2);
});

test("same label under different parents stays separate", () => {
    const groups = buildGroups(PATHS);
    assert.notEqual(groups[0].children[0].key, groups[1].children[0].key);
});

test("expanded tree lists groups then their tasks one level deeper", () => {
    const visible = flatten(buildGroups(PATHS), PATHS.length, new Set());
    const shape = visible.map((row) => (row.kind === "group" ? "g" + row.level + ":" + row.node.label : "t" + row.level + ":" + row.index));
    assert.deepEqual(shape.slice(0, 6), ["g1:Design", "g2:Civil", "t3:0", "t3:3", "g2:Electrical", "t3:2"]);
});

test("collapsing a group hides everything under it", () => {
    const groups = buildGroups(PATHS);
    const visible = flatten(groups, PATHS.length, new Set([groups[0].key]));
    assert.equal(visible[0].kind === "group" && visible[0].expanded, false);
    assert.equal(visible[1].kind === "group" && visible[1].node.label, "Build");
});

test("no groups lists every task at level 1", () => {
    const visible = flatten([], 3, new Set());
    assert.deepEqual(visible, [
        { kind: "task", index: 0, level: 1 },
        { kind: "task", index: 1, level: 1 },
        { kind: "task", index: 2, level: 1 }
    ]);
});
