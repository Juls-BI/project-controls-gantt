// Keep in step with dataReductionAlgorithm.window.count in capabilities.json.
export const ROW_LIMIT = 30000;

// Power BI sets a segment on the metadata when it holds back rows past the window.
export function rowLimitWarning(rowCount: number, hasMoreRows: boolean): string | null {
    if (!hasMoreRows && rowCount < ROW_LIMIT) {
        return null;
    }
    const limit = ROW_LIMIT.toLocaleString("en-GB");
    return "Power BI sent only the first " + limit + " rows, so some tasks are missing. Filter the report, for example with a slicer, to show " + limit + " tasks or fewer.";
}
