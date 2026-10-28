"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "../style/visual.less";
import { bands, chooseUnit, daysBetween, TimeUnit, upperUnit } from "./axis";
import { parseHolidays, WorkCalendar, workdaysBetween } from "./calendar";
import { contrastRatio, mixColours, pickAccessible } from "./contrast";
import { buildNetwork, Network, Severity, traceLinks } from "./dependencyParser";
import { buildGroups, flatten, GroupNode, VisibleRow } from "./hierarchy";
import { COPYRIGHT, CREATED_BY, DEFAULT_FONT, DEFAULT_TEXT_SIZE, GanttSettings, VISUAL_VERSION } from "./settings";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import DataViewTable = powerbi.DataViewTable;
import DataViewTableRow = powerbi.DataViewTableRow;
import PrimitiveValue = powerbi.PrimitiveValue;
import FormattingModel = powerbi.visuals.FormattingModel;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

type Value = PrimitiveValue | null;

const SVG_NS = "http://www.w3.org/2000/svg";
const MS_PER_DAY = 86400000;
// Default palette. The planned bar is navy and the completed part fills in blue, 3.7:1 apart, so progress still reads in greyscale. The second value in each list is the dark theme alternative.
const PLANNED_CANDIDATES = ["#12239E", "#A9B8FF"];
const PROGRESS_CANDIDATES = ["#118DFF", "#4DA3FF"];
const BASELINE_CANDIDATES = ["#8A8886", "#A19F9D"];
const CRITICAL_CANDIDATES = ["#C4314B", "#FF6B81"];
const CUTOFF_CANDIDATES = ["#B4009E", "#FF8DE6"];
const GOOD_CANDIDATES = ["#107C10", "#54B054"];
const WARNING_CANDIDATES = ["#8A5300", "#F2C14E"];
const BAD_CANDIDATES = ["#C4314B", "#FF6B81"];
const MILESTONE_CANDIDATES = ["#A0522D", "#E3A27A"];

interface TaskRow {
    id: Value;
    name: string;
    groups: string[];
    extras: Value[];
    tips: Value[];
    itemType: string;
    baselineStart: Date | null;
    baselineFinish: Date | null;
    plannedStart: Date | null;
    plannedFinish: Date | null;
    percent: number | null;
    predecessors: Value;
    successors: Value;
    float: number | null;
    milestoneDate: Date | null;
}

interface Theme {
    background: string;
    foreground: string;
    headerForeground: string;
    headerBackground: string;
    band: string | null;
    line: string;
    forecast: string;
    remaining: string;
    baseline: string;
    progress: string;
    critical: string;
    grid: string | null;
    cutoff: string;
    cutoffWidth: number;
    good: string;
    warning: string;
    bad: string;
    fontFamily: string;
    fontSize: number;
    groupBackgrounds: string[];
    radius: number;
    milestone: string;
    milestoneSize: number;
    legendSize: number;
    legendFont: string;
    menuFont: string;
    menuSize: number;
    menuColor: string;
    axisFont: string;
    legendColor: string;
    axisSize: number;
    axisColor: string;
    axisBold: boolean;
    padding: number;
    cellPadding: number;
    indent: number;
    legendGap: number;
    barRatio: number;
    designNotes: string[];
}

interface Cutoff {
    time: number;
    label: string;
    fromMeasure: boolean;
}

interface Scale {
    min: number;
    max: number;
    width: number;
    unit: TimeUnit;
    cutoffX: number | null;
}

interface Column {
    header: string;
    text: (row: TaskRow) => string;
    decorate?: (cell: HTMLElement, row: TaskRow) => void;
}

type LegendKind = "milestone" | "baseline" | "forecast" | "remaining" | "progress" | "critical" | "cutoff" | "good" | "warning" | "bad";

type Status = "good" | "warning" | "bad";

function toDate(value: Value): Date | null {
    if (value === null || value === undefined || typeof value === "boolean") {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

function toNumber(value: Value): number | null {
    if (value === null || value === undefined || typeof value === "boolean" || value instanceof Date) {
        return null;
    }
    // Text such as 45% or 0.45 is accepted too, since exports and measures often return percentages as text.
    const number = typeof value === "number" ? value : Number(String(value).replace(/[%\s]/g, "").replace(",", "."));
    return isFinite(number) && String(value).trim() !== "" ? number : null;
}

function toText(value: Value): string {
    return value === null || value === undefined ? "" : String(value);
}

// Maps each data role to the table columns bound to it, in the order the fields sit in the field well.
function roleColumns(table: DataViewTable): Record<string, number[]> {
    const index: Record<string, number[]> = {};
    table.columns.forEach((column, position) => {
        const roles = column.roles || {};
        Object.keys(roles).forEach((role) => {
            if (roles[role]) {
                (index[role] = index[role] || []).push(position);
            }
        });
    });
    return index;
}

function earliest(dates: Array<Date | null>): Date | null {
    let best: Date | null = null;
    dates.forEach((date) => {
        if (date && (!best || date.getTime() < best.getTime())) {
            best = date;
        }
    });
    return best;
}

function latest(dates: Array<Date | null>): Date | null {
    let best: Date | null = null;
    dates.forEach((date) => {
        if (date && (!best || date.getTime() > best.getTime())) {
            best = date;
        }
    });
    return best;
}

// A group row is a roll-up: earliest starts, latest finishes, duration-weighted progress and the lowest float.
function summarise(node: GroupNode, rows: TaskRow[]): TaskRow {
    const members = node.rows.map((index) => rows[index]);
    let weighted = 0;
    let weight = 0;
    members.forEach((row) => {
        if (row.percent === null) {
            return;
        }
        const span = row.plannedStart && row.plannedFinish ? Math.max(1, daysBetween(row.plannedStart, row.plannedFinish)) : 1;
        weighted += row.percent * span;
        weight += span;
    });
    const floats = members.map((row) => row.float).filter((value): value is number => value !== null);
    return {
        id: node.label,
        name: members.length === 1 ? "1 task" : members.length + " tasks",
        groups: [],
        extras: [],
        tips: [],
        itemType: "",
        baselineStart: earliest(members.map((row) => row.baselineStart)),
        baselineFinish: latest(members.map((row) => row.baselineFinish)),
        plannedStart: earliest(members.map((row) => row.plannedStart)),
        plannedFinish: latest(members.map((row) => row.plannedFinish)),
        percent: weight > 0 ? weighted / weight : null,
        predecessors: null,
        successors: null,
        float: floats.length > 0 ? Math.min(...floats) : null,
        milestoneDate: null
    };
}

export class Visual implements IVisual {
    private readonly host: IVisualHost;
    private readonly events: IVisualEventService;
    private readonly formatting: FormattingSettingsService;
    private settings: GanttSettings;
    private readonly root: HTMLElement;
    private readonly status: HTMLElement;
    private readonly body: HTMLElement;
    private lastOptions: VisualUpdateOptions | null = null;
    private lastAnnouncement = "";
    private visible: VisibleRow[] = [];
    private collapsed = new Set<string>();
    private focusKey = "";
    private isTree = false;
    private visibleMilestones = false;
    private tableView = false;
    private viewScale: "fit" | TimeUnit = "fit";
    private currentScale: Scale | null = null;
    private groupKeys: string[] = [];
    private rows: TaskRow[] = [];
    private groupNodes = new Map<string, GroupNode>();
    private tipNames: string[] = [];
    private extraNames: string[] = [];
    private boundRoles = new Set<string>();
    private tooltipRow = -1;
    private pendingActionFocus = "";
    private cutoff: Cutoff | null = null;
    private workCalendar: WorkCalendar | null = null;
    private network: Network | null = null;
    private traceId: string | null = null;
    private trace: { index: number; predecessors: Set<number>; successors: Set<number> } | null = null;

    constructor(options?: VisualConstructorOptions) {
        // The plugin wrapper generated by pbiviz types options as optional, so strict mode needs this guard.
        if (!options) {
            throw new Error("Visual constructor options are required.");
        }
        this.host = options.host;
        this.events = options.host.eventService;
        this.formatting = new FormattingSettingsService();
        this.settings = new GanttSettings();
        const doc = options.element.ownerDocument;

        this.root = doc.createElement("div");
        this.root.className = "gantt";

        // The live region exists before any content changes so assistive technology reliably announces updates (WCAG 4.1.3).
        this.status = doc.createElement("div");
        this.status.className = "sr-only";
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        this.status.setAttribute("aria-atomic", "true");

        this.body = doc.createElement("div");
        this.body.className = "gantt-body";

        this.root.appendChild(this.status);
        this.root.appendChild(this.body);
        options.element.appendChild(this.root);

        this.body.addEventListener("keydown", (event) => this.onKeyDown(event));
        this.body.addEventListener("focusin", (event) => this.onFocusIn(event));
        this.body.addEventListener("click", (event) => this.onClick(event));
        this.body.addEventListener("mousemove", (event) => this.onPointerMove(event));
        this.body.addEventListener("mouseleave", () => this.hideTooltip());
        this.body.addEventListener("focusout", () => this.hideTooltip());
    }

    public update(options: VisualUpdateOptions): void {
        // Certified visuals must report render state so export to PowerPoint and PDF waits for the visual.
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews && options.dataViews[0];
            this.settings = dataView ? this.formatting.populateFormattingSettingsModel(GanttSettings, dataView) : new GanttSettings();
            // The About details are fixed by the build, never by a value saved in the report.
            this.settings.about.version.value = VISUAL_VERSION;
            this.settings.about.createdBy.value = CREATED_BY;
            this.settings.about.copyright.value = COPYRIGHT;
            this.lastOptions = options;
            this.render(options, true);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, error instanceof Error ? error.message : String(error));
        }
    }

    public getFormattingModel(): FormattingModel {
        return this.formatting.buildFormattingModel(this.settings);
    }

    private render(options: VisualUpdateOptions, scrollToCutoff: boolean): void {
        const doc = this.root.ownerDocument;
        const theme = this.buildTheme();
        this.applyTheme(theme);

        const hadFocus = this.body.contains(doc.activeElement);
        while (this.body.firstChild) {
            this.body.removeChild(this.body.firstChild);
        }

        const dataView = options.dataViews && options.dataViews[0];
        if (!dataView || !dataView.table || !dataView.table.columns || !dataView.table.rows) {
            this.showMessage("Add a text Task ID field to show the schedule.");
            return;
        }

        const table = dataView.table;
        const sourceRows = dataView.table.rows;
        const columnsByRole = roleColumns(table);
        const index: Record<string, number> = {};
        Object.keys(columnsByRole).forEach((role) => (index[role] = columnsByRole[role][0]));
        if (index["taskId"] === undefined) {
            this.showMessage("Add a text Task ID field to show the schedule.");
            return;
        }

        // A silent empty progress bar is confusing, so the logic checks say when Show progress has no field to read.
        if (this.settings.bars.showProgress.value && index["percentComplete"] === undefined) {
            theme.designNotes.push("Show progress is on, but no field is in Percent complete, so the bars show no progress. Add a column or measure there, or turn off Show progress under Bars.");
        }

        const extraColumns = columnsByRole["extraColumns"] || [];
        const tipColumns = columnsByRole["tooltipFields"] || [];
        const columnName = (position: number, fallback: string): string => {
            const column = table.columns[position];
            return column && column.displayName ? column.displayName : fallback;
        };
        this.extraNames = extraColumns.map((position, slot) => columnName(position, "Column " + (slot + 1)));
        this.tipNames = tipColumns.map((position, slot) => columnName(position, "Field " + (slot + 1)));
        this.boundRoles = new Set(Object.keys(columnsByRole));
        const rows = this.readRows(sourceRows, index, columnsByRole["group"] || [], extraColumns, tipColumns);
        this.rows = rows;
        if (rows.length === 0) {
            this.showMessage("No tasks to show.");
            return;
        }

        const s = this.settings;
        const delimiter = s.parsing.delimiter.value || ",";
        const network = buildNetwork(
            rows.map((row) => ({ id: row.id, predecessors: row.predecessors, successors: row.successors })),
            {
                delimiter,
                caseSensitive: s.parsing.caseSensitive.value,
                hasPredecessors: index["predecessors"] !== undefined,
                hasSuccessors: index["successors"] !== undefined
            }
        );

        this.visibleMilestones = rows.some((row) => row.milestoneDate !== null);
        const groups = buildGroups(rows.map((row) => row.groups));
        this.isTree = groups.length > 0;
        this.groupKeys = [];
        this.groupNodes = new Map<string, GroupNode>();
        const collect = (nodes: GroupNode[]): void => {
            nodes.forEach((node) => {
                this.groupKeys.push(node.key);
                this.groupNodes.set(node.key, node);
                collect(node.children);
            });
        };
        collect(groups);
        this.network = network;
        this.trace = null;
        const traceIndex = this.traceId !== null && s.trace.enabled.value ? network.tasks.findIndex((task) => task.id === this.traceId) : -1;
        if (traceIndex >= 0) {
            // While tracing, every group opens so no linked task is hidden, then only the traced task, its links and the groups that hold them stay.
            const linked = traceLinks(network, traceIndex, s.trace.depth.value.value === "full");
            this.trace = { index: traceIndex, predecessors: linked.predecessors, successors: linked.successors };
            const keep = (index: number): boolean => index === traceIndex || linked.predecessors.has(index) || linked.successors.has(index);
            this.visible = flatten(groups, rows.length, new Set<string>()).filter((item) => (item.kind === "group" ? item.node.rows.some(keep) : keep(item.index)));
        } else {
            this.traceId = null;
            this.visible = flatten(groups, rows.length, this.collapsed);
        }

        const cutoff = this.readCutoff(sourceRows, index);
        this.workCalendar = this.readCalendar(sourceRows, index);
        this.cutoff = cutoff;
        const hasDates = ["baselineStart", "baselineFinish", "plannedStart", "plannedFinish"].some(
            (role) => index[role] !== undefined
        );
        const timelineWidth = Math.max(240, Math.floor((options.viewport.width * s.timeline.widthPercent.value) / 100));
        // Table view is the same accessible grid with every field as a column and no timeline.
        const scale = hasDates && !this.tableView ? this.buildScale(rows, timelineWidth, cutoff) : null;
        this.currentScale = scale;

        // The grid is built first so the legend knows which marks were actually drawn.
        const scroll = this.el("div", "gantt-scroll");
        // Gap between the legend and logic check area above and the chart below, from the Layout settings.
        scroll.style.marginTop = s.layout.chartGap.value + "px";
        const grid = this.buildTable(rows, table, index, extraColumns, theme, scale, cutoff);
        scroll.appendChild(grid);

        if (s.toolbar.show.value) {
            this.body.appendChild(this.buildMenu(hasDates));
        }

        if (this.trace) {
            this.body.appendChild(this.buildTraceBar());
        }

        if (s.legend.show.value) {
            this.body.appendChild(this.buildLegend(index, scale, cutoff, theme));
        }

        if (s.display.showLogicChecks.value) {
            const checks = this.buildChecks(network, theme);
            this.body.appendChild(checks.element);
            this.announce(checks.summary);
        }

        this.body.appendChild(scroll);
        if (index["baselineFinish"] !== undefined && index["plannedFinish"] !== undefined) {
            this.body.appendChild(this.el("p", "gantt-footnote", this.dayBasisNote()));
        }

        // Keeps the focused row clear of the sticky header and the frozen first column (WCAG 2.4.11 Focus Not Obscured).
        const header = grid.querySelector("thead");
        if (header) {
            scroll.style.scrollPaddingTop = header.offsetHeight + "px";
        }
        const frozen = grid.querySelector<HTMLElement>("thead th");
        if (frozen) {
            scroll.style.scrollPaddingLeft = frozen.offsetWidth + "px";
        }

        // Brings the cut-off line into view when the timeline is wider than the visual, only on data or format updates so expanding a group does not jump.
        if (scrollToCutoff && s.timeline.scrollToCutoff.value) {
            this.scrollTimelineToCutoff();
        }

        const rowElements = this.rowElements();
        let active = rowElements.findIndex((row) => row.getAttribute("data-key") === this.focusKey);
        if (active < 0) {
            active = 0;
        }
        this.setRoving(active);
        const focusedAction = this.pendingActionFocus;
        this.pendingActionFocus = "";
        const actionButton = focusedAction ? this.body.querySelector<HTMLElement>('[data-action="' + focusedAction + '"]') : null;
        if (actionButton) {
            actionButton.focus();
        } else if (hadFocus && rowElements[active]) {
            rowElements[active].focus();
        }
    }

    private colourSetting(value: string, fallback: string, isHighContrast: boolean, highContrast: string): string {
        if (isHighContrast) {
            return highContrast;
        }
        return value && value.length > 0 ? value : fallback;
    }

    private buildTheme(): Theme {
        const palette = this.host.colorPalette;
        const hc = palette.isHighContrast;
        const background = palette.background.value;
        const themeForeground = palette.foreground.value;
        const s = this.settings;
        const notes: string[] = [];

        const auto = (candidates: string[], fallback: string): string => {
            const pick = pickAccessible(candidates, background, 3);
            return pick && pick.passed ? pick.colour : fallback;
        };
        const pick = (value: string, fallback: string): string => this.colourSetting(value, fallback, hc, themeForeground);

        const foreground = pick(s.text.textColor.value.value, themeForeground);
        const headerBackground = this.colourSetting(s.text.headerBackground.value.value, background, hc, background);
        const headerForeground = pick(s.text.headerColor.value.value, foreground);
        const forecast = pick(s.bars.forecastColor.value.value, auto(PLANNED_CANDIDATES, themeForeground));
        const remaining = this.colourSetting(s.bars.remainingColor.value.value, mixColours(forecast, background, 0.45) || forecast, hc, background);
        const line = pick(s.rows.gridlineColor.value.value, mixColours(foreground, background, 0.14) || foreground);
        const band = s.rows.bandedRows.value && !hc ? s.rows.bandColor.value.value || mixColours(foreground, background, 0.06) : null;
        const grid = s.timeline.showGridlines.value ? pick(s.timeline.gridColor.value.value, mixColours(foreground, background, 0.12) || line) : null;

        // Group rows get a tint from the forecast colour, strongest on the outer level, like the native Gantt.
        const groupBase = s.rows.groupBackground.value.value;
        const groupBackgrounds = hc
            ? [background]
            : groupBase
              ? [groupBase, mixColours(groupBase, background, 0.45) || groupBase]
              : [mixColours(forecast, background, 0.2) || background, mixColours(forecast, background, 0.08) || background];

        const theme: Theme = {
            background,
            foreground,
            headerForeground,
            headerBackground,
            band,
            line,
            forecast,
            remaining,
            baseline: pick(s.bars.baselineColor.value.value, auto(BASELINE_CANDIDATES, themeForeground)),
            progress: this.colourSetting(s.bars.progressColor.value.value, auto(PROGRESS_CANDIDATES, themeForeground), hc, background),
            critical: pick(s.bars.criticalColor.value.value, auto(CRITICAL_CANDIDATES, themeForeground)),
            grid,
            cutoff: pick(s.cutoff.lineColor.value.value, auto(CUTOFF_CANDIDATES, themeForeground)),
            cutoffWidth: s.cutoff.lineWidth.value,
            good: pick(s.variance.goodColor.value.value, auto(GOOD_CANDIDATES, themeForeground)),
            warning: pick(s.variance.warningColor.value.value, auto(WARNING_CANDIDATES, themeForeground)),
            bad: pick(s.variance.badColor.value.value, auto(BAD_CANDIDATES, themeForeground)),
            fontFamily: s.text.font.fontFamily.value || DEFAULT_FONT,
            fontSize: Math.max(6, Math.min(40, s.text.font.fontSize.value || DEFAULT_TEXT_SIZE)),
            groupBackgrounds,
            radius: s.bars.rounded.value ? 4 : 0,
            milestone: pick(s.milestones.color.value.value, auto(MILESTONE_CANDIDATES, themeForeground)),
            milestoneSize: s.milestones.size.value,
            legendSize: s.legend.textSize.value,
            legendFont: s.legend.fontFamily.value || DEFAULT_FONT,
            menuFont: s.toolbar.fontFamily.value || DEFAULT_FONT,
            menuSize: s.toolbar.textSize.value,
            menuColor: pick(s.toolbar.color.value.value, foreground),
            axisFont: s.axis.fontFamily.value || DEFAULT_FONT,
            legendColor: pick(s.legend.color.value.value, foreground),
            axisSize: s.axis.textSize.value,
            axisColor: pick(s.axis.color.value.value, headerForeground),
            axisBold: s.axis.bold.value,
            padding: s.layout.padding.value,
            cellPadding: s.layout.cellPadding.value,
            indent: s.layout.indent.value,
            legendGap: s.layout.legendGap.value,
            barRatio: s.bars.barThickness.value / 100,
            designNotes: notes
        };

        // Custom colours are allowed, so the visual reports any pairing that falls below WCAG 2.2 AA instead of silently shipping it.
        if (!hc) {
            const check = (label: string, fore: string, back: string, minimum: number): void => {
                const ratio = contrastRatio(fore, back);
                if (ratio !== null && ratio < minimum) {
                    notes.push(label + " contrast is " + ratio.toFixed(1) + ":1, below the " + minimum + ":1 minimum.");
                }
            };
            check("Text", foreground, background, 4.5);
            check("Text on group rows", foreground, groupBackgrounds[0], 4.5);
            check("Header text", headerForeground, headerBackground, 4.5);
            if (band) {
                check("Text on banded rows", foreground, band, 4.5);
            }
            check("Planned bar", forecast, background, 3);
            if (s.bars.splitAtCutoff.value) {
                check("Planned after cut-off bar", remaining, background, 3);
                check("Planned against planned after cut-off", forecast, remaining, 3);
            }
            if (s.bars.showProgress.value) {
                check("Progress against planned bar", theme.progress, forecast, 3);
            }
            if (s.bars.showBaseline.value) {
                check("Baseline bar", theme.baseline, background, 3);
            }
            check("Critical flag", theme.critical, background, 3);
            check("Legend text", theme.legendColor, background, 4.5);
            check("Axis text", theme.axisColor, headerBackground, 4.5);
            check("Cut-off line", theme.cutoff, background, 3);
            if (s.variance.showIcons.value) {
                // Coloured days are text, so they need 4.5:1. Icons are graphics and need 3:1.
                const minimum = s.variance.style.value.value === "colourText" ? 4.5 : 3;
                check("On time status", theme.good, background, minimum);
                check("Late within tolerance status", theme.warning, background, minimum);
                check("Late beyond tolerance status", theme.bad, background, minimum);
                if (s.variance.iconSet.value.value === "dots" && s.variance.style.value.value === "icon") {
                    notes.push("Dots differ by colour alone and Icon only hides the days, so the status depends on colour. Choose Icon and days, or the Shapes or Symbols icon set.");
                }
            }
        }
        return theme;
    }

    private applyTheme(theme: Theme): void {
        const style = this.root.style;
        style.setProperty("--g-bg", theme.background);
        style.setProperty("--g-fg", theme.foreground);
        style.setProperty("--g-head-bg", theme.headerBackground);
        style.setProperty("--g-head-fg", theme.headerForeground);
        style.setProperty("--g-band", theme.band || theme.background);
        style.setProperty("--g-line", theme.line);
        style.setProperty("--g-cell-pad", theme.cellPadding + "px");
        style.setProperty("--g-legend-size", theme.legendSize + "pt");
        style.setProperty("--g-legend-font", theme.legendFont);
        style.setProperty("--g-menu-font", theme.menuFont);
        style.setProperty("--g-menu-size", theme.menuSize + "pt");
        style.setProperty("--g-menu-fg", theme.menuColor);
        style.setProperty("--g-legend-fg", theme.legendColor);
        style.setProperty("--g-legend-gap", theme.legendGap + "px");
        style.padding = theme.padding + "px";
        style.fontFamily = theme.fontFamily;
        style.fontSize = theme.fontSize + "pt";
    }

    private readRows(source: DataViewTableRow[], index: Record<string, number>, groupColumns: number[], extraColumns: number[], tipColumns: number[]): TaskRow[] {
        const get = (row: DataViewTableRow, role: string): Value => {
            const position = index[role];
            return position === undefined ? null : row[position];
        };

        const rows: TaskRow[] = source.map((row) => ({
            id: get(row, "taskId"),
            name: toText(get(row, "taskName")),
            groups: groupColumns.map((position) => toText(row[position]).trim()),
            extras: extraColumns.map((position) => row[position]),
            tips: tipColumns.map((position) => row[position]),
            itemType: toText(get(row, "itemType")).trim(),
            baselineStart: toDate(get(row, "baselineStart")),
            baselineFinish: toDate(get(row, "baselineFinish")),
            plannedStart: toDate(get(row, "plannedStart")),
            plannedFinish: toDate(get(row, "plannedFinish")),
            percent: toNumber(get(row, "percentComplete")),
            predecessors: get(row, "predecessors"),
            successors: get(row, "successors"),
            float: toNumber(get(row, "totalFloat")),
            milestoneDate: null
        }));

        // A task with only one forecast date is a milestone, so exports that leave the finish blank, or the start blank for finish milestones, need no DAX workaround.
        rows.forEach((row) => {
            if (row.plannedStart && !row.plannedFinish) {
                row.plannedFinish = row.plannedStart;
            } else if (!row.plannedStart && row.plannedFinish) {
                row.plannedStart = row.plannedFinish;
            }
            // Baselines get the same treatment, so start milestones, which carry only start dates, still have a baseline finish to measure variance against.
            if (row.baselineStart && !row.baselineFinish) {
                row.baselineFinish = row.baselineStart;
            } else if (!row.baselineStart && row.baselineFinish) {
                row.baselineStart = row.baselineFinish;
            }
        });

        // Rows flagged by Item type, or with one forecast date, become milestones. The marker sits on the start or finish chosen in the format pane.
        const match = (this.settings.milestones.matchValue.value || "Milestone").trim().toLowerCase();
        const placement = this.settings.milestones.position.value.value;
        rows.forEach((row, position) => {
            // Contains, not equals, so activity types such as Start Milestone and Finish Milestone both match. Auto places Finish Milestone types on the finish date.
            const type = toText(get(source[position], "itemType")).trim().toLowerCase();
            const typed = match.length > 0 && type.indexOf(match) >= 0;
            const atFinish = placement === "finish" || (placement === "auto" && type.indexOf("finish") >= 0);
            const single = row.plannedStart !== null && row.plannedFinish !== null && row.plannedStart.getTime() === row.plannedFinish.getTime();
            if (typed || single) {
                row.milestoneDate = atFinish ? row.plannedFinish || row.plannedStart : row.plannedStart || row.plannedFinish;
            }
        });

        // Percent complete may arrive as 0 to 1 or 0 to 100, so the scale is decided once for the whole column.
        let max = 0;
        rows.forEach((row) => {
            if (row.percent !== null && row.percent > max) {
                max = row.percent;
            }
        });
        const divisor = max <= 1 ? 1 : 100;
        rows.forEach((row) => {
            if (row.percent !== null) {
                row.percent = Math.max(0, Math.min(1, row.percent / divisor));
            }
        });

        return rows;
    }

    // The cut-off measure returns the same value on every row, so the first usable value wins. Without it the format pane decides between today and no line.
    private readCutoff(source: DataViewTableRow[], index: Record<string, number>): Cutoff | null {
        const s = this.settings;
        if (!s.cutoff.show.value) {
            return null;
        }
        const position = index["cutoffDate"];
        if (position !== undefined) {
            for (const row of source) {
                const date = toDate(row[position]);
                if (date) {
                    return { time: date.getTime(), label: "Cut-off " + this.formatDate(date), fromMeasure: true };
                }
            }
            return null;
        }
        if (s.cutoff.fallback.value.value === "today") {
            const now = new Date();
            return { time: now.getTime(), label: "Today " + this.formatDate(now), fromMeasure: false };
        }
        return null;
    }

    private buildScale(rows: TaskRow[], fitWidth: number, cutoff: Cutoff | null): Scale | null {
        let width = fitWidth;
        let min = Infinity;
        let max = -Infinity;
        rows.forEach((row) => {
            [row.baselineStart, row.baselineFinish, row.plannedStart, row.plannedFinish].forEach((date) => {
                if (date) {
                    const time = date.getTime();
                    min = Math.min(min, time);
                    max = Math.max(max, time);
                }
            });
        });
        if (!isFinite(min)) {
            return null;
        }
        // A cut-off from a measure is always shown, so the range stretches to include it. Today only shows when it already falls inside the data.
        if (cutoff && cutoff.fromMeasure) {
            min = Math.min(min, cutoff.time);
            max = Math.max(max, cutoff.time);
        }
        if (max === min) {
            max = min + MS_PER_DAY;
        }
        const pad = (max - min) * 0.02;
        min -= pad;
        max += pad;

        const days = (max - min) / MS_PER_DAY;
        let unit: TimeUnit;
        if (this.viewScale !== "fit") {
            // Pixels per day for each unit the viewer can pick in the menu, capped so a long schedule at day scale stays drawable.
            const perDay: Record<TimeUnit, number> = { day: 44, week: 10, month: 3.2, quarter: 1.4, year: 0.45 };
            unit = this.viewScale;
            width = Math.min(20000, Math.max(width, Math.round(days * perDay[unit])));
        } else {
            const chosen = this.settings.timeline.scale.value.value;
            unit = chosen === "auto" ? chooseUnit(width / days) : (chosen as TimeUnit);
        }
        const cutoffX = cutoff && cutoff.time >= min && cutoff.time <= max ? ((cutoff.time - min) / (max - min)) * width : null;
        return { min, max, width, unit, cutoffX };
    }

    private formatDate(date: Date | null): string {
        return date ? date.toLocaleDateString(this.host.locale, { day: "2-digit", month: "short", year: "numeric" }) : "";
    }

// Null means calendar days. Otherwise delay skips the chosen weekdays and the holidays from the format pane and the Holidays measure.
    private readCalendar(source: DataViewTableRow[], index: Record<string, number>): WorkCalendar | null {
        const w = this.settings.workdays;
        if (w.mode.value.value !== "working") {
            return null;
        }
        let text = w.holidays.value || "";
        const position = index["holidays"];
        if (position !== undefined) {
            const found = source.find((row) => row[position] !== null && row[position] !== undefined && String(row[position]).trim() !== "");
            if (found) {
                text += "," + String(found[position]);
            }
        }
        const nonWorking = [w.offSunday.value, w.offMonday.value, w.offTuesday.value, w.offWednesday.value, w.offThursday.value, w.offFriday.value, w.offSaturday.value];
        // A week with no working days would make every delay zero, so it falls back to Saturday and Sunday off.
        return { nonWorking: nonWorking.every((off) => off) ? [true, false, false, false, false, false, true] : nonWorking, holidays: parseHolidays(text) };
    }

    // Plain words for the footnote, so readers know whether delay skips weekends and holidays.
    private dayBasisNote(): string {
        const calendar = this.workCalendar;
        if (!calendar) {
            return "Baseline variance is counted in calendar days, weekends and bank holidays included.";
        }
        const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const order = [1, 2, 3, 4, 5, 6, 0];
        const working = order.filter((day) => !calendar.nonWorking[day]);
        const mondayToFriday = working.length === 5 && working.every((day, i) => day === i + 1);
        const days = mondayToFriday ? "Monday to Friday" : working.map((day) => names[day]).join(", ");
        // A count of holidays reads as if only some were removed, so the note just says whether bank holidays are excluded.
        const holidays = calendar.holidays.size > 0 ? ", bank holidays excluded" : "";
        return "Baseline variance is counted in working days (" + days + ")" + holidays + ".";
    }

    private delayDays(row: TaskRow): number | null {
        if (!row.baselineFinish || !row.plannedFinish) {
            return null;
        }
        return this.workCalendar ? workdaysBetween(row.baselineFinish, row.plannedFinish, this.workCalendar) : daysBetween(row.baselineFinish, row.plannedFinish);
    }

    private varianceText(row: TaskRow): string {
        const days = this.delayDays(row);
        if (days === null) {
            return "";
        }
        if (days === 0) {
            return "On baseline";
        }
        return (days > 0 ? days : -days) + " d" + (days > 0 ? " behind" : " ahead");
    }

    private varianceStatus(row: TaskRow): Status | null {
        const days = this.delayDays(row);
        if (days === null) {
            return null;
        }
        const goodLimit = this.settings.variance.goodDays.value;
        // Status 2 can never end before status 1 does, whatever is typed in the format pane.
        const warningLimit = Math.max(goodLimit, this.settings.variance.warningDays.value);
        if (days <= goodLimit) {
            return "good";
        }
        return days <= warningLimit ? "warning" : "bad";
    }

    private buildColumns(table: DataViewTable, index: Record<string, number>, extraColumns: number[], nameLeads: boolean, theme: Theme, full: boolean): Column[] {
        // Headers use the field names from the report, so they match what the author bound and renamed.
        const name = (role: string, fallback: string): string => {
            const column = table.columns[index[role]];
            return column && column.displayName ? column.displayName : fallback;
        };
        const columns: Column[] = [];
        if (index["taskName"] !== undefined && !nameLeads) {
            columns.push({ header: name("taskName", "Task"), text: (row) => row.name });
        }
        // Extra columns only describe tasks, so group rows leave them blank instead of repeating a value the way a matrix would.
        extraColumns.forEach((position, slot) => {
            const column = table.columns[position];
            columns.push({
                header: column && column.displayName ? column.displayName : "Column " + (slot + 1),
                text: (row) => this.formatValue(row.extras[slot])
            });
        });
        // Grid columns can be switched off to save space. Hidden fields still drive the bars, statuses and tooltip, and table view always lists them.
        const grid = this.settings.columns;
        const show = (toggle: boolean): boolean => full || toggle;
        if (index["plannedStart"] !== undefined && show(grid.showPlannedStart.value)) {
            // Date columns always say Planned, whatever the bound field is called, so they are never mistaken for baseline dates.
            columns.push({ header: "Planned start", text: (row) => this.formatDate(row.plannedStart) });
        }
        if (index["plannedFinish"] !== undefined && show(grid.showPlannedFinish.value)) {
            columns.push({ header: "Planned finish", text: (row) => this.formatDate(row.plannedFinish) });
        }
        if (full) {
            if (index["itemType"] !== undefined) {
                columns.splice(nameLeads ? 0 : 1, 0, { header: name("itemType", "Item type"), text: (row) => row.itemType });
            }
            if (index["baselineStart"] !== undefined) {
                columns.push({ header: "Baseline start", text: (row) => this.formatDate(row.baselineStart) });
            }
            if (index["baselineFinish"] !== undefined) {
                columns.push({ header: "Baseline finish", text: (row) => this.formatDate(row.baselineFinish) });
            }
        }
        if (index["baselineFinish"] !== undefined && index["plannedFinish"] !== undefined) {
            if (show(grid.showVariance.value)) {
                columns.push({
                    header: "Baseline variance",
                    text: (row) => this.varianceText(row),
                    decorate: this.settings.variance.showIcons.value ? (cell, row) => this.decorateVariance(cell, row, theme) : undefined
                });
            }
        }
        if (index["percentComplete"] !== undefined && show(grid.showPercent.value)) {
            columns.push({
                header: name("percentComplete", "Complete"),
                text: (row) => (row.percent === null ? "" : Math.round(row.percent * 100) + "%")
            });
        }
        if (index["totalFloat"] !== undefined && show(grid.showFloat.value)) {
            columns.push({
                header: name("totalFloat", "Float"),
                text: (row) => (row.float === null ? "" : row.float + " d" + (row.float <= 0 ? " (critical)" : ""))
            });
        }
        // Link columns can be hidden from the chart while the links still drive the logic trace, the checks and the tooltip. Table view always lists them.
        const showLinks = full || this.settings.trace.showLinkColumns.value;
        if (index["predecessors"] !== undefined && showLinks) {
            columns.push({ header: name("predecessors", "Predecessors"), text: (row) => toText(row.predecessors) });
        }
        if (index["successors"] !== undefined && showLinks) {
            columns.push({ header: name("successors", "Successors"), text: (row) => toText(row.successors) });
        }
        if (full) {
            this.tipNames.forEach((header, slot) => columns.push({ header, text: (row) => this.formatValue(row.tips[slot]) }));
        }
        return columns;
    }

    // Icons differ by shape as well as colour (circle, triangle, octagon) and the cell text always states the days, so status never depends on colour alone (WCAG 1.4.1).
    // Status wording from the format pane, with {n} replaced by the tolerance in days.
    private statusLabel(status: Status): string {
        const v = this.settings.variance;
        const raw = status === "good" ? v.goodLabel.value : status === "warning" ? v.warningLabel.value : v.badLabel.value;
        const fallback = status === "good" ? "On track" : status === "warning" ? "At risk" : "Late";
        return (raw && raw.trim() ? raw : fallback).split("{n}").join(String(v.warningDays.value));
    }

    // Every display style keeps the days and the status in the cell text for screen readers, even when only the icon is visible.
    private decorateVariance(cell: HTMLElement, row: TaskRow, theme: Theme): void {
        const status = this.varianceStatus(row);
        if (!status) {
            return;
        }
        const style = this.settings.variance.style.value.value;
        const days = cell.textContent || "";
        const statusColour = status === "good" ? theme.good : status === "warning" ? theme.warning : theme.bad;
        while (cell.firstChild) {
            cell.removeChild(cell.firstChild);
        }
        if (style !== "text" && style !== "colourText") {
            cell.appendChild(this.statusIcon(status, theme));
        }
        const daysSpan = this.el("span", style === "icon" ? "sr-only" : undefined, days);
        if (style === "colourText") {
            daysSpan.style.color = statusColour;
            daysSpan.style.fontWeight = "600";
        }
        cell.appendChild(daysSpan);
        cell.appendChild(this.el("span", "sr-only", ", " + this.statusLabel(status)));
    }

    private statusIcon(status: Status, theme: Theme): SVGElement {
        const svg = this.svgEl("svg", { width: 14, height: 14, viewBox: "0 0 14 14", class: "gantt-icon" });
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const set = this.settings.variance.iconSet.value.value;
        const colour = status === "good" ? theme.good : status === "warning" ? theme.warning : theme.bad;
        if (set === "dots") {
            svg.appendChild(this.svgEl("circle", { cx: 7, cy: 7, r: 5.5, fill: colour }));
            return svg;
        }
        if (set === "symbols") {
            const paths: Record<Status, string> = { good: "M2 7.5 5.5 11 12 3", warning: "M7 1.5V9 M7 11.2V12.8", bad: "M2.5 2.5 11.5 11.5 M11.5 2.5 2.5 11.5" };
            svg.appendChild(this.svgEl("path", { d: paths[status], fill: "none", stroke: colour, "stroke-width": 2.4, "stroke-linecap": "round" }));
            return svg;
        }
        if (status === "good") {
            svg.appendChild(this.svgEl("circle", { cx: 7, cy: 7, r: 6, fill: theme.good }));
            svg.appendChild(this.svgEl("path", { d: "M4 7.2 6.1 9.3 10 5", fill: "none", stroke: theme.background, "stroke-width": 1.8 }));
        } else if (status === "warning") {
            svg.appendChild(this.svgEl("polygon", { points: "7,1 13.5,13 0.5,13", fill: theme.warning }));
            svg.appendChild(this.svgEl("rect", { x: 6.2, y: 5, width: 1.6, height: 4.2, fill: theme.background }));
            svg.appendChild(this.svgEl("rect", { x: 6.2, y: 10.2, width: 1.6, height: 1.6, fill: theme.background }));
        } else {
            svg.appendChild(this.svgEl("polygon", { points: "4.5,1 9.5,1 13,4.5 13,9.5 9.5,13 4.5,13 1,9.5 1,4.5", fill: theme.bad }));
            svg.appendChild(this.svgEl("path", { d: "M4.6 4.6 9.4 9.4 M9.4 4.6 4.6 9.4", stroke: theme.background, "stroke-width": 1.8 }));
        }
        return svg;
    }

    // Diamond marker. After the cut-off it turns into a lighter outlined diamond, matching the split forecast bars.
    private milestoneMarker(cx: number, cy: number, r: number, theme: Theme, critical: boolean, afterCutoff: boolean): SVGElement {
        return this.svgEl("polygon", {
            points: cx + "," + (cy - r) + " " + (cx + r) + "," + cy + " " + cx + "," + (cy + r) + " " + (cx - r) + "," + cy,
            fill: afterCutoff ? mixColours(theme.milestone, theme.background, 0.3) || theme.background : theme.milestone,
            stroke: theme.milestone,
            "stroke-width": 1
        });
    }

    private formatValue(value: Value | undefined): string {
        if (value === null || value === undefined) {
            return "";
        }
        if (value instanceof Date) {
            return this.formatDate(value);
        }
        if (typeof value === "number") {
            return value.toLocaleString(this.host.locale);
        }
        return String(value);
    }

    private flagShape(left: number, top: number, size: number, theme: Theme): SVGElement {
        const group = this.svgEl("g", { transform: "translate(" + left + "," + top + ") scale(" + size / 14 + ")" });
        group.appendChild(this.svgEl("rect", { x: 2, y: 1, width: 1.6, height: 12, fill: theme.foreground }));
        group.appendChild(this.svgEl("polygon", { points: "3.6,1.5 12.5,4.5 3.6,7.5", fill: theme.critical }));
        return group;
    }

    private flagIcon(theme: Theme, fill?: string): SVGElement {
        const svg = this.svgEl("svg", { width: 14, height: 14, viewBox: "0 0 14 14", class: "gantt-icon" });
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.appendChild(this.svgEl("rect", { x: 2, y: 1, width: 1.6, height: 12, fill: theme.foreground }));
        svg.appendChild(this.svgEl("polygon", { points: "3.6,1.5 12.5,4.5 3.6,7.5", fill: fill || theme.warning }));
        return svg;
    }

    private buildTable(
        rows: TaskRow[],
        table: DataViewTable,
        index: Record<string, number>,
        extraColumns: number[],
        theme: Theme,
        scale: Scale | null,
        cutoff: Cutoff | null
    ): HTMLElement {
        const nameLeads = !this.settings.display.showTaskId.value && index["taskName"] !== undefined;
        const columns = this.buildColumns(table, index, extraColumns, nameLeads, theme, this.tableView);
        // Rows grow with the text so large text is never clipped, and never drop below the row height chosen in the format pane.
        const rowHeight = Math.max(this.settings.display.rowHeight.value, Math.round(theme.fontSize * (4 / 3) * 1.6));

        // The table is the primary content. The drawing is a redundant visual layer, so every fact is also in a cell (WCAG 1.1.1, 1.3.1).
        const grid = this.el("table", "gantt-table");
        grid.setAttribute("role", this.isTree ? "treegrid" : "grid");
        grid.setAttribute("aria-label", "Project schedule");
        grid.setAttribute("aria-rowcount", String(this.visible.length + 1));

        const head = this.el("thead");
        const headRow = this.el("tr");
        headRow.setAttribute("role", "row");
        headRow.setAttribute("aria-rowindex", "1");
        const leadColumn = table.columns[index[nameLeads ? "taskName" : "taskId"]];
        headRow.appendChild(this.headerCell(leadColumn && leadColumn.displayName ? leadColumn.displayName : nameLeads ? "Task" : "Task ID"));
        columns.forEach((column) => headRow.appendChild(this.headerCell(column.header)));
        if (scale) {
            const axisCell = this.el("th", "gantt-axis");
            axisCell.setAttribute("aria-hidden", "true");
            axisCell.appendChild(this.buildAxis(scale, theme));
            headRow.appendChild(axisCell);
        }
        head.appendChild(headRow);
        grid.appendChild(head);

        const bodyElement = this.el("tbody");
        this.visible.forEach((item, position) => {
            const isGroup = item.kind === "group";
            const row = item.kind === "group" ? summarise(item.node, rows) : rows[item.index];
            const key = item.kind === "group" ? "g:" + item.node.key : "t:" + item.index;

            const tr = this.el("tr", isGroup ? "gantt-group" : undefined);
            if (theme.band && position % 2 === 1) {
                tr.classList.add("gantt-band");
            }
            tr.setAttribute("role", "row");
            tr.setAttribute("aria-rowindex", String(position + 2));
            tr.setAttribute("data-row", String(position));
            tr.setAttribute("data-key", key);
            tr.setAttribute("tabindex", "-1");
            tr.style.height = rowHeight + "px";
            if (item.kind === "group") {
                tr.style.setProperty("--g-row-bg", theme.groupBackgrounds[Math.min(item.level, theme.groupBackgrounds.length) - 1]);
            }
            if (this.isTree) {
                tr.setAttribute("aria-level", String(item.level));
                if (item.kind === "group") {
                    tr.setAttribute("aria-expanded", String(item.expanded));
                }
            }

            const idCell = this.el("th");
            idCell.setAttribute("scope", "row");
            idCell.setAttribute("role", "rowheader");
            if (this.isTree) {
                idCell.style.paddingLeft = theme.cellPadding + (item.level - 1) * theme.indent + (isGroup ? 0 : 24) + "px";
            }
            if (item.kind === "group") {
                idCell.appendChild(this.toggleButton(item.expanded));
            }
            idCell.appendChild(this.el("span", undefined, isGroup || !nameLeads ? toText(row.id) : row.name));
            const link = item.kind === "task" ? this.linkRole(item.index) : "";
            if (link) {
                idCell.appendChild(this.el("span", "gantt-badge", link));
                if (link === "Traced") {
                    tr.classList.add("gantt-traced");
                }
            }
            tr.appendChild(idCell);

            columns.forEach((column) => {
                const td = this.el("td", undefined, column.text(row));
                td.setAttribute("role", "gridcell");
                if (column.decorate) {
                    column.decorate(td, row);
                }
                tr.appendChild(td);
            });

            if (scale) {
                const td = this.el("td", "gantt-timeline");
                td.setAttribute("role", "gridcell");
                td.setAttribute("aria-hidden", "true");
                td.appendChild(this.buildTimeline(row, scale, rowHeight, theme, cutoff, isGroup));
                tr.appendChild(td);
            }
            bodyElement.appendChild(tr);
        });
        grid.appendChild(bodyElement);
        return grid;
    }

    // The arrow is a pointer target only. Keyboard users expand and collapse with the arrow keys on the row, and screen readers hear aria-expanded on the row, so the arrow stays out of the tab order and the accessibility tree.
    private toggleButton(expanded: boolean): HTMLElement {
        const toggle = this.el("span", "gantt-toggle");
        toggle.setAttribute("aria-hidden", "true");
        toggle.setAttribute("data-toggle", "true");
        const svg = this.svgEl("svg", { width: 12, height: 12, viewBox: "0 0 12 12" });
        svg.setAttribute("focusable", "false");
        svg.appendChild(this.svgEl("rect", { x: 0.5, y: 0.5, width: 11, height: 11, fill: "none", stroke: "currentColor", "stroke-width": 1 }));
        svg.appendChild(this.svgEl("path", { d: expanded ? "M3 6H9" : "M3 6H9M6 3V9", fill: "none", stroke: "currentColor", "stroke-width": 1.4 }));
        toggle.appendChild(svg);
        return toggle;
    }

    private headerCell(text: string): HTMLElement {
        const th = this.el("th", undefined, text);
        th.setAttribute("scope", "col");
        th.setAttribute("role", "columnheader");
        return th;
    }

    private axisLabel(date: Date, unit: TimeUnit, upper: boolean): string {
        const locale = this.host.locale;
        switch (unit) {
            case "day":
            case "week":
                return date.toLocaleDateString(locale, { day: "2-digit" });
            case "month":
                return upper
                    ? date.toLocaleDateString(locale, { month: "short", year: "numeric" })
                    : date.toLocaleDateString(locale, { month: "short" });
            case "quarter":
                return "Q" + (Math.floor(date.getMonth() / 3) + 1);
            case "year":
                return String(date.getFullYear());
        }
    }

    private buildAxis(scale: Scale, theme: Theme): SVGElement {
        const upper = this.settings.axis.showYears.value ? upperUnit(scale.unit) : null;
        const fontPx = theme.axisSize * (4 / 3);
        // Each axis row grows with its text size so the year and month labels never overlap.
        const AXIS_TIER = Math.max(18, Math.round(fontPx + 10));
        const height = upper ? AXIS_TIER * 2 : AXIS_TIER;
        const svg = this.svgEl("svg", { width: scale.width, height, viewBox: "0 0 " + scale.width + " " + height });
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const x = (time: number): number => ((time - scale.min) / (scale.max - scale.min)) * scale.width;

        const tier = (unit: TimeUnit, top: number, isUpper: boolean): void => {
            bands(scale.min, scale.max, unit).forEach((band) => {
                const x1 = x(band.start);
                const x2 = x(band.end);
                svg.appendChild(this.svgEl("line", { x1, x2: x1, y1: top, y2: top + AXIS_TIER, stroke: theme.line, "stroke-width": 1 }));
                const label = this.axisLabel(new Date(band.start), unit, isUpper);
                // Labels only appear when they fit inside their band, so they never overlap.
                if (x2 - x1 >= label.length * fontPx * 0.62 + 6) {
                    const text = this.svgEl("text", {
                        x: (x1 + x2) / 2,
                        y: top + AXIS_TIER / 2,
                        "dominant-baseline": "central",
                        "text-anchor": "middle",
                        fill: theme.axisColor,
                        "font-family": theme.axisFont,
                        "font-size": fontPx * (isUpper ? 0.9 : 1),
                        "font-weight": theme.axisBold ? 600 : 400
                    });
                    text.textContent = label;
                    svg.appendChild(text);
                }
            });
        };
        if (upper) {
            tier(upper, 0, true);
            svg.appendChild(this.svgEl("line", { x1: 0, x2: scale.width, y1: AXIS_TIER, y2: AXIS_TIER, stroke: theme.line, "stroke-width": 1 }));
        }
        tier(scale.unit, upper ? AXIS_TIER : 0, false);

        if (scale.cutoffX !== null) {
            svg.appendChild(
                this.svgEl("line", { x1: scale.cutoffX, x2: scale.cutoffX, y1: 0, y2: height, stroke: theme.cutoff, "stroke-width": theme.cutoffWidth })
            );
        }
        return svg;
    }

    // One planned bar per row, with a thin baseline bar underneath. Planned after the cut-off is a darker shade, progress is a light inner strip, critical is a red outline and milestones are diamonds. Planned dates up to the cut-off are already actuals, so the tooltip marks them and no separate actual bar is drawn.
    private buildTimeline(row: TaskRow, scale: Scale, height: number, theme: Theme, cutoff: Cutoff | null, isGroup: boolean): SVGElement {
        const svg = this.svgEl("svg", { width: scale.width, height, viewBox: "0 0 " + scale.width + " " + height });
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const s = this.settings;
        const x = (date: Date | number): number => (((typeof date === "number" ? date : date.getTime()) - scale.min) / (scale.max - scale.min)) * scale.width;

        if (theme.grid) {
            bands(scale.min, scale.max, scale.unit).forEach((band, position) => {
                if (position > 0) {
                    const gx = x(band.start);
                    svg.appendChild(this.svgEl("line", { x1: gx, x2: gx, y1: 0, y2: height, stroke: theme.grid as string, "stroke-width": 1 }));
                }
            });
        }

        const showBaseline = s.bars.showBaseline.value && !isGroup && row.baselineStart !== null && row.baselineFinish !== null;
        const barHeight = Math.max(6, Math.round(height * theme.barRatio));
        const baselineHeight = 3;
        const stack = barHeight + (showBaseline ? baselineHeight + 2 : 0);
        const top = Math.round((height - stack) / 2);
        const centre = top + barHeight / 2;
        const radius = Math.min(theme.radius, barHeight / 2);

        if (row.plannedStart && row.plannedFinish) {
            const start = row.plannedStart.getTime();
            const finish = row.plannedFinish.getTime();
            const critical = row.float !== null && row.float <= 0;
            const split = cutoff !== null && s.bars.splitAtCutoff.value ? cutoff.time : null;
            const markerRadius = Math.min(theme.milestoneSize, height - 6) / 2;

            if (isGroup) {
                // Group rows get one thin summary bar with end caps, so they read as a bracket around their tasks.
                const x1 = x(start);
                const x2 = Math.max(x1 + 3, x(finish));
                const y = centre - 2;
                svg.appendChild(this.svgEl("rect", { x: x1, y, width: x2 - x1, height: 4, fill: theme.foreground }));
                svg.appendChild(this.svgEl("path", { d: "M" + x1 + " " + y + "h5l-5 6z M" + x2 + " " + y + "h-5l5 6z", fill: theme.foreground }));
            } else if (row.milestoneDate) {
                svg.appendChild(this.milestoneMarker(x(row.milestoneDate), centre, markerRadius, theme, critical, split !== null && row.milestoneDate.getTime() > split));
            } else if (finish === start) {
                svg.appendChild(this.milestoneMarker(x(start), centre, markerRadius, theme, critical, split !== null && start > split));
            } else {
                const x1 = x(start);
                const x2 = Math.max(x1 + 3, x(finish));
                const doneEnd = split === null ? finish : Math.min(finish, split);
                const remainingFrom = split === null ? finish : Math.max(start, split);
                const hc = this.host.colorPalette.isHighContrast;
                if (remainingFrom < finish) {
                    svg.appendChild(
                        this.svgEl("rect", {
                            x: x1,
                            y: top,
                            width: x2 - x1,
                            height: barHeight,
                            rx: radius,
                            fill: theme.remaining,
                            stroke: hc ? theme.forecast : "none",
                            "stroke-width": hc ? 1 : 0
                        })
                    );
                }
                if (doneEnd > start) {
                    const xd = Math.min(x2, x(doneEnd));
                    svg.appendChild(this.svgEl("rect", { x: x1, y: top, width: Math.max(1, xd - x1), height: barHeight, rx: radius, fill: theme.forecast }));
                    // Squares off the joint where the two shades meet, so only the outer ends are rounded.
                    if (remainingFrom < finish && xd - x1 > radius) {
                        svg.appendChild(this.svgEl("rect", { x: xd - radius, y: top, width: radius, height: barHeight, fill: theme.forecast }));
                    }
                }
                if (s.bars.showProgress.value && row.percent !== null && row.percent > 0) {
                    // The completed share fills from the bar start. In high contrast it is drawn as an outlined hollow section instead of a second colour.
                    const hcProgress = this.host.colorPalette.isHighContrast;
                    const xp = x1 + (x2 - x1) * row.percent;
                    svg.appendChild(
                        this.svgEl("rect", {
                            x: x1,
                            y: top,
                            width: Math.max(1, xp - x1),
                            height: barHeight,
                            rx: radius,
                            fill: theme.progress,
                            stroke: hcProgress ? theme.forecast : "none",
                            "stroke-width": hcProgress ? 1 : 0
                        })
                    );
                    if (row.percent < 1 && xp - x1 > radius) {
                        svg.appendChild(this.svgEl("rect", { x: xp - radius, y: top, width: radius, height: barHeight, fill: theme.progress }));
                    }
                }
            }
        }

        // Critical tasks get a red flag just after the bar or milestone, or just before it when the end is at the timeline edge. Float of zero or less also says (critical) in the grid and tooltip.
        if (!isGroup && row.float !== null && row.float <= 0 && row.plannedStart && row.plannedFinish) {
            const markerHalf = Math.min(theme.milestoneSize, height - 6) / 2;
            const startX = x(row.milestoneDate || row.plannedStart);
            const endX = row.milestoneDate || row.plannedStart.getTime() === row.plannedFinish.getTime() ? startX + markerHalf : Math.max(startX + 3, x(row.plannedFinish));
            const size = Math.max(8, Math.min(16, height - 8));
            const fx = endX + 4 + size <= scale.width ? endX + 4 : Math.max(0, (row.milestoneDate ? startX - markerHalf : startX) - size - 4);
            svg.appendChild(this.flagShape(fx, centre - size / 2, size, theme));
        }

        if (showBaseline && row.baselineStart && row.baselineFinish) {
            const b1 = x(row.baselineStart);
            svg.appendChild(
                this.svgEl("rect", {
                    x: b1,
                    y: top + barHeight + 2,
                    width: Math.max(3, x(row.baselineFinish) - b1),
                    height: baselineHeight,
                    rx: 1.5,
                    fill: theme.baseline
                })
            );
        }

        if (scale.cutoffX !== null) {
            svg.appendChild(
                this.svgEl("line", {
                    x1: scale.cutoffX,
                    x2: scale.cutoffX,
                    y1: 0,
                    y2: height,
                    stroke: theme.cutoff,
                    "stroke-width": theme.cutoffWidth
                })
            );
        }
        return svg;
    }

    private buildLegend(index: Record<string, number>, scale: Scale | null, cutoff: Cutoff | null, theme: Theme): HTMLElement {
        const list = this.el("ul", "gantt-legend");
        list.setAttribute("aria-label", "Legend");
        // The size is set on the legend itself, in points like every other Power BI text size.
        list.style.fontSize = theme.legendSize + "pt";
        list.style.fontFamily = theme.legendFont;
        list.style.color = theme.legendColor;
        const align = this.settings.legend.alignment.value;
        list.style.justifyContent = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
        const items: Array<[LegendKind, string]> = [];
        if (scale) {
            if (index["baselineStart"] !== undefined && index["baselineFinish"] !== undefined && this.settings.bars.showBaseline.value) {
                items.push(["baseline", "Baseline"]);
            }
            if (index["plannedStart"] !== undefined && index["plannedFinish"] !== undefined) {
                const split = scale.cutoffX !== null && this.settings.bars.splitAtCutoff.value;
                items.push(["forecast", split ? "Planned to cut-off" : "Planned"]);
                if (split) {
                    items.push(["remaining", "Planned after cut-off"]);
                }
            }
            if (index["percentComplete"] !== undefined && this.settings.bars.showProgress.value) {
                items.push(["progress", "Progress (completed)"]);
            }
            if (this.visibleMilestones) {
                items.push(["milestone", "Milestone"]);
            }
            if (index["totalFloat"] !== undefined) {
                items.push(["critical", "Critical"]);
            }
            if (cutoff && scale.cutoffX !== null) {
                items.push(["cutoff", cutoff.label]);
            }
        }
        if (this.settings.variance.showIcons.value && this.settings.variance.showInLegend.value && this.settings.variance.style.value.value !== "text" && index["baselineFinish"] !== undefined && index["plannedFinish"] !== undefined) {
            const goodLimit = this.settings.variance.goodDays.value;
            const warningLimit = Math.max(goodLimit, this.settings.variance.warningDays.value);
            const days = (n: number): string => (n < 0 ? -n + " d early" : n + " d");
            items.push(["good", this.statusLabel("good") + " (delay up to " + days(goodLimit) + ")"]);
            items.push(["warning", this.statusLabel("warning") + " (delay over " + days(goodLimit) + ", up to " + days(warningLimit) + ")"]);
            items.push(["bad", this.statusLabel("bad") + " (delay over " + days(warningLimit) + ")"]);
        }
        items.forEach(([kind, label]) => {
            const item = this.el("li");
            item.appendChild(this.swatch(kind, theme));
            item.appendChild(this.el("span", undefined, label));
            list.appendChild(item);
        });
        return list;
    }

    private swatch(kind: LegendKind, theme: Theme): SVGElement {
        if (kind === "good" || kind === "warning" || kind === "bad") {
            return this.statusIcon(kind, theme);
        }
        if (kind === "critical") {
            return this.flagIcon(theme, theme.critical);
        }
        if (kind === "milestone") {
            const holder = this.svgEl("svg", { width: 16, height: 16, viewBox: "0 0 16 16" });
            holder.setAttribute("aria-hidden", "true");
            holder.setAttribute("focusable", "false");
            holder.appendChild(this.milestoneMarker(8, 8, 6, theme, false, false));
            return holder;
        }
        const svg = this.svgEl("svg", { width: 28, height: 14, viewBox: "0 0 28 14" });
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        switch (kind) {
            case "baseline":
                svg.appendChild(this.svgEl("rect", { x: 1, y: 5.5, width: 26, height: 3, rx: 1.5, fill: theme.baseline }));
                break;
            case "forecast":
                svg.appendChild(this.svgEl("rect", { x: 1, y: 2, width: 26, height: 10, rx: Math.min(theme.radius, 5), fill: theme.forecast }));
                break;
            case "remaining":
                svg.appendChild(this.svgEl("rect", { x: 1, y: 2, width: 26, height: 10, rx: Math.min(theme.radius, 5), fill: theme.remaining }));
                break;
            case "progress":
                svg.appendChild(this.svgEl("rect", { x: 1, y: 2, width: 26, height: 10, rx: Math.min(theme.radius, 5), fill: theme.progress }));
                break;
            case "cutoff":
                svg.appendChild(this.svgEl("line", { x1: 14, x2: 14, y1: 0, y2: 14, stroke: theme.cutoff, "stroke-width": theme.cutoffWidth }));
                break;
        }
        return svg;
    }

    private linkRole(index: number): string {
        if (!this.trace) {
            return "";
        }
        if (index === this.trace.index) {
            return "Traced";
        }
        if (this.trace.predecessors.has(index)) {
            return "Predecessor";
        }
        return this.trace.successors.has(index) ? "Successor" : "";
    }

    private traceSummary(): string {
        if (!this.trace || !this.network) {
            return "";
        }
        const row = this.rows[this.trace.index];
        const label = toText(row.id) + (row.name ? " " + row.name : "");
        const count = (n: number, word: string): string => n + " " + word + (n === 1 ? "" : "s");
        return "Tracing " + label + ": " + count(this.trace.predecessors.size, "predecessor") + ", " + count(this.trace.successors.size, "successor") + ".";
    }

    private buildTraceBar(): HTMLElement {
        const bar = this.el("div", "gantt-trace");
        bar.appendChild(this.el("span", undefined, this.traceSummary()));
        const button = this.el("button", "gantt-button", "Show all");
        button.type = "button";
        button.setAttribute("data-action", "untrace");
        bar.appendChild(button);
        return bar;
    }

    private toggleTrace(index: number): void {
        if (!this.network || !this.settings.trace.enabled.value) {
            return;
        }
        const id = this.network.tasks[index] ? this.network.tasks[index].id : "";
        // Blank IDs cannot be followed through the network, so they are not traceable.
        if (id === "") {
            return;
        }
        this.traceId = this.traceId === id ? null : id;
        this.focusKey = "t:" + index;
        this.hideTooltip();
        if (this.lastOptions) {
            this.render(this.lastOptions, false);
        }
        this.announce(this.trace ? this.traceSummary() : "Logic trace cleared. All tasks are shown.");
    }

    // Centres the cut-off line in the visible part of the timeline when the timeline is wider than the visual. Returns false when there is nothing to scroll to.
    private scrollTimelineToCutoff(): boolean {
        const scale = this.currentScale;
        const scroll = this.body.querySelector<HTMLElement>(".gantt-scroll");
        const axis = this.body.querySelector<HTMLElement>("th.gantt-axis");
        if (!scale || scale.cutoffX === null || !scroll || !axis) {
            return false;
        }
        if (scroll.scrollWidth > scroll.clientWidth) {
            const frozen = this.body.querySelector<HTMLElement>("thead th");
            const frozenWidth = frozen ? frozen.offsetWidth : 0;
            const visibleTimeline = scroll.clientWidth - frozenWidth;
            scroll.scrollLeft = Math.max(0, axis.offsetLeft + scale.cutoffX - frozenWidth - visibleTimeline / 2);
        }
        return true;
    }

    // Goes to the cut-off line, then to the first visible task still open at that date (in progress, or the next to start), and gives it keyboard focus.
    private goToCutoff(): void {
        if (!this.cutoff || !this.scrollTimelineToCutoff()) {
            return;
        }
        const time = this.cutoff.time;
        let target = -1;
        let fallback = -1;
        this.visible.forEach((item, position) => {
            if (item.kind !== "task" || target >= 0) {
                return;
            }
            const row = this.rows[item.index];
            if (!row.plannedStart || !row.plannedFinish) {
                return;
            }
            if (row.plannedStart.getTime() <= time && row.plannedFinish.getTime() >= time) {
                target = position;
            } else if (fallback < 0 && row.plannedStart.getTime() > time) {
                fallback = position;
            }
        });
        const position = target >= 0 ? target : fallback;
        const where = this.cutoff.fromMeasure ? "the cut-off date, " : "today, ";
        if (position < 0) {
            this.announce("Moved to " + where + this.formatDate(new Date(time)) + ".");
            return;
        }
        const element = this.rowElements()[position];
        const item = this.visible[position];
        const name = item.kind === "task" ? this.rows[item.index].name || toText(this.rows[item.index].id) : "";
        this.focusKey = element.getAttribute("data-key") || "";
        this.setRoving(position);
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "center", inline: "nearest" });
        // Focusing a row can pull the timeline back, so the line is centred again afterwards.
        this.scrollTimelineToCutoff();
        this.announce("Moved to " + where + this.formatDate(new Date(time)) + ". " + (target >= 0 ? "In progress: " : "Next to start: ") + name + ".");
    }

    // One menu button opens a list of view options, following the WAI-ARIA menu button pattern. It is a single tab stop, and the items are reached with the arrow keys.
    private buildMenu(hasDates: boolean): HTMLElement {
        const bar = this.el("div", "gantt-toolbar");
        // The menu sits right at the top of the visual by default, just under the Power BI title, and Layout can push it down.
        bar.style.paddingTop = this.settings.layout.menuGap.value + "px";
        const s = this.settings;
        const items: Array<{ action: string; label: string; checked?: boolean; radio?: boolean; separator?: boolean; ariaLabel?: string }> = [];
        if (s.toolbar.showTableView.value && hasDates) {
            items.push({ action: "table", label: "Table view", checked: this.tableView });
        }
        if (s.toolbar.showExpand.value && this.isTree) {
            items.push({ action: "expand", label: "Expand all" });
            items.push({ action: "collapse", label: "Collapse all" });
        }
        if (this.trace) {
            items.push({ action: "untrace", label: "Show all tasks" });
        }
        const scale = this.currentScale;
        if (s.toolbar.showGoToCutoff.value && scale && scale.cutoffX !== null && this.cutoff) {
            items.push({ action: "gotoCutoff", label: this.cutoff.fromMeasure ? "Go to cut-off date" : "Go to today" });
        }
        if (s.toolbar.showTimeScale.value && hasDates && !this.tableView) {
            const scales: Array<["fit" | TimeUnit, string]> = [
                ["fit", "Whole timeline"],
                ["day", "Days"],
                ["week", "Weeks"],
                ["month", "Months"],
                ["quarter", "Quarters"],
                ["year", "Years"]
            ];
            if (items.length > 0) {
                items.push({ action: "", label: "", separator: true });
            }
            items.push({ action: "", label: "Time scale", separator: true });
            scales.forEach(([value, label]) => {
                items.push({ action: "scale:" + value, label, radio: true, checked: this.viewScale === value, ariaLabel: "Time scale, " + label });
            });
        }
        if (items.length === 0) {
            return bar;
        }

        const button = this.el("button", "gantt-button gantt-menu-button");
        button.type = "button";
        button.setAttribute("data-action", "menu");
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "gantt-user-menu");
        const icon = this.svgEl("svg", { width: 14, height: 14, viewBox: "0 0 14 14" });
        icon.setAttribute("aria-hidden", "true");
        icon.setAttribute("focusable", "false");
        icon.appendChild(this.svgEl("path", { d: "M1 3H13M1 7H13M1 11H13", stroke: "currentColor", "stroke-width": 1.8 }));
        button.appendChild(icon);
        button.appendChild(this.el("span", undefined, "Menu"));
        bar.appendChild(button);

        const menu = this.el("ul", "gantt-menu");
        menu.id = "gantt-user-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Schedule view");
        menu.hidden = true;
        items.forEach((item) => {
            // Separators and the group heading are not focusable. Each radio item carries its group name, so it is read as Time scale, Weeks.
            if (item.separator) {
                const divider = this.el("li", item.label ? "gantt-menu-heading" : "gantt-menu-divider", item.label);
                divider.setAttribute("role", "separator");
                if (item.label) {
                    divider.setAttribute("aria-hidden", "true");
                }
                menu.appendChild(divider);
                return;
            }
            const entry = this.el("li", undefined, item.label);
            entry.setAttribute("role", item.radio ? "menuitemradio" : item.checked === undefined ? "menuitem" : "menuitemcheckbox");
            if (item.ariaLabel) {
                entry.setAttribute("aria-label", item.ariaLabel);
            }
            if (item.checked !== undefined) {
                entry.setAttribute("aria-checked", String(item.checked));
            }
            entry.setAttribute("tabindex", "-1");
            entry.setAttribute("data-action", item.action);
            menu.appendChild(entry);
        });
        bar.appendChild(menu);
        return bar;
    }

    private menuParts(): { button: HTMLElement | null; menu: HTMLElement | null; items: HTMLElement[] } {
        const button = this.body.querySelector<HTMLElement>(".gantt-menu-button");
        const menu = this.body.querySelector<HTMLElement>(".gantt-menu");
        const items = menu ? Array.from(menu.querySelectorAll<HTMLElement>("[role^='menuitem']")) : [];
        return { button, menu, items };
    }

    private setMenu(open: boolean, focusItem?: number): void {
        const { button, menu, items } = this.menuParts();
        if (!button || !menu) {
            return;
        }
        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        if (open && items.length > 0) {
            const index = focusItem === undefined ? 0 : (focusItem + items.length) % items.length;
            items[index].focus();
        }
    }

    // Returns true when the key was a menu key, so the grid handler leaves it alone.
    private onMenuKey(event: KeyboardEvent, target: HTMLElement): boolean {
        const { button, items } = this.menuParts();
        if (target === button) {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.setMenu(true, 0);
                return true;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                this.setMenu(true, items.length - 1);
                return true;
            }
            return false;
        }
        const position = items.indexOf(target);
        if (position < 0) {
            return false;
        }
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                items[(position + 1) % items.length].focus();
                return true;
            case "ArrowUp":
                event.preventDefault();
                items[(position - 1 + items.length) % items.length].focus();
                return true;
            case "Home":
                event.preventDefault();
                items[0].focus();
                return true;
            case "End":
                event.preventDefault();
                items[items.length - 1].focus();
                return true;
            case "Enter":
            case " ":
                event.preventDefault();
                this.runAction(target.getAttribute("data-action") || "");
                return true;
            // Escape closes the open menu and returns to its button. It is stopped here so it does not also leave the visual, and a second Escape leaves as usual.
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                this.setMenu(false);
                if (button) {
                    button.focus();
                }
                return true;
            case "Tab":
                this.setMenu(false);
                return true;
        }
        return false;
    }

    private runAction(action: string): void {
        if (action === "menu") {
            const { menu } = this.menuParts();
            this.setMenu(!!menu && menu.hidden, 0);
            return;
        }
        const fromMenu = !!this.body.querySelector(".gantt-menu:not([hidden])");
        if (action === "untrace") {
            this.traceId = null;
            this.pendingActionFocus = fromMenu ? "menu" : "";
            if (this.lastOptions) {
                this.render(this.lastOptions, false);
            }
            this.announce("Logic trace cleared. All tasks are shown.");
            return;
        }
        if (action === "gotoCutoff") {
            this.setMenu(false);
            this.goToCutoff();
            return;
        }
        if (action.indexOf("scale:") === 0) {
            const picked = action.slice(6) as "fit" | TimeUnit;
            this.viewScale = picked;
            this.pendingActionFocus = "menu";
            if (this.lastOptions) {
                this.render(this.lastOptions, true);
            }
            const names: Record<string, string> = { fit: "Whole timeline", day: "Days", week: "Weeks", month: "Months", quarter: "Quarters", year: "Years" };
            this.announce("Time scale: " + names[picked] + ".");
            return;
        }
        if (action === "table") {
            this.tableView = !this.tableView;
        } else if (action === "expand") {
            this.collapsed.clear();
        } else if (action === "collapse") {
            this.groupKeys.forEach((key) => this.collapsed.add(key));
        } else {
            return;
        }
        this.pendingActionFocus = "menu";
        if (this.lastOptions) {
            this.render(this.lastOptions, action === "table");
        }
        const messages: Record<string, string> = {
            table: this.tableView ? "Table view on. The timeline is hidden and every field is shown as a column." : "Table view off. The timeline is shown.",
            expand: "All groups expanded.",
            collapse: "All groups collapsed."
        };
        this.announce(messages[action]);
    }

    private tooltipItems(position: number): VisualTooltipDataItem[] {
        const item = this.visible[position];
        if (!item) {
            return [];
        }
        const items: VisualTooltipDataItem[] = [];
        const add = (displayName: string, value: string): void => {
            if (value !== "") {
                items.push({ displayName, value });
            }
        };
        const has = (role: string): boolean => this.boundRoles.has(role);
        const dates = (row: TaskRow): void => {
            if (has("plannedStart")) {
                add("Planned start", this.plannedText(row.plannedStart));
            }
            if (has("plannedFinish")) {
                add("Planned finish", this.plannedText(row.plannedFinish));
            }
            if (has("baselineStart")) {
                add("Baseline start", this.formatDate(row.baselineStart));
            }
            if (has("baselineFinish")) {
                add("Baseline finish", this.formatDate(row.baselineFinish));
            }
            add("Baseline variance", this.varianceText(row));
            if (has("percentComplete")) {
                add("Complete", row.percent === null ? "" : Math.round(row.percent * 100) + "%");
            }
            if (has("totalFloat")) {
                add("Total float", row.float === null ? "" : row.float + " d" + (row.float <= 0 ? " (critical)" : ""));
            }
        };
        if (item.kind === "group") {
            const node = this.groupNodes.get(item.node.key) || item.node;
            const summary = summarise(node, this.rows);
            add("Group", node.label);
            add("Tasks", String(node.rows.length));
            dates(summary);
            return items;
        }
        const row = this.rows[item.index];
        add("Logic", this.linkRole(item.index));
        add("Task ID", toText(row.id));
        add("Task", row.name);
        add("Item type", row.itemType);
        if (row.groups.length > 0) {
            add("Group", row.groups.map((label) => label || "(Blank)").join(" > "));
        }
        dates(row);
        add("Predecessors", toText(row.predecessors));
        add("Successors", toText(row.successors));
        this.extraNames.forEach((name, slot) => add(name, this.formatValue(row.extras[slot])));
        // Fields in the Tooltips well are always listed, even when empty, so the author can see they are bound.
        this.tipNames.forEach((name, slot) => items.push({ displayName: name, value: this.formatValue(row.tips[slot]) || "(blank)" }));
        return items;
    }

    // Planned dates on or before the report cut-off have already happened, so they are labelled as actual, like the A flag in a P6 export.
    private plannedText(date: Date | null): string {
        if (!date) {
            return "";
        }
        const actual = this.cutoff !== null && date.getTime() <= this.cutoff.time;
        return this.formatDate(date) + (actual ? " (actual)" : "");
    }

    // Tooltips come from the host tooltip service, which keeps them dismissable and in Power BI's own style (WCAG 1.4.13). They show on hover and on keyboard focus.
    private showTooltip(position: number, coordinates: number[]): void {
        const service = this.host.tooltipService;
        if (!service || !service.enabled()) {
            return;
        }
        const options = { coordinates, isTouchEvent: false, dataItems: this.tooltipItems(position), identities: [] };
        if (this.tooltipRow === position) {
            service.move(options);
        } else {
            service.show(options);
        }
        this.tooltipRow = position;
    }

    private hideTooltip(): void {
        const service = this.host.tooltipService;
        if (service && this.tooltipRow >= 0) {
            service.hide({ isTouchEvent: false, immediately: true });
        }
        this.tooltipRow = -1;
    }

    private onPointerMove(event: MouseEvent): void {
        const target = event.target as Element | null;
        const row = target && target.closest ? target.closest("tbody tr[data-row]") : null;
        if (!row) {
            this.hideTooltip();
            return;
        }
        this.showTooltip(Number(row.getAttribute("data-row")), [event.clientX, event.clientY]);
    }

    private buildChecks(network: Network, theme: Theme): { element: HTMLElement; summary: string } {
        const count = (severity: Severity): number => network.issues.filter((issue) => issue.severity === severity).length;
        const errors = count("error");
        const warnings = count("warning");
        const notes = count("info") + theme.designNotes.length;

        const summary =
            errors + warnings + notes === 0
                ? "Logic check: no issues found in predecessors and successors."
                : "Logic check: " + errors + " errors, " + warnings + " warnings, " + notes + " notes. Select to see details.";

        const details = this.el("details", "gantt-checks");
        details.appendChild(this.el("summary", undefined, summary));

        const label: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };
        const list = this.el("ul");
        const limit = 200;
        network.issues.slice(0, limit).forEach((issue) => {
            list.appendChild(this.el("li", undefined, label[issue.severity] + " (data row " + (issue.taskIndex + 1) + "): " + issue.message));
        });
        if (network.issues.length > limit) {
            list.appendChild(this.el("li", undefined, "And " + (network.issues.length - limit) + " more."));
        }
        theme.designNotes.forEach((note) => list.appendChild(this.el("li", undefined, "Design note: " + note)));
        if (list.childElementCount > 0) {
            details.appendChild(list);
        }
        return { element: details, summary };
    }

    private showMessage(text: string): void {
        this.body.appendChild(this.el("p", "gantt-message", text));
    }

    private announce(message: string): void {
        if (message !== this.lastAnnouncement) {
            this.status.textContent = message;
            this.lastAnnouncement = message;
        }
    }

    private rowElements(): HTMLElement[] {
        return Array.from(this.body.querySelectorAll<HTMLElement>("tr[data-row]"));
    }

    // Roving tabindex: one tab stop for the whole grid, arrow keys move between rows (WCAG 2.1.1, 2.1.2).
    private setRoving(active: number): void {
        this.rowElements().forEach((row, position) => row.setAttribute("tabindex", position === active ? "0" : "-1"));
    }

    private moveFocus(next: number): void {
        const rows = this.rowElements();
        if (rows.length === 0) {
            return;
        }
        const clamped = Math.max(0, Math.min(rows.length - 1, next));
        this.focusKey = rows[clamped].getAttribute("data-key") || "";
        this.setRoving(clamped);
        rows[clamped].focus();
        rows[clamped].scrollIntoView({ block: "nearest" });
    }

    private toggleGroup(position: number, expand?: boolean): void {
        const item = this.visible[position];
        if (!item || item.kind !== "group") {
            return;
        }
        const target = expand === undefined ? !item.expanded : expand;
        if (target === item.expanded) {
            return;
        }
        if (target) {
            this.collapsed.delete(item.node.key);
        } else {
            this.collapsed.add(item.node.key);
        }
        this.focusKey = "g:" + item.node.key;
        if (this.lastOptions) {
            this.render(this.lastOptions, false);
        }
        this.announce((target ? "Expanded " : "Collapsed ") + item.node.label + ".");
    }

    private onClick(event: MouseEvent): void {
        const target = event.target as Element | null;
        const actionElement = target && target.closest ? target.closest("[data-action]") : null;
        if (!actionElement || actionElement.getAttribute("data-action") !== "menu") {
            const open = this.body.querySelector(".gantt-menu:not([hidden])");
            if (open && !(target && target.closest && target.closest(".gantt-menu"))) {
                this.setMenu(false);
            }
        }
        if (actionElement) {
            this.runAction(actionElement.getAttribute("data-action") || "");
            return;
        }
        const toggle = target && target.closest ? target.closest("[data-toggle]") : null;
        const row = toggle ? toggle.closest("tr[data-row]") : null;
        if (row) {
            this.toggleGroup(Number(row.getAttribute("data-row")));
            return;
        }
        const taskRow = target && target.closest ? target.closest("tbody tr[data-row]") : null;
        const item = taskRow ? this.visible[Number(taskRow.getAttribute("data-row"))] : null;
        if (item && item.kind === "task") {
            this.toggleTrace(item.index);
        }
    }

    private onFocusIn(event: FocusEvent): void {
        const target = event.target as HTMLElement | null;
        if (target && target.getAttribute && target.getAttribute("data-row") !== null) {
            this.focusKey = target.getAttribute("data-key") || "";
            const position = Number(target.getAttribute("data-row"));
            this.setRoving(position);
            // The row may be scrolled sideways, so the tooltip anchors to the frozen first cell, which is always on screen.
            const anchor = (target.querySelector("th") || target).getBoundingClientRect();
            this.showTooltip(position, [anchor.left + Math.min(120, anchor.width / 2), anchor.bottom]);
        }
    }

    private parentPosition(position: number): number | null {
        const level = this.visible[position] ? this.visible[position].level : 1;
        for (let index = position - 1; index >= 0; index--) {
            if (this.visible[index].level < level) {
                return index;
            }
        }
        return null;
    }

    private onKeyDown(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target && this.onMenuKey(event, target)) {
            return;
        }
        if (!target || !target.getAttribute || target.getAttribute("data-row") === null) {
            return;
        }
        if (event.key === "Escape") {
            this.hideTooltip();
            return;
        }
        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }
        const current = Number(target.getAttribute("data-row"));
        const item = this.visible[current];
        let next: number | null = null;
        let handled = true;
        switch (event.key) {
            case "ArrowDown":
                next = current + 1;
                break;
            case "ArrowUp":
                next = current - 1;
                break;
            case "PageDown":
                next = current + 10;
                break;
            case "PageUp":
                next = current - 10;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = Number.MAX_SAFE_INTEGER;
                break;
            // Tree grid pattern: Right opens a closed group or steps into it, Left closes an open group or steps out to the parent.
            case "ArrowRight":
                if (!this.isTree) {
                    handled = false;
                } else if (item && item.kind === "group" && !item.expanded) {
                    this.toggleGroup(current, true);
                } else if (item && item.kind === "group") {
                    next = current + 1;
                }
                break;
            case "ArrowLeft":
                if (!this.isTree) {
                    handled = false;
                } else if (item && item.kind === "group" && item.expanded) {
                    this.toggleGroup(current, false);
                } else {
                    next = this.parentPosition(current);
                }
                break;
            case "Enter":
            case " ":
                if (item && item.kind === "group") {
                    this.toggleGroup(current);
                } else if (item && item.kind === "task" && this.settings.trace.enabled.value) {
                    this.toggleTrace(item.index);
                } else {
                    handled = false;
                }
                break;
            default:
                handled = false;
        }
        // Tab and Escape are left alone so focus can always leave the visual (WCAG 2.1.2 No Keyboard Trap).
        if (handled) {
            event.preventDefault();
        }
        if (next !== null) {
            this.moveFocus(next);
        }
    }

    // DOM is built with createElement and textContent only, never innerHTML, as certification requires.
    private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
        const element = this.root.ownerDocument.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    private svgEl(tag: string, attributes: Record<string, string | number>): SVGElement {
        const element = this.root.ownerDocument.createElementNS(SVG_NS, tag);
        Object.keys(attributes).forEach((name) => element.setAttribute(name, String(attributes[name])));
        return element as SVGElement;
    }
}
