/**
 * Fleet table — header and single-line row components.
 */

import { Box, Text } from "ink";

import {
  daemonLabel,
  healthGlyph,
  padCell,
  rowCurrentSummary,
  rowRecentSummary,
  shortHealthLabel,
  trim,
} from "../format.ts";
import { h } from "./shared.ts";

interface ColumnWidths {
  glyph: number;
  factory: number;
  health: number;
  daemon: number;
  work: number;
  recent: number;
}

export function fleetRowColumns(columns: number = 120): ColumnWidths {
  const available = Math.max(60, columns - 5);
  const glyph = 2;
  const factory = Math.max(12, Math.min(18, Math.floor(available * 0.18)));
  const health = Math.max(8, Math.min(10, Math.floor(available * 0.10)));
  const daemon = 6;
  const recent = Math.max(14, Math.min(22, Math.floor(available * 0.18)));
  const work = Math.max(18, available - glyph - factory - health - daemon - recent);
  return { glyph, factory, health, daemon, work, recent };
}

export function FactoryTableHeader({ width = 100 }: { width?: number }): React.ReactElement {
  const cols = fleetRowColumns(width);
  const line = [
    "  ",
    padCell("FACTORY", cols.factory),
    " ",
    padCell("HEALTH", cols.health),
    " ",
    padCell("DAEMON", cols.daemon),
    " ",
    padCell("WORK", cols.work),
    " ",
    padCell("RECENT", cols.recent),
  ].join("");
  return h(Text, { color: "cyan", bold: true }, line);
}

export function FactoryTableRow({ row = {}, selected = false, width = 100 }: { row?: Record<string, unknown>; selected?: boolean; width?: number }): React.ReactElement {
  const cols = fleetRowColumns(width);
  const marker = healthGlyph(row.health);
  const line = [
    `${marker.glyph} `,
    padCell(trim(row.factory_id), cols.factory),
    " ",
    padCell(shortHealthLabel(row.health), cols.health),
    " ",
    padCell(daemonLabel(row) === "running" ? "run" : "stop", cols.daemon),
    " ",
    padCell(rowCurrentSummary(row), cols.work),
    " ",
    padCell(rowRecentSummary(row), cols.recent),
  ].join("");
  return h(Text, {
    color: selected ? undefined : marker.color,
    inverse: selected,
    bold: selected,
    wrap: "truncate-end",
  }, line);
}
