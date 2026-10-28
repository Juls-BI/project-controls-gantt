import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNetwork, traceLinks } from "../src/dependencyParser.ts";
import type { Issue, TaskInput } from "../src/dependencyParser.ts";

// The handoff test dataset, with a non-breaking space before the comma in B2 and blank cells left as null.
const HANDOFF: TaskInput[] = [
    { id: "A100", predecessors: null, successors: "007, B2" },
    { id: "007", predecessors: "A100", successors: "B2" },
    { id: "B2", predecessors: "007 , a100", successors: "M1" },
    { id: "M1", predecessors: "B2", successors: null },
    { id: "C1", predecessors: "C2", successors: "C2" },
    { id: "C2", predecessors: "C1", successors: "C1" },
    { id: "D5", predecessors: "ZZ9", successors: null },
    { id: "E7", predecessors: "A100", successors: null },
    { id: "A100", predecessors: null, successors: null },
    { id: null, predecessors: null, successors: null }
];

const OPTIONS = { delimiter: ",", caseSensitive: false, hasPredecessors: true, hasSuccessors: true };

function summary(issues: Issue[], severity: Issue["severity"]): string[] {
    return issues
        .filter((issue) => issue.severity === severity)
        .map((issue) => issue.kind + ":" + issue.taskIndex)
        .sort();
}

test("handoff dataset gives the expected errors", () => {
    const network = buildNetwork(HANDOFF, OPTIONS);
    assert.deepEqual(summary(network.issues, "error"), ["circular:4", "circular:5", "duplicateId:8", "emptyId:9"]);
    assert.equal(network.order, null);
});

// The E7 mismatch is reported on A100, the row whose Successors cell is missing the link, since that is where it gets fixed.
test("handoff dataset gives the expected warnings", () => {
    const network = buildNetwork(HANDOFF, OPTIONS);
    assert.deepEqual(summary(network.issues, "warning"), ["linkMismatch:0", "unknownReference:6"]);
    const mismatch = network.issues.find((issue) => issue.kind === "linkMismatch");
    assert.match(mismatch ? mismatch.message : "", /E7 lists A100 as a predecessor/);
});

test("open ends are notes and skip blank and duplicate rows", () => {
    const network = buildNetwork(HANDOFF, OPTIONS);
    assert.deepEqual(summary(network.issues, "info"), ["openEnd:3", "openEnd:6", "openEnd:7", "openStart:0", "openStart:6"]);
});

test("leading zeros, lower case and non-breaking spaces resolve to the right task", () => {
    const network = buildNetwork(HANDOFF, OPTIONS);
    assert.equal(network.tasks[1].id, "007");
    assert.deepEqual([...network.predecessorsOf[2]].sort(), [0, 1]);
});

test("predecessors column alone still builds the network", () => {
    const network = buildNetwork(HANDOFF, { ...OPTIONS, hasSuccessors: false });
    assert.deepEqual([...network.predecessorsOf[2]].sort(), [0, 1]);
    assert.equal(network.issues.some((issue) => issue.kind === "linkMismatch"), false);
});

test("an acyclic network returns a topological order", () => {
    const network = buildNetwork(HANDOFF.slice(0, 4), OPTIONS);
    assert.deepEqual(network.order, [0, 1, 2, 3]);
});

const CHAIN: TaskInput[] = [
    { id: "A", successors: "B" },
    { id: "B", successors: "C, D" },
    { id: "C", successors: "E" },
    { id: "D" },
    { id: "E" },
    { id: "X", successors: "Y" },
    { id: "Y", successors: "X" }
];
const CHAIN_OPTIONS = { delimiter: ",", caseSensitive: false, hasPredecessors: false, hasSuccessors: true };

test("full chain trace walks every predecessor and successor", () => {
    const trace = traceLinks(buildNetwork(CHAIN, CHAIN_OPTIONS), 2, true);
    assert.deepEqual([...trace.predecessors].sort(), [0, 1]);
    assert.deepEqual([...trace.successors].sort(), [4]);
});

test("direct trace keeps only immediate links", () => {
    const trace = traceLinks(buildNetwork(CHAIN, CHAIN_OPTIONS), 1, false);
    assert.deepEqual([...trace.predecessors], [0]);
    assert.deepEqual([...trace.successors].sort(), [2, 3]);
});

test("circular logic does not loop and never lists the traced task", () => {
    const trace = traceLinks(buildNetwork(CHAIN, CHAIN_OPTIONS), 5, true);
    assert.deepEqual([...trace.predecessors], [6]);
    assert.deepEqual([...trace.successors], [6]);
});
