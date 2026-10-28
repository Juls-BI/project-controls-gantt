export interface GroupNode {
    key: string;
    label: string;
    level: number;
    children: GroupNode[];
    // Every data row inside this group at any depth, used for roll-ups.
    rows: number[];
    // Data rows that sit directly under this group, only filled on the deepest level.
    direct: number[];
}

export type VisibleRow =
    | { kind: "group"; node: GroupNode; level: number; expanded: boolean }
    | { kind: "task"; index: number; level: number };

export const BLANK_LABEL = "(Blank)";

// The unit separator cannot appear in typed text, so joined paths never collide.
const SEPARATOR = "\u001F";

// Builds the group tree in first-appearance order from one path of labels per data row. Every path must have the same length.
export function buildGroups(paths: string[][]): GroupNode[] {
    const top: GroupNode[] = [];
    const byKey = new Map<string, GroupNode>();
    paths.forEach((path, rowIndex) => {
        let siblings = top;
        let key = "";
        path.forEach((raw, depth) => {
            const label = raw === "" ? BLANK_LABEL : raw;
            key = depth === 0 ? label : key + SEPARATOR + label;
            let node = byKey.get(key);
            if (!node) {
                node = { key, label, level: depth + 1, children: [], rows: [], direct: [] };
                byKey.set(key, node);
                siblings.push(node);
            }
            node.rows.push(rowIndex);
            if (depth === path.length - 1) {
                node.direct.push(rowIndex);
            }
            siblings = node.children;
        });
    });
    return top;
}

// Lists the rows a reader can currently see. Without groups every task is shown at level 1.
export function flatten(groups: GroupNode[], rowCount: number, collapsed: Set<string>): VisibleRow[] {
    const result: VisibleRow[] = [];
    if (groups.length === 0) {
        for (let index = 0; index < rowCount; index++) {
            result.push({ kind: "task", index, level: 1 });
        }
        return result;
    }
    const walk = (nodes: GroupNode[]): void => {
        for (const node of nodes) {
            const expanded = !collapsed.has(node.key);
            result.push({ kind: "group", node, level: node.level, expanded });
            if (!expanded) {
                continue;
            }
            walk(node.children);
            node.direct.forEach((index) => result.push({ kind: "task", index, level: node.level + 1 }));
        }
    };
    walk(groups);
    return result;
}
