/**
 * Detail inspector — shows selected row details.
 */

import { Box, Text } from "ink";

import {
  compactRowTitle,
  formatDetailMeta,
  normalizeRowDetail,
  trim,
} from "../format.ts";
import { StatusChip, h } from "./shared.ts";

export function DetailInspector({ row = null, note = "" }: { row?: Record<string, unknown> | null; note?: string }): React.ReactElement {
  const detailLines = normalizeRowDetail(row);
  if (!row) {
    return h(Text, { color: "gray" }, trim(note || "No row selected."));
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "cyan", bold: true, wrap: "truncate-end" }, compactRowTitle(row)),
    h(Text, { color: "gray", wrap: "truncate-end" }, formatDetailMeta(row)),
    h(Box, { marginTop: 1 }),
    h(Text, { color: "gray", bold: true }, "Summary"),
    h(Text, { color: "white", wrap: "wrap" }, trim(row.summary || "No summary.")),
    detailLines.length > 0 ? h(Box, { marginTop: 1 }) : null,
    detailLines.length > 0 ? h(Text, { color: "gray", bold: true }, "Detail") : null,
    ...detailLines.slice(0, 8).map((entry: string, index: number) => h(Text, { key: `detail-${index}`, color: "white", wrap: "truncate-end" }, `• ${entry}`)),
    trim(row.progress_label) ? h(Box, { marginTop: 1 }, h(StatusChip, { label: `step ${trim(row.progress_label)}`, color: "cyan" })) : null,
    note ? h(Box, { marginTop: 1 }, h(Text, { color: "yellow" }, note)) : null,
    (row?.refs as Record<string, unknown>)?.live_attachable ? h(Box, { marginTop: 1 }, h(Text, { color: "green" }, "enter opens live session")) : null,
  );
}
