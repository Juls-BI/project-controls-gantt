"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import Model = formattingSettings.Model;
import ValidatorType = powerbi.visuals.ValidatorType;
import AlignmentGroupMode = powerbi.visuals.AlignmentGroupMode;

// An empty colour means automatic, so the visual picks a theme colour that passes contrast checks.
function colour(name: string, displayName: string): formattingSettings.ColorPicker {
    return new formattingSettings.ColorPicker({ name, displayName, value: { value: "" } });
}

function toggle(name: string, displayName: string, value: boolean): formattingSettings.ToggleSwitch {
    return new formattingSettings.ToggleSwitch({ name, displayName, value });
}

function whole(name: string, displayName: string, value: number, min: number, max: number): formattingSettings.NumUpDown {
    return new formattingSettings.NumUpDown({
        name,
        displayName,
        value,
        options: {
            minValue: { type: ValidatorType.Min, value: min },
            maxValue: { type: ValidatorType.Max, value: max }
        }
    });
}


export const DEFAULT_FONT = "Verdana";
export const DEFAULT_TEXT_SIZE = 18;

// Keep in step with the version in pbiviz.json, so the format pane shows which build a report is running.
export const CREATED_BY = "Data Tides";
export const COPYRIGHT = "© 2026 Data Tides";
export const VISUAL_VERSION = "1.0.33.0";

class TextCard extends Card {
    font = new formattingSettings.FontControl({
        name: "font",
        displayName: "Font",
        fontFamily: new formattingSettings.FontPicker({ name: "fontFamily", value: DEFAULT_FONT }),
        fontSize: new formattingSettings.NumUpDown({ name: "fontSize", value: DEFAULT_TEXT_SIZE })
    });
    textColor = colour("textColor", "Text colour");
    headerColor = colour("headerColor", "Header text colour");
    headerBackground = colour("headerBackground", "Header background");

    name = "text";
    displayName = "Text";
    slices: Slice[] = [this.font, this.textColor, this.headerColor, this.headerBackground];
}

class RowsCard extends Card {
    bandedRows = toggle("bandedRows", "Banded rows", false);
    bandColor = colour("bandColor", "Band colour");
    gridlineColor = colour("gridlineColor", "Row lines");
    groupBackground = colour("groupBackground", "Group rows");

    name = "rows";
    displayName = "Rows";
    slices: Slice[] = [this.groupBackground, this.bandedRows, this.bandColor, this.gridlineColor];
}

class BarsCard extends Card {
    forecastColor = colour("forecastColor", "Planned");
    splitAtCutoff = toggle("splitAtCutoff", "Split planned bar at cut-off", false);
    remainingColor = colour("remainingColor", "Planned after cut-off");
    baselineColor = colour("baselineColor", "Baseline");
    progressColor = colour("progressColor", "Progress");
    criticalColor = colour("criticalColor", "Critical flag");
    rounded = toggle("rounded", "Rounded bars", true);
    showBaseline = toggle("showBaseline", "Show baseline", true);
    showProgress = toggle("showProgress", "Show progress", true);
    barThickness = whole("barThickness", "Bar thickness (% of row)", 45, 20, 80);

    name = "bars";
    displayName = "Bars";
    slices: Slice[] = [
        this.forecastColor,
        this.splitAtCutoff,
        this.remainingColor,
        this.baselineColor,
        this.progressColor,
        this.criticalColor,
        this.rounded,
        this.showBaseline,
        this.showProgress,
        this.barThickness
    ];
}

export const SCALE_ITEMS = [
    { value: "auto", displayName: "Auto" },
    { value: "day", displayName: "Days" },
    { value: "week", displayName: "Weeks" },
    { value: "month", displayName: "Months" },
    { value: "quarter", displayName: "Quarters" },
    { value: "year", displayName: "Years" }
];

class TimelineCard extends Card {
    scale = new formattingSettings.ItemDropdown({ name: "scale", displayName: "Time scale", items: SCALE_ITEMS, value: SCALE_ITEMS[0] });
    widthPercent = whole("widthPercent", "Width (% of visual)", 50, 20, 85);
    showGridlines = toggle("showGridlines", "Gridlines", true);
    gridColor = colour("gridColor", "Gridline colour");
    scrollToCutoff = toggle("scrollToCutoff", "Scroll to cut-off on load", true);

    name = "timeline";
    displayName = "Timeline";
    slices: Slice[] = [this.scale, this.widthPercent, this.showGridlines, this.gridColor, this.scrollToCutoff];
}

export const FALLBACK_ITEMS = [
    { value: "today", displayName: "Use today" },
    { value: "none", displayName: "Hide line" }
];

class CutoffCard extends Card {
    show = toggle("show", "Show", true);
    fallback = new formattingSettings.ItemDropdown({
        name: "fallback",
        displayName: "Without a cut-off measure",
        items: FALLBACK_ITEMS,
        value: FALLBACK_ITEMS[0]
    });
    lineColor = colour("lineColor", "Line colour");
    lineWidth = whole("lineWidth", "Line width", 2, 1, 6);

    name = "cutoff";
    displayName = "Cut-off line";
    topLevelSlice = this.show;
    slices: Slice[] = [this.fallback, this.lineColor, this.lineWidth];
}

export const VARIANCE_STYLES = [
    { value: "iconText", displayName: "Icon and days" },
    { value: "icon", displayName: "Icon only" },
    { value: "text", displayName: "Days only" },
    { value: "colourText", displayName: "Coloured days" }
];

export const ICON_SETS = [
    { value: "shapes", displayName: "Shapes (circle, triangle, octagon)" },
    { value: "symbols", displayName: "Symbols (tick, exclamation, cross)" },
    { value: "dots", displayName: "Dots (colour only)" }
];

// Each status is a delay band in days, where delay is planned finish minus baseline finish. Status 1 covers any delay up to its limit (negative means early), status 2 covers delays above that up to its own limit, and status 3 covers anything later.
class VarianceCard extends Card {
    showIcons = toggle("showIcons", "Show status", true);
    goodLabel = new formattingSettings.TextInput({ name: "goodLabel", displayName: "Status 1 name", value: "On track", placeholder: "On track" });
    goodDays = whole("goodDays", "Status 1: delay up to (days)", 0, -3650, 3650);
    goodColor = colour("goodColor", "Status 1 colour");
    warningLabel = new formattingSettings.TextInput({ name: "warningLabel", displayName: "Status 2 name", value: "At risk", placeholder: "At risk" });
    warningDays = whole("warningDays", "Status 2: delay up to (days)", 10, -3650, 3650);
    warningColor = colour("warningColor", "Status 2 colour");
    badLabel = new formattingSettings.TextInput({
        name: "badLabel",
        displayName: "Status 3 name",
        description: "Any delay over the status 2 limit.",
        value: "Late",
        placeholder: "Late"
    });
    badColor = colour("badColor", "Status 3 colour");
    style = new formattingSettings.ItemDropdown({ name: "style", displayName: "Display", items: VARIANCE_STYLES, value: VARIANCE_STYLES[0] });
    iconSet = new formattingSettings.ItemDropdown({ name: "iconSet", displayName: "Icon set", items: ICON_SETS, value: ICON_SETS[0] });
    showInLegend = toggle("showInLegend", "Show in legend", true);

    name = "variance";
    displayName = "Baseline variance";
    topLevelSlice = this.showIcons;
    slices: Slice[] = [
        this.goodLabel,
        this.goodDays,
        this.goodColor,
        this.warningLabel,
        this.warningDays,
        this.warningColor,
        this.badLabel,
        this.badColor,
        this.style,
        this.iconSet,
        this.showInLegend
    ];
}

export const MILESTONE_POSITIONS = [
    { value: "auto", displayName: "Auto (finish date for Finish Milestone types)" },
    { value: "start", displayName: "Planned start" },
    { value: "finish", displayName: "Planned finish" }
];

class MilestonesCard extends Card {
    matchValue = new formattingSettings.TextInput({
        name: "matchValue",
        displayName: "Milestone when Item type contains",
        description: "Rows whose Item type contains this word, ignoring case, are drawn as milestones. Works with P6 types such as Start Milestone and Finish Milestone.",
        value: "Milestone",
        placeholder: "Milestone"
    });
    position = new formattingSettings.ItemDropdown({
        name: "position",
        displayName: "Place marker at",
        items: MILESTONE_POSITIONS,
        value: MILESTONE_POSITIONS[0]
    });
    color = colour("color", "Marker colour");
    size = whole("size", "Marker size", 14, 8, 24);

    name = "milestones";
    displayName = "Milestones";
    slices: Slice[] = [this.matchValue, this.position, this.color, this.size];
}

class LegendCard extends Card {
    show = toggle("show", "Show", true);
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Font", value: DEFAULT_FONT });
    textSize = whole("textSize", "Text size", DEFAULT_TEXT_SIZE, 6, 40);
    color = colour("color", "Text colour");
    alignment = new formattingSettings.AlignmentGroup({ name: "alignment", displayName: "Alignment", mode: AlignmentGroupMode.Horizonal, value: "left" });

    name = "legend";
    displayName = "Legend";
    topLevelSlice = this.show;
    slices: Slice[] = [this.fontFamily, this.textSize, this.color, this.alignment];
}

class AxisCard extends Card {
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Font", value: DEFAULT_FONT });
    textSize = whole("textSize", "Text size", DEFAULT_TEXT_SIZE, 6, 40);
    color = colour("color", "Text colour");
    bold = toggle("bold", "Bold", true);
    showYears = toggle("showYears", "Show year row", true);

    name = "axis";
    displayName = "Axis";
    slices: Slice[] = [this.fontFamily, this.textSize, this.color, this.bold, this.showYears];
}

class LayoutCard extends Card {
    padding = whole("padding", "Padding around visual (px)", 4, 0, 48);
    cellPadding = whole("cellPadding", "Cell padding (px)", 8, 2, 32);
    indent = whole("indent", "Indent per level (px)", 16, 0, 48);
    legendGap = whole("legendGap", "Space between legend items (px)", 16, 4, 48);
    chartGap = whole("chartGap", "Space between legend and chart (px)", 12, 0, 64);
    menuGap = whole("menuGap", "Space above menu (px)", 0, 0, 48);

    name = "layout";
    displayName = "Layout";
    slices: Slice[] = [this.padding, this.cellPadding, this.indent, this.legendGap, this.chartGap, this.menuGap];
}

class ToolbarCard extends Card {
    show = toggle("show", "Show", true);
    showTableView = toggle("showTableView", "Table view option", true);
    showExpand = toggle("showExpand", "Expand all and Collapse all options", true);
    showTimeScale = toggle("showTimeScale", "Time scale options", true);
    showGoToCutoff = toggle("showGoToCutoff", "Go to cut-off or today option", true);
    fontFamily = new formattingSettings.FontPicker({ name: "fontFamily", displayName: "Font", value: DEFAULT_FONT });
    textSize = whole("textSize", "Text size", 12, 6, 40);
    color = colour("color", "Text colour");

    name = "toolbar";
    displayName = "User Menu";
    description = "The menu button, the logic check summary and the logic trace bar.";
    topLevelSlice = this.show;
    slices: Slice[] = [this.showTableView, this.showExpand, this.showTimeScale, this.showGoToCutoff, this.fontFamily, this.textSize, this.color];
}

// Direct links are the default, so a trace tags only the IDs listed in the selected task's own Predecessors and Successors cells.
export const TRACE_DEPTHS = [
    { value: "direct", displayName: "Direct links only" },
    { value: "full", displayName: "Full chain of predecessors and successors" }
];

class TraceCard extends Card {
    enabled = toggle("enabled", "Click a task to trace its logic", true);
    depth = new formattingSettings.ItemDropdown({ name: "depth", displayName: "Show", items: TRACE_DEPTHS, value: TRACE_DEPTHS[0] });
    showLinkColumns = toggle("showLinkColumns", "Show Predecessors and Successors columns", true);

    name = "trace";
    displayName = "Logic trace";
    topLevelSlice = this.enabled;
    slices: Slice[] = [this.depth, this.showLinkColumns];
}

export const DAY_COUNT_MODES = [
    { value: "calendar", displayName: "Calendar days" },
    { value: "working", displayName: "Working days" }
];

// Delay can be counted in calendar days or in working days, skipping the non-working weekdays and holidays chosen here.
class WorkdaysCard extends Card {
    mode = new formattingSettings.ItemDropdown({ name: "mode", displayName: "Count delay in", items: DAY_COUNT_MODES, value: DAY_COUNT_MODES[0] });
    offMonday = toggle("offMonday", "Non-working: Monday", false);
    offTuesday = toggle("offTuesday", "Non-working: Tuesday", false);
    offWednesday = toggle("offWednesday", "Non-working: Wednesday", false);
    offThursday = toggle("offThursday", "Non-working: Thursday", false);
    offFriday = toggle("offFriday", "Non-working: Friday", false);
    offSaturday = toggle("offSaturday", "Non-working: Saturday", true);
    offSunday = toggle("offSunday", "Non-working: Sunday", true);
    holidays = new formattingSettings.TextInput({
        name: "holidays",
        displayName: "Holidays",
        description: "Dates separated by commas, for example 2026-12-25, 2026-12-28. A measure in the Holidays field is added to these.",
        value: "",
        placeholder: "2026-12-25, 2026-12-28"
    });

    name = "workdays";
    displayName = "Working days";
    slices: Slice[] = [
        this.mode,
        this.offMonday,
        this.offTuesday,
        this.offWednesday,
        this.offThursday,
        this.offFriday,
        this.offSaturday,
        this.offSunday,
        this.holidays
    ];
}

class ColumnsCard extends Card {
    showPlannedStart = toggle("showPlannedStart", "Planned start", true);
    showPlannedFinish = toggle("showPlannedFinish", "Planned finish", true);
    showVariance = toggle("showVariance", "Baseline variance", true);
    showPercent = toggle("showPercent", "Percent complete", true);
    showFloat = toggle("showFloat", "Total float", true);

    name = "columns";
    displayName = "Grid columns";
    description = "Hide columns to save space. Hidden fields still drive the bars, statuses and tooltip, and table view lists them all.";
    slices: Slice[] = [this.showPlannedStart, this.showPlannedFinish, this.showVariance, this.showPercent, this.showFloat];
}

class AboutCard extends Card {
    version = new formattingSettings.ReadOnlyText({ name: "version", displayName: "Version", value: VISUAL_VERSION });
    createdBy = new formattingSettings.ReadOnlyText({ name: "createdBy", displayName: "Created by", value: CREATED_BY });
    copyright = new formattingSettings.ReadOnlyText({ name: "copyright", displayName: "Copyright", value: COPYRIGHT });

    name = "about";
    displayName = "About";
    slices: Slice[] = [this.version, this.createdBy, this.copyright];
}

class ParsingCard extends Card {
    delimiter = new formattingSettings.TextInput({ name: "delimiter", displayName: "List delimiter", value: ",", placeholder: "," });
    caseSensitive = toggle("caseSensitive", "Case-sensitive IDs", false);

    name = "parsing";
    displayName = "ID parsing";
    slices: Slice[] = [this.delimiter, this.caseSensitive];
}

class DisplayCard extends Card {
    // Rows never go below 24px so row targets meet WCAG 2.5.8 Target Size (Minimum).
    rowHeight = whole("rowHeight", "Row height", 40, 24, 120);
    showLogicChecks = toggle("showLogicChecks", "Show logic checks", true);
    showTaskId = toggle("showTaskId", "Show Task ID column", true);

    name = "display";
    displayName = "Row height and checks";
    slices: Slice[] = [this.rowHeight, this.showTaskId, this.showLogicChecks];
}

export class GanttSettings extends Model {
    text = new TextCard();
    rows = new RowsCard();
    bars = new BarsCard();
    timeline = new TimelineCard();
    cutoff = new CutoffCard();
    variance = new VarianceCard();
    milestones = new MilestonesCard();
    legend = new LegendCard();
    axis = new AxisCard();
    layout = new LayoutCard();
    toolbar = new ToolbarCard();
    trace = new TraceCard();
    columns = new ColumnsCard();
    workdays = new WorkdaysCard();
    parsing = new ParsingCard();
    about = new AboutCard();
    display = new DisplayCard();

    cards = [this.text, this.columns, this.rows, this.bars, this.timeline, this.cutoff, this.milestones, this.variance, this.workdays, this.legend, this.axis, this.layout, this.toolbar, this.trace, this.parsing, this.display, this.about];
}
