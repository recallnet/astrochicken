/**
 * InlineStatRow — single-line stat display replacing bordered StatBox.
 */

import { Box, Text } from "ink";

import { h } from "./shared.ts";

interface StatEntry {
  label?: string;
  value?: unknown;
  tone?: string;
  glyph?: string;
  meter?: string;
}

export function InlineStatRow({ stats = [] }: { stats?: StatEntry[] }): React.ReactElement {
  return h(
    Box,
    { marginBottom: 1 },
    ...stats.map((stat, index) =>
      h(Box, { key: stat.label || String(index), marginRight: 2 },
        stat.glyph ? h(Text, { color: stat.tone || "white" }, `${stat.glyph}`) : null,
        h(Text, { color: stat.tone || "white", bold: true }, `${stat.label} `),
        h(Text, { color: stat.tone || "white", bold: true }, String(stat.value)),
        stat.meter ? h(Text, { color: "gray" }, ` ${stat.meter}`) : null,
      ),
    ),
  );
}
