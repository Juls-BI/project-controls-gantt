# Project Controls Gantt
[![Latest release](https://img.shields.io/github/v/release/Juls-BI/project-controls-gantt?style=flat&label=release)](https://github.com/Juls-BI/project-controls-gantt/releases/latest)
![Power BI](https://img.shields.io/badge/Power%20BI-custom%20visual-F2C811?style=flat&logo=powerbi&logoColor=black)
![API 5.11.1](https://img.shields.io/badge/visuals%20API-5.11.1-0078D4?style=flat)
![WCAG 2.2 AA](https://img.shields.io/badge/WCAG-2.2%20AA-2E7D32?style=flat)
![Tests](https://img.shields.io/badge/tests-26%20passing-2E7D32?style=flat)
[![License: MIT](https://img.shields.io/github/license/Juls-BI/project-controls-gantt?style=flat)](LICENSE)

A free custom visual for Microsoft Power BI that turns a project schedule into an accessible Gantt chart, with baselines, progress, a reporting cut-off line and predecessor and successor logic checks.

![Project Controls Gantt showing a grouped schedule with baseline, planned and progress bars, a cut-off line and a baseline variance column](docs/images/gantt-chart.png)

**[Download the latest version](https://github.com/Juls-BI/project-controls-gantt/releases/latest)** · [User manual](docs/user-manual.md) · [Get help](https://github.com/Juls-BI/project-controls-gantt/issues) · [Privacy policy](https://juls-bi.github.io/project-controls-gantt/privacy.html)

## Features

- **Baselines:** a baseline bar under every task, and a variance column with On track, At risk and Late statuses.
- **Progress:** the completed share of each task fills its bar.
- **Cut-off date:** a line for the data date. Planned dates before it count as actuals.
- **Milestones without DAX:** any activity type containing "Milestone" becomes a diamond.
- **Logic checks:** finds missing and broken predecessor and successor links. Select a task to trace its links.
- **Grouping:** up to 6 collapsible levels, such as WBS area then discipline.
- **Accessible:** a real grid that works with the keyboard and screen readers, built to WCAG 2.2 AA.
- **Scale:** up to 30,000 rows.

## Get started

### 1. Download

Go to the [latest release](https://github.com/Juls-BI/project-controls-gantt/releases/latest) and download:

| File | What it is |
| --- | --- |
| `projectControlsGantt….pbiviz` | The visual. You need this. |
| `ProjectControlsGantt-Sample.pbix` | A sample report with demo data, to see the visual working before you use your own data. Also in the [sample](sample/) folder. |

### 2. Try the sample report

Open `ProjectControlsGantt-Sample.pbix` in Power BI Desktop. The **How to use** page explains the chart, and the **Schedule** page has the Gantt chart with a made-up substation upgrade project.

### 3. Add the visual to your own report

1. In Power BI Desktop, open the **Visualizations** pane.
2. Select **⋯** (Get more visuals), then **Import a visual from a file**.
3. Choose the `.pbiviz` file you downloaded.
4. Select the new Project Controls Gantt icon to add it to the page.

In the Power BI Service, do the same while editing a report.

If the import is blocked, your organization may only allow visuals from AppSource. Ask your Power BI admin about the tenant setting **Allow visuals created using the Power BI SDK**.

### 4. Add your data

You need one table with one row per task and a unique text Task ID. Every other field is optional.

| Field | What to put in it |
| --- | --- |
| Task ID | A unique ID for each task, as text |
| Task name | The task or activity name |
| Item or activity type | For example Task or Milestone |
| Planned start / Planned finish | Current dates |
| Baseline start / Baseline finish | Approved baseline dates |
| Percent complete | 0 to 1 or 0 to 100 |
| Predecessors / Successors | Comma-separated Task IDs |
| Total float (days) | Zero or less marks a task critical |
| Group by | Up to 6 fields, outermost first |
| Report cut-off date | A data date column, or a measure that returns one date |

Two tips:

- Set Task ID, Predecessors and Successors to **Text** in Power Query, so IDs such as 007 keep their leading zeros.
- If Power BI adds a date as a **Date Hierarchy**, select the arrow next to it in the field well and choose the column name instead.

The [user manual](docs/user-manual.md) covers every field, setting and calculation.

## Updating

Download the new `.pbiviz` from [Releases](https://github.com/Juls-BI/project-controls-gantt/releases) and import it again. It replaces the old version in that report. Check the version under **Format > About > Version**.

## Get help

- **Report a problem or ask a question:** [open an issue](https://github.com/Juls-BI/project-controls-gantt/issues/new/choose).
- **Suggest a feature:** open an issue and choose "Feature request".

Please check the [existing issues](https://github.com/Juls-BI/project-controls-gantt/issues) first. Issues are public, so do not include confidential data, passwords or personal information. Use made-up data in screenshots.

## Privacy

The visual does not collect, store or send any data. It makes no network requests. Read the [privacy policy](https://juls-bi.github.io/project-controls-gantt/privacy.html).

## See also

[Power BI Gantt Visual (Preview): Sample and Workarounds](https://github.com/Juls-BI/power-bi-gantt-preview) has a sample report and DAX workarounds for Microsoft's built-in Gantt visual (preview), and lists the gaps this visual was built to fill.

## Build from source

You only need this if you want to change the visual. To use it, download the `.pbiviz` from Releases instead.

Requirements:

- Node.js 24 or later (built with 24.19.0)
- Power BI visuals tools 7.2.1: `npm install -g powerbi-visuals-tools@7.2.1`

```
npm install
npm run lint
npm test
npm run package
```

The package is written to `dist/projectControlsGantt533F7863925E4967BA9EBE53CB69B1E6.<version>.pbiviz`. To run the visual in developer mode, use `npm start` and turn on the developer visual in Power BI.

| Folder | What is in it |
| --- | --- |
| `src/` | Visual code (`visual.ts` is the entry point) |
| `test/` | Unit tests, run with Node's built-in test runner |
| `style/` | Styles |
| `docs/` | User manual, privacy policy and the GitHub Pages site |
| `sample/` | Sample report |
| `capabilities.json` | Data roles and formatting options |
| `pbiviz.json` | Visual metadata and version |

When the version changes, update it in both `pbiviz.json` and `VISUAL_VERSION` in `src/settings.ts`, so **Format > About** shows the right number.

## License

[MIT](LICENSE). Created by Juliana Smith, Data Tides. © 2026 Data Tides.
