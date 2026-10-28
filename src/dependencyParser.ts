export type IssueKind =
    | "emptyId"
    | "duplicateId"
    | "numericId"
    | "unknownReference"
    | "selfReference"
    | "duplicateReference"
    | "linkMismatch"
    | "openStart"
    | "openEnd"
    | "circular";

export type Severity = "error" | "warning" | "info";

export interface Issue {
    kind: IssueKind;
    severity: Severity;
    taskIndex: number;
    message: string;
    raw?: string;
}

export interface TaskInput {
    id: unknown;
    predecessors?: unknown;
    successors?: unknown;
}

export interface ParseOptions {
    delimiter: string;
    caseSensitive: boolean;
    hasPredecessors: boolean;
    hasSuccessors: boolean;
}

export type DeclaredBy = "predecessors" | "successors" | "both";

export interface Edge {
    from: number;
    to: number;
    type: "FS";
    lag: number;
    declaredBy: DeclaredBy;
}

export interface TaskKey {
    index: number;
    id: string;
    key: string;
}

export interface Network {
    tasks: TaskKey[];
    edges: Edge[];
    predecessorsOf: number[][];
    successorsOf: number[][];
    order: number[] | null;
    issues: Issue[];
}

export const DEFAULT_OPTIONS: ParseOptions = {
    delimiter: ",",
    caseSensitive: false,
    hasPredecessors: true,
    hasSuccessors: true
};

// Non-breaking spaces, zero-width characters and BOMs that Excel exports often leave inside cells.
const INVISIBLE = /[ ​-‍⁠﻿]/g;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanText(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

export function keyOf(id: string, caseSensitive: boolean): string {
    return caseSensitive ? id : id.toUpperCase();
}

// Splits on the chosen delimiter, plus semicolons and line breaks, which are common in exported cells. Always returns strings, never numbers.
export function splitIds(cell: unknown, delimiter: string): string[] {
    if (cell === null || cell === undefined) {
        return [];
    }
    const text = String(cell).replace(INVISIBLE, " ");
    const custom = delimiter && delimiter.length > 0 ? escapeRegExp(delimiter) : ",";
    const pattern = new RegExp("(?:" + custom + "|;|\\r\\n|\\n|\\r)+");
    return text
        .split(pattern)
        .map(cleanText)
        .filter((token) => token.length > 0);
}

export function buildNetwork(inputs: TaskInput[], options: ParseOptions = DEFAULT_OPTIONS): Network {
    const issues: Issue[] = [];

    const tasks: TaskKey[] = inputs.map((row, index) => {
        const id = cleanText(row.id);
        return { index, id, key: keyOf(id, options.caseSensitive) };
    });

    // One map from normalised ID to row index keeps every later lookup linear.
    const lookup = new Map<string, number>();
    for (const task of tasks) {
        if (task.id === "") {
            issues.push({ kind: "emptyId", severity: "error", taskIndex: task.index, message: "Task has no ID." });
            continue;
        }
        if (typeof inputs[task.index].id === "number") {
            issues.push({
                kind: "numericId",
                severity: "warning",
                taskIndex: task.index,
                message: "ID " + task.id + " arrived as a number. Convert the column to text in Power Query so leading zeros and letters are kept.",
                raw: task.id
            });
        }
        const existing = lookup.get(task.key);
        if (existing !== undefined) {
            issues.push({
                kind: "duplicateId",
                severity: "error",
                taskIndex: task.index,
                message: "Duplicate Task ID " + task.id + ". First used on row " + (existing + 1) + ".",
                raw: task.id
            });
            continue;
        }
        lookup.set(task.key, task.index);
    }

    const declared = new Map<string, Edge>();

    const resolve = (ownerIndex: number, cell: unknown, source: "predecessors" | "successors"): void => {
        const seen = new Set<string>();
        for (const token of splitIds(cell, options.delimiter)) {
            const key = keyOf(token, options.caseSensitive);
            if (seen.has(key)) {
                issues.push({
                    kind: "duplicateReference",
                    severity: "info",
                    taskIndex: ownerIndex,
                    message: token + " is listed more than once in " + source + " of " + tasks[ownerIndex].id + ".",
                    raw: token
                });
                continue;
            }
            seen.add(key);

            const other = lookup.get(key);
            if (other === undefined) {
                issues.push({
                    kind: "unknownReference",
                    severity: "warning",
                    taskIndex: ownerIndex,
                    message: "'" + token + "' in " + source + " of " + tasks[ownerIndex].id + " does not match any Task ID.",
                    raw: token
                });
                continue;
            }
            if (other === ownerIndex) {
                issues.push({
                    kind: "selfReference",
                    severity: "error",
                    taskIndex: ownerIndex,
                    message: tasks[ownerIndex].id + " lists itself in " + source + ".",
                    raw: token
                });
                continue;
            }

            const from = source === "predecessors" ? other : ownerIndex;
            const to = source === "predecessors" ? ownerIndex : other;
            const edgeKey = from + ">" + to;
            const existing = declared.get(edgeKey);
            if (existing === undefined) {
                declared.set(edgeKey, { from, to, type: "FS", lag: 0, declaredBy: source });
            } else if (existing.declaredBy !== source) {
                existing.declaredBy = "both";
            }
        }
    };

    inputs.forEach((row, index) => {
        if (options.hasPredecessors) {
            resolve(index, row.predecessors, "predecessors");
        }
        if (options.hasSuccessors) {
            resolve(index, row.successors, "successors");
        }
    });

    const edges = Array.from(declared.values());

    // When both columns are bound, every link should be declared from both sides.
    if (options.hasPredecessors && options.hasSuccessors) {
        for (const edge of edges) {
            if (edge.declaredBy === "both") {
                continue;
            }
            const fromId = tasks[edge.from].id;
            const toId = tasks[edge.to].id;
            if (edge.declaredBy === "predecessors") {
                issues.push({
                    kind: "linkMismatch",
                    severity: "warning",
                    taskIndex: edge.from,
                    message: toId + " lists " + fromId + " as a predecessor, but " + fromId + " does not list " + toId + " as a successor.",
                    raw: toId
                });
            } else {
                issues.push({
                    kind: "linkMismatch",
                    severity: "warning",
                    taskIndex: edge.to,
                    message: fromId + " lists " + toId + " as a successor, but " + toId + " does not list " + fromId + " as a predecessor.",
                    raw: fromId
                });
            }
        }
    }

    const count = tasks.length;
    const predecessorsOf: number[][] = Array.from({ length: count }, () => []);
    const successorsOf: number[][] = Array.from({ length: count }, () => []);
    for (const edge of edges) {
        successorsOf[edge.from].push(edge.to);
        predecessorsOf[edge.to].push(edge.from);
    }

    // Open ends are only meaningful once at least one link exists, otherwise every task would be flagged.
    if (edges.length > 0) {
        for (const task of tasks) {
            // Blank and duplicate rows already carry an error and can never hold links, so open end notes would only add noise.
            if (task.id === "" || lookup.get(task.key) !== task.index) {
                continue;
            }
            if (predecessorsOf[task.index].length === 0) {
                issues.push({ kind: "openStart", severity: "info", taskIndex: task.index, message: task.id + " has no predecessor." });
            }
            if (successorsOf[task.index].length === 0) {
                issues.push({ kind: "openEnd", severity: "info", taskIndex: task.index, message: task.id + " has no successor." });
            }
        }
    }

    // Kahn's algorithm gives a topological order for the later forward and backward pass, and exposes circular logic.
    const indegree = predecessorsOf.map((list) => list.length);
    const queue: number[] = [];
    indegree.forEach((degree, index) => {
        if (degree === 0) {
            queue.push(index);
        }
    });
    const order: number[] = [];
    const ordered: boolean[] = new Array<boolean>(count).fill(false);
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        order.push(current);
        ordered[current] = true;
        for (const next of successorsOf[current]) {
            indegree[next] -= 1;
            if (indegree[next] === 0) {
                queue.push(next);
            }
        }
    }

    const acyclic = order.length === count;
    if (!acyclic) {
        for (const task of tasks) {
            if (!ordered[task.index]) {
                issues.push({
                    kind: "circular",
                    severity: "error",
                    taskIndex: task.index,
                    message: task.id + " is part of, or depends on, circular logic."
                });
            }
        }
    }

    return { tasks, edges, predecessorsOf, successorsOf, order: acyclic ? order : null, issues };
}

export interface Trace {
    predecessors: Set<number>;
    successors: Set<number>;
}

// Walks upstream through predecessors and downstream through successors from one task. A visited set stops circular logic from looping, and fullChain false keeps only direct links.
export function traceLinks(network: Network, start: number, fullChain: boolean): Trace {
    const walk = (links: number[][]): Set<number> => {
        const found = new Set<number>();
        const queue = [...(links[start] || [])];
        while (queue.length > 0) {
            const next = queue.shift() as number;
            if (next === start || found.has(next)) {
                continue;
            }
            found.add(next);
            if (fullChain) {
                queue.push(...links[next]);
            }
        }
        return found;
    };
    return { predecessors: walk(network.predecessorsOf), successors: walk(network.successorsOf) };
}
