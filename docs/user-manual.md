# Project Controls Gantt: User Manual

28 Oct 2026 · Juliana Smith

## Overview

Project Controls Gantt is a Power BI custom visual for schedule reporting: an accessible task grid with a timeline, baseline comparison, a reporting cut-off line, schedule statuses and predecessor and successor logic. This manual covers version 1.0.34.0, created by Data Tides.

It is built for project controls work that the native Power BI Gantt (preview) does not cover:

- **Baselines:** a baseline bar under every task and a baseline variance column.
- **Milestones without DAX:** any type containing the word Milestone, or a task with one date, becomes a diamond.
- **Cut-off date:** a line for the reporting cut-off or data date, and planned dates before it count as actuals.
- **Statuses you define:** On track, At risk and Late by days of delay, shown as icons in the variance column.
- **Logic:** predecessor and successor checks, and a click-to-trace view of a task's links.
- **Scale:** up to 30,000 rows and six levels of grouping.

The schedule is a real grid first and a drawing second. Every fact in a bar is also in a cell or the tooltip, so screen reader and keyboard users get the full schedule. The target is WCAG 2.2 level AA.

## Getting started

The visual needs one flat table with one row per task and a unique text Task ID. Every other field is optional.

### Prepare the data

1. Load the schedule into Power BI, for example a Primavera P6 or MS Project export.
2. In Power Query, set **Task ID**, **Predecessors** and **Successors** to **Text**. This keeps IDs such as 007 and A1000 exactly as written.
3. Set the date columns to **Date**.
4. Leave blank cells empty. Do not type the word null.
5. When you drop a date column into the visual, Power BI may add it as a **Date Hierarchy**. Click the arrow next to the field in the well and choose the column name instead.

### Import the visual

In Power BI Desktop, open the **Visualizations** pane, select **⋯**, then **Import a visual from a file**, and choose the `.pbiviz` file. A newer version with the same ID replaces the old one. Check which version a report runs under **Format > About > Version**.

### Field wells

| Field well | What to put in it | Required |
| --- | --- | --- |
| Task ID | A unique text ID for each task | Yes |
| Task name | The task or activity name | No |
| Item or activity type | Text such as Task, Milestone or a P6 Activity Type. Any value containing Milestone gets a diamond | No |
| Baseline start / Baseline finish | Approved baseline dates | No |
| Planned start / Planned finish | Current dates. Actual dates before the cut-off and planned dates after it | No |
| Report cut-off date | A date column, such as a data date, or a measure that returns one date | No |
| Holidays | A measure that lists holiday dates as text, used when delay is counted in working days | No |
| Percent complete | A column or measure on a 0 to 1 or 0 to 100 scale. Text such as 45% works | No |
| Predecessors / Successors | Text cells of comma-separated Task IDs. Either column alone builds the links | No |
| Total float (days) | Total float from the scheduling tool. Zero or less marks a task critical | No |
| Columns | Up to 8 extra fields such as Owner or Status, shown on task rows only | No |
| Group by | Up to 6 fields, outermost first, such as Project then Phase | No |
| Tooltips | Up to 10 extra columns or measures shown only on hover | No |

A cut-off measure must return a value on every row, otherwise Power BI may drop rows. A safe pattern is:

```
Cut-off = CALCULATE ( MAX ( Schedule[DataDate] ), REMOVEFILTERS ( Schedule ) )
```

## How calculations work

All calculations run inside the visual on the rows Power BI sends. Nothing is written back to your model.

### Milestones

A task becomes a milestone, drawn as a diamond, when any of these is true:

- Its **Item or activity type** contains the word set in **Milestones > Milestone when Item type contains** (default Milestone), ignoring case. Start Milestone and Finish Milestone both match.
- Its planned start and planned finish are the same date.
- It has only one planned date. A blank finish takes the start date, and a blank start takes the finish date.

With **Place marker at: Auto**, types containing Finish sit on the planned finish and everything else on the planned start.

### Percent complete

The scale is decided once for the whole column. If the largest value is 1 or less, values are read as 0 to 1. Otherwise they are divided by 100. Text such as 45% or 0.45 is converted to a number, and values are kept between 0% and 100%.

On the bar, the completed share fills from the planned start in the Progress colour.

### Cut-off date and actuals

The cut-off comes from the **Report cut-off date** field, using the first row with a valid date. Without that field, **Cut-off line > Without a cut-off measure** uses today or hides the line.

- A cut-off from the field always shows: the timeline stretches to include it.
- Today shows only when it falls inside the schedule's dates.
- Planned dates on or before the cut-off count as actuals. The tooltip marks them (actual).

### Baseline variance

By default, delay is measured in calendar days, weekends included, rounded to whole days:

Delay = Planned finish − Baseline finish

A positive delay shows as days behind, a negative delay as days ahead, and zero as On baseline. A task needs both a planned finish and a baseline finish to have a variance. As with planned dates, a task with only one baseline date uses it for both, so start milestones, which carry only start dates, are measured against their baseline start.

With **Working days > Count delay in: Working days**, the delay counts only working days after the baseline finish, up to and including the planned finish. Non-working weekdays (Saturday and Sunday by default) and holidays are skipped. A finish moved from Friday to the next Monday is 1 working day late. Values still read as days, such as 18 d behind. A footnote under the chart says that variance compares finish dates, whether delay is in calendar or working days, which weekdays are worked and whether bank holidays are excluded.

Holidays come from the **Holidays** text box in the format pane, the **Holidays** field, or both. The field takes a measure that lists dates as text, for example:

```
Holiday list = CONCATENATEX ( ALL ( Holidays ), FORMAT ( Holidays[Date], "yyyy-mm-dd" ), "," )
```

The measure must return the same list on every row, so it uses ALL. A holiday on a non-working weekday is not counted twice.

### Statuses

Each task's delay falls into one of three bands set under **Baseline variance**. Status 2's limit is never treated as lower than status 1's.

| Status | Default name | Default rule |
| --- | --- | --- |
| 1 | On track | Delay up to 0 days |
| 2 | At risk | Delay over 0, up to 10 days |
| 3 | Late | Delay over 10 days |

The same bands drive the variance icons and the legend.

### Group roll-ups

Each group row summarises every task inside it, including tasks in sub-groups, whether they are visible or not.

| Group value | How it is worked out |
| --- | --- |
| Planned start | Earliest planned start |
| Planned finish | Latest planned finish |
| Baseline start / finish | Earliest baseline start / latest baseline finish |
| Baseline variance and status | Group planned finish against group baseline finish |
| Percent complete | Average weighted by each task's planned duration in days (at least 1 day); tasks without a value are left out |
| Total float | Lowest float in the group |

### Critical tasks

A task is critical when **Total float (days)** is zero or less. It gets a red flag just after its bar or milestone, and the legend shows the flag as Critical. The visual reads float from your data and does not calculate a critical path itself.

### Timeline range and scale

- The timeline runs from the earliest to the latest baseline or planned date, plus 2% padding at each end.
- Its width is a percentage of the visual, at least 240 px.
- **Auto** scale picks the finest unit (days, weeks, months, quarters, years) whose ticks are at least 36 px apart. Weeks start on Monday.
- A year or month row sits above the main unit, and labels only show when they fit in their band.

### Logic checks

The Predecessors and Successors cells are split on the list delimiter (default comma), plus semicolons and line breaks. IDs are matched as text, ignoring case by default. Invisible characters from Excel, such as non-breaking spaces, are removed first.

| Severity | What it reports |
| --- | --- |
| Error | Duplicate Task ID, blank Task ID, a task listing itself, circular logic |
| Warning | An ID that does not exist, a link only one side lists, an ID that arrived as a number |
| Note | No predecessor (open start), no successor (open end), an ID listed twice in one cell |

Open-end notes only appear once at least one link exists. Every link is read as finish-to-start with zero lag.

### Logic trace

Selecting a task shows it with its linked tasks. **Direct links only** (default) shows the IDs in that task's own Predecessors and Successors cells, plus the links other tasks declare to it. **Full chain** follows predecessors back and successors forward until the chain ends. Circular logic never loops.

## Using the visual

The visual has four areas from top to bottom: the menu and legend, the logic check line, the schedule grid with its timeline, and a footnote saying how variance is counted.

### Reading the chart

| Mark | Meaning |
| --- | --- |
| Navy bar | Planned dates, from planned start to planned finish |
| Blue fill from the left | Completed share of the task (Percent complete) |
| Thin grey bar underneath | Baseline dates |
| Red flag after the bar | Critical task (total float of zero or less) |
| Diamond | Milestone; a lighter diamond after the cut-off when the split option is on |
| Magenta vertical line | Report cut-off date, or today |
| Black bar with end caps | Group row, spanning its tasks |
| Footnote under the chart | That variance compares planned finish with baseline finish, whether it is in calendar or working days, and whether bank holidays are excluded |

### Tooltips

Hover over a row, or move keyboard focus to it, to see every bound field: dates with (actual) where they fall on or before the cut-off, variance, percent complete, float, links, Columns fields and Tooltips fields. Group rows show their roll-ups. Press Escape to hide a tooltip.

### Menu

Select **☰ Menu** at the top right to open:

- **Table view:** shows every field as a column and hides the timeline. A tick shows when it is on.
- **Expand all / Collapse all:** opens or closes every group.
- **Show all tasks:** clears a logic trace.
- **Go to cut-off date** (or **Go to today** when no cut-off field is bound): scrolls the timeline so the line is centred, then scrolls to the first task in progress on that date, or the next to start, and gives it keyboard focus. The move is announced to screen readers.
- **Time scale:** Whole timeline (default) fits the full schedule in the timeline width. Days, Weeks, Months, Quarters or Years give each unit a fixed width, so the timeline extends, scrolls sideways and opens on the cut-off. A tick marks the current choice. It is a viewer choice, not saved in the report, so a report always opens on Whole timeline.

### Groups

Select the **⊟ / ⊞** box on a group row to collapse or expand it.

### Logic trace

Select a task, or press Enter on it, to show only that task and its linked tasks inside their groups. Each row is labelled Traced, Predecessor or Successor, and a bar at the top gives the counts with a **Show all** button. Select the task again to go back.

### Logic check line

The line under the legend summarises the logic checks, for example 0 errors, 0 warnings, 3 notes. Select it to open the list of issues with their data row numbers.

### Keyboard

The grid is one tab stop. Tab and Escape are never captured, so focus can always leave the visual.

| Key | Action |
| --- | --- |
| Up / Down arrow | Previous / next row |
| Page Up / Page Down | Up / down 10 rows |
| Home / End | First / last row |
| Right arrow | Expand a collapsed group, or move into an open one |
| Left arrow | Collapse an open group, or move to the parent group |
| Enter or Space | Expand or collapse a group; trace a task |
| Escape | Hide the tooltip |

In the menu, Enter or Down arrow opens it, the arrow keys and Home and End move between items, Enter chooses, and Escape closes it and returns to the button.

### Focus mode

Use Power BI's **Focus mode** icon in the visual header to fill the page, and **Back to report** to return.

## Format pane reference

Sections appear in this order under **Format visual**. A colour left empty is Automatic: the visual picks a theme colour that meets contrast. In Windows high contrast mode, custom colours are replaced by the system colours.

### Text

| Setting | Default | What it does |
| --- | --- | --- |
| Font | Verdana, 18 pt | Font and size of the grid text. Rows grow so the text is never clipped |
| Text colour | Automatic | Grid text colour |
| Header text colour | Automatic | Column header text |
| Header background | Automatic | Column header background |

### Grid columns

Switches each built-in column off to save space. Hidden fields still drive the bars, statuses and tooltip, and Table view always shows them.

| Setting | Default |
| --- | --- |
| Planned start | On |
| Planned finish | On |
| Baseline variance | On |
| Percent complete | On |
| Total float | On |

### Rows

| Setting | Default | What it does |
| --- | --- | --- |
| Group rows | Automatic | Background of group rows; the outer level is strongest, deeper levels lighter |
| Banded rows | Off | Shades every second row |
| Band colour | Automatic | Colour of banded rows |
| Row lines | Automatic | Colour of the lines between rows |

### Bars

| Setting | Default | What it does |
| --- | --- | --- |
| Planned | Navy #12239E | Planned bar colour |
| Split planned bar at cut-off | Off | Draws the part after the cut-off in a second colour |
| Planned after cut-off | Automatic | Colour after the cut-off when the split is on |
| Baseline | Grey #8A8886 | Baseline bar colour |
| Progress | Blue #118DFF | Completed share colour |
| Critical flag | Red #C4314B | Colour of the flag on critical tasks |
| Rounded bars | On | Rounds bar ends |
| Show baseline | On | Shows the thin baseline bar |
| Show progress | On | Shows the completed share |
| Bar thickness (% of row) | 45 | 20 to 80% of the row height |

### Timeline

| Setting | Default | What it does |
| --- | --- | --- |
| Time scale | Auto | Auto, Days, Weeks, Months, Quarters or Years for the Whole timeline view; viewers can also pick a scale from the Menu |
| Width (% of visual) | 50 | 20 to 85% of the visual width, at least 240 px |
| Gridlines | On | Vertical lines at each time unit |
| Gridline colour | Automatic | Colour of those lines |
| Scroll to cut-off on load | On | Scrolls the timeline so the cut-off is in view |

### Cut-off line

| Setting | Default | What it does |
| --- | --- | --- |
| Show | On | Shows the cut-off line |
| Without a cut-off measure | Use today | Use today or hide the line when no cut-off field is bound |
| Line colour | Magenta #B4009E | Line colour |
| Line width | 2 | 1 to 6 px |

### Milestones

| Setting | Default | What it does |
| --- | --- | --- |
| Milestone when Item type contains | Milestone | Word that marks a milestone, ignoring case |
| Place marker at | Auto | Auto (finish date for Finish Milestone types), Planned start or Planned finish |
| Marker colour | Sienna #A0522D | Diamond colour |
| Marker size | 14 | 8 to 24 px |

### Baseline variance

| Setting | Default | What it does |
| --- | --- | --- |
| Show status | On | Shows status icons in the variance column and the legend |
| Status 1 name / delay up to (days) / colour | On track / 0 / green | First band; a negative limit means days early |
| Status 2 name / delay up to (days) / colour | At risk / 10 / amber | Second band, above status 1 |
| Status 3 name / colour | Late / red | Any delay over the status 2 limit |
| Display | Icon and days | Icon and days, Icon only, Days only or Coloured days |
| Icon set | Shapes | Shapes (circle, triangle, octagon), Symbols (tick, exclamation, cross) or Dots |
| Show in legend | On | Lists the status bands in the legend |

### Working days

| Setting | Default | What it does |
| --- | --- | --- |
| Count delay in | Calendar days | Calendar days, or Working days |
| Non-working: Monday to Sunday | Saturday and Sunday on | One switch per weekday; on means not worked |
| Holidays | Empty | Dates separated by commas, such as 2026-12-25, 2026-12-28; added to any Holidays measure |

### Legend

| Setting | Default | What it does |
| --- | --- | --- |
| Show | On | Shows the legend |
| Font | Verdana | Legend font |
| Text size | 18 | 6 to 40 pt |
| Text colour | Automatic | Legend text colour |
| Alignment | Left | Left, centre or right |

### Axis

| Setting | Default | What it does |
| --- | --- | --- |
| Font | Verdana | Axis label font |
| Text size | 18 | 6 to 40 pt; the axis rows grow with it |
| Text colour | Automatic | Axis label colour |
| Bold | On | Bold axis labels |
| Show year row | On | Shows the year or month row above the main unit |

### Layout

| Setting | Default | What it does |
| --- | --- | --- |
| Padding around visual (px) | 4 | 0 to 48 |
| Cell padding (px) | 8 | 2 to 32 |
| Indent per level (px) | 16 | Indent for each group level |
| Space between legend items (px) | 16 | 4 to 48 |
| Space between legend and chart (px) | 12 | 0 to 64 |
| Space above menu (px) | 0 | 0 to 48; 0 puts the Menu button at the top of the visual, just under the Power BI title |

### User Menu

Formats the menu button, the logic check line, the logic trace bar and the footnote under the chart.

| Setting | Default | What it does |
| --- | --- | --- |
| Show | On | Shows the menu |
| Table view option | On | Lists Table view in the menu |
| Expand all and Collapse all options | On | Lists both options when groups are used |
| Time scale options | On | Lists Whole timeline, Days, Weeks, Months, Quarters and Years |
| Go to cut-off or today option | On | Lists Go to cut-off date, or Go to today without a cut-off field |
| Font | Verdana | Font |
| Text size | 12 | 6 to 40 pt |
| Text colour | Automatic | Text colour |

### Logic trace

| Setting | Default | What it does |
| --- | --- | --- |
| Click a task to trace its logic | On | Turns tracing on or off |
| Show | Direct links only | Direct links only, or Full chain of predecessors and successors |
| Show Predecessors and Successors columns | On | Hides the two columns while keeping the links working |

### ID parsing

| Setting | Default | What it does |
| --- | --- | --- |
| List delimiter | , | Separator between IDs; semicolons and line breaks always work too |
| Case-sensitive IDs | Off | When on, a100 and A100 are different tasks |

### Row height and checks

| Setting | Default | What it does |
| --- | --- | --- |
| Row height | 40 | 24 to 120 px; grows further for large text |
| Show Task ID column | On | When off, the task name leads the grid |
| Show logic checks | On | Shows the logic check line |

### About

Read-only: the version number, Created by: Data Tides, and Copyright: © 2026 Data Tides.

## Accessibility

The visual targets WCAG 2.2 level AA for its own content. The Power BI page around it is Microsoft's responsibility.

| WCAG criterion | How the visual meets it |
| --- | --- |
| 1.1.1, 1.3.1 Text alternatives, structure | The schedule is a grid, or a tree grid with groups, with row and column headers. The timeline drawing is hidden from screen readers because every fact is also in a cell or the tooltip |
| 1.4.1 Use of colour | Meaning is carried by shape and text as well as colour: diamonds, flags, icon shapes, and the status name in text |
| 1.4.3, 1.4.11 Contrast | Automatic colours are chosen to reach 3:1 for graphics and 4.5:1 for text. Custom colours below that are listed as design notes in the logic checks |
| 1.4.13 Content on hover or focus | Tooltips use Power BI's tooltip service and can be dismissed with Escape |
| 2.1.1, 2.1.2 Keyboard, no trap | Everything works by keyboard; Tab and Escape always leave the visual |
| 2.4.7, 2.4.11 Focus visible, not obscured | A 3 px focus ring, and focused rows stay clear of the sticky header and frozen column |
| 2.5.7 Dragging | Nothing needs a drag |
| 2.5.8 Target size | Rows, group toggles and menu items are at least 24 by 24 px |
| 4.1.2, 4.1.3 Name, role, value, status | Groups announce their level and whether they are expanded; trace and view changes are announced |

**What authors should check:**

- Keep the text names of statuses. With **Icon only** and **Dots**, status depends on colour alone, and the logic checks warn about it.
- Read the design notes after changing colours.
- Test with a screen reader such as NVDA or JAWS, the keyboard only, 200% zoom and Windows high contrast before publishing.

## Troubleshooting and FAQ

| Problem | Fix |
| --- | --- |
| The visual says Add a text Task ID field | Put a text column in **Task ID** |
| Dates show as year, quarter, month and day | Click the arrow next to the date field in the well and choose the column name, not Date Hierarchy |
| IDs lose leading zeros or links do not match | Set Task ID, Predecessors and Successors to **Text** in Power Query |
| No progress on the bars | Put a field in **Percent complete**. The logic checks add a note when Show progress is on but the well is empty |
| No cut-off line | Bind **Report cut-off date**, or set **Without a cut-off measure** to Use today. Today only shows when it falls inside the schedule |
| Rows disappear after adding a cut-off measure | The measure returns blank on some rows. Use REMOVEFILTERS so it returns the date on every row |
| Milestones show as bars | Bind the type field to **Item or activity type** and check the word under **Milestones > Milestone when Item type contains** |
| A setting seems to do nothing | Check **About > Version**. If it shows an older number, import the latest `.pbiviz` again |
| Show as a table looks unformatted | That view is drawn by Power BI for custom visuals and cannot be styled. Use **Menu > Table view** instead |
| Status counts look wrong | Check the day limits under **Baseline variance**; delay is planned finish minus baseline finish, in calendar or working days as set under Working days |

**Why are group dates different from what I expected?** Group dates are the earliest start and latest finish of every task in the group, including collapsed or hidden ones. See Group roll-ups.

**What does a note in the logic checks mean?** Notes flag open ends, such as a first task with no predecessor. They are normal at the start and end of a schedule.

## Limits and known gaps

| Area | Current behaviour |
| --- | --- |
| Rows | Up to 30,000 rows; larger schedules are cut by Power BI |
| Grouping | Up to 6 Group by levels; collapsed groups reopen when the report reloads |
| Links | Every link is finish-to-start with zero lag; SS, FF, SF and lags are not read |
| Critical path | Read from Total float; the visual does not calculate a critical path |
| Variance | Calendar days by default, or working days with a weekday pattern and holidays |
| Selection | Selecting a row does not cross-filter other visuals yet |
| Show as a table | Drawn by Power BI and cannot be styled; use Table view |
| Language | Labels are in English; dates follow the report's locale |
| Default title size | Power BI controls the visual title; use a report theme to set its font and size |
