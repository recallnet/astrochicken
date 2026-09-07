/**
 * Factory detail screen — tabs, detail table, summary card, inspector.
 */

import { Box, Text } from "ink";

import {
  compactRowTitle,
  daemonLabel,
  healthTone,
  padCell,
  renderMeter,
  rowCurrentSummary,
  rowRecentOutcomeCount,
  rowRecentSummary,
  shortHealthLabel,
  toNumber,
  trim,
  warningSummary,
} from "../format.ts";
import { buildFactoryDetailState } from "../state.ts";
import { DetailInspector } from "./inspector.ts";
import { Divider, ViewPill, h, useTerminalDimensions } from "./shared.ts";
import { InlineStatRow } from "./stat-row.ts";

function normalizeManagedReason(value: string = ""): string {
  const text = trim(value);
  if (text === "Loading live factory state…") return "";
  return text;
}

function isBugFastActive(detailSummary: Record<string, unknown> = {}): boolean {
  return detailSummary?.bug_gate && typeof detailSummary.bug_gate === "object"
    ? detailSummary.bug_gate.active === true
    : false;
}

function resolveDetailDaemon({
  row = {},
  detailSummary = {},
  activeRuns = 0,
}: {
  row?: Record<string, unknown>;
  detailSummary?: Record<string, unknown>;
  activeRuns?: number;
}): { label: string; tone: string } {
  const daemonHealth = row?.daemon_health as Record<string, unknown> | undefined;
  if (daemonHealth?.running === true) return { label: "running", tone: "green" };
  if (activeRuns > 0 || detailSummary?.current_tick || isBugFastActive(detailSummary)) {
    // @context:regression !critical The fleet detail screen must prefer the live dashboard summary
    // over the outer fleet snapshot. The snapshot can lag and still say daemon stopped while the
    // loaded factory dashboard proves an active supervisor tick or bug-fast review is running.
    return { label: "running", tone: "green" };
  }
  return {
    label: daemonLabel(row || {}),
    tone: daemonHealth?.running ? "green" : "red",
  };
}

interface TabEntry {
  id?: string;
  title?: string;
}

export function DetailTabStrip({ tabs = [], activeTab = "" }: { tabs?: TabEntry[]; activeTab?: string }): React.ReactElement {
  return h(
    Box,
    { marginBottom: 1 },
    ...tabs.map((tab, index) => h(ViewPill, {
      key: tab.id || String(index),
      title: trim(tab.title || tab.id || `Tab ${index + 1}`),
      selected: trim(tab.id) === trim(activeTab),
      index,
    })),
  );
}

interface DetailColumnWidths {
  kind: number;
  issue: number;
  title: number;
  status: number;
  step: number;
  age: number;
}

export function detailColumns(width: number = 110): DetailColumnWidths {
  const available = Math.max(70, width - 5);
  const kind = 12;
  const issue = 8;
  const status = 10;
  const step = 8;
  const age = 8;
  const title = Math.max(18, available - kind - issue - status - step - age);
  return { kind, issue, title, status, step, age };
}

export function DetailTableHeader({ width = 110 }: { width?: number }): React.ReactElement {
  const cols = detailColumns(width);
  const line = [
    "  ",
    padCell("KIND", cols.kind),
    " ",
    padCell("ISSUE", cols.issue),
    " ",
    padCell("TITLE", cols.title),
    " ",
    padCell("STATUS", cols.status),
    " ",
    padCell("STEP", cols.step),
    " ",
    padCell("AGE", cols.age),
  ].join("");
  return h(Text, { color: "cyan", bold: true }, line);
}

export function CompactDetailListRow({ entry = {}, selected = false, width = 110 }: { entry?: Record<string, unknown>; selected?: boolean; width?: number }): React.ReactElement {
  const cols = detailColumns(width);
  const line = [
    selected ? "› " : "  ",
    padCell(trim(entry.kind).replace(/_/g, " "), cols.kind),
    " ",
    padCell(trim(entry.issue), cols.issue),
    " ",
    padCell(compactRowTitle(entry), cols.title),
    " ",
    padCell(trim(entry.status), cols.status),
    " ",
    padCell(trim(entry.progress_label), cols.step),
    " ",
    padCell(trim(entry.updated_age), cols.age),
  ].join("");
  return h(Text, {
    color: selected ? "cyan" : "white",
    bold: selected,
  }, line);
}

export function SummaryCard({ row = {}, snapshot = {}, width = 120 }: { row?: Record<string, unknown>; snapshot?: Record<string, unknown>; width?: number }): React.ReactElement {
  const recentCount = rowRecentOutcomeCount(row);
  const tone = healthTone(row.health);
  const attention = warningSummary(snapshot, row);

  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "single",
      borderColor: tone.color,
      paddingX: 1,
      marginBottom: 1,
    },
    h(Text, { color: tone.color, bold: true },
      `${trim(row.factory_id)} · ${shortHealthLabel(row.health)} · ${trim(row.release_state || "unknown")}`),
    h(Text, { color: "gray", wrap: "truncate-end" },
      trim(row.target_repo || "(unknown repo)")),
    h(Text, { color: "white", wrap: "truncate-end" },
      `Work     ${rowCurrentSummary(row)}`),
    h(Text, { color: "cyan", wrap: "truncate-end" },
      `Recent   ${rowRecentSummary(row)} (${recentCount} runs)  ${renderMeter(Math.min(8, recentCount))}`),
    h(Text, {
      color: attention ? "yellow" : "green",
      wrap: "truncate-end",
    }, `Attention  ${attention || "no operator warnings"}`),
  );
}

export function FactoryDetailScreen({ snapshot = {}, uiState = {}, busyLabel = "" }: { snapshot?: Record<string, unknown>; uiState?: Record<string, unknown>; busyLabel?: string }): React.ReactElement {
  const computed = uiState._computed as Record<string, unknown> | undefined;
  const row = (computed?.selectedRow as Record<string, unknown>) || null;
  const detail = buildFactoryDetailState(uiState.detailDashboard || {}, uiState);
  const detailSummary = (uiState.detailDashboard as Record<string, unknown>)?.summary as Record<string, unknown> || {};
  const [columns = 120] = useTerminalDimensions();
  const shellWidth = Math.max(90, columns - 4);
  const note = row ? warningSummary(snapshot, row) : "";
  const inspectorNote = detail.selectedRow
    ? note
    : trim((detail.activeTabEntry as Record<string, unknown>)?.empty_message || note || "No rows.");
  const recentCount = row ? rowRecentOutcomeCount(row) : 0;
  const displayHealth = trim(detailSummary.health || row?.health || "healthy");
  const activeRows = detail.rows.filter((entry: Record<string, unknown>) => ["running", "in_flight", "stalled", "blocked"].includes(trim(entry?.status || "").toLowerCase()));
  const activeRuns = Math.max(activeRows.length, toNumber(detailSummary.active_runs, 0));
  const activeGoals = toNumber(detailSummary.active_goals, 0);
  const activeIssues = toNumber(detailSummary.active_goal_issues, 0);
  const bugGate = detailSummary?.bug_gate && typeof detailSummary.bug_gate === "object"
    ? detailSummary.bug_gate as Record<string, unknown>
    : {};
  const bugFastActive = bugGate.active === true;
  const bugRefs = Array.isArray(bugGate.open_bug_refs)
    ? bugGate.open_bug_refs.map((entry) => trim(String(entry))).filter(Boolean)
    : [];
  const workSummary = activeRuns > 0
    ? [
        `${activeRuns} active run${activeRuns === 1 ? "" : "s"}`,
        activeGoals > 0 ? `${activeGoals} goal${activeGoals === 1 ? "" : "s"}` : "",
        activeIssues > 0 ? `${activeIssues} issue${activeIssues === 1 ? "" : "s"}` : "",
        bugFastActive ? "bug-fast review" : "",
        bugFastActive ? "goal admission paused" : "",
      ].filter(Boolean).join("  ·  ")
    : (row ? rowCurrentSummary(row) : "no active work");
  const recentSummary = row ? rowRecentSummary(row) : "no recent work";
  const managedState = row?.managed_state as Record<string, unknown> | undefined;
  const managedReason = normalizeManagedReason(String(managedState?.reason || ""));
  const detailFactoryCtx = uiState.detailFactoryContext as Record<string, unknown> | undefined;
  const derivedDaemon = resolveDetailDaemon({ row, detailSummary, activeRuns });
  const postureBits = [
    `health ${shortHealthLabel(displayHealth) || "unknown"}`,
    trim(row?.release_state || "") ? `release ${trim(row?.release_state)}` : "",
    bugFastActive ? `mode ${trim(String(bugGate.mode || "bug-fast"))}` : "",
    bugFastActive ? `admission ${trim(String(bugGate.admission || "paused_for_bug_review"))}` : "",
    managedReason ? managedReason : "",
  ].filter(Boolean).join("  ·  ");

  return h(
    Box,
    { paddingX: 1 },
    h(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: row ? healthTone(row.health).color : "cyan",
        paddingX: 1,
      },
      h(
        Box,
        { justifyContent: "space-between", marginBottom: 1 },
        h(
          Box,
          null,
          h(Text, { color: "black", backgroundColor: healthTone(displayHealth || "healthy").color, bold: true }, ` ${shortHealthLabel(displayHealth || "healthy").toUpperCase()} `),
          h(Text, { color: "white", bold: true }, `  ${trim(row?.factory_id || detailFactoryCtx?.factory_id || "factory")}`),
          h(Text, { color: "gray" }, `  Fleet / ${trim((detail.activeTabEntry as Record<string, unknown>)?.title || "Now")}`),
        ),
        h(
          Box,
          null,
          busyLabel ? h(Text, { color: "yellow" }, busyLabel) : null,
          busyLabel ? h(Text, { color: "gray" }, "  ") : null,
          h(Text, { color: "gray" }, trim(row?.target_repo || detailFactoryCtx?.target_repo || "")),
          h(Text, { color: "gray" }, "  "),
          h(Text, { color: "white", bold: true }, trim(snapshot.generated_at).slice(11, 16)),
        ),
      ),
      h(InlineStatRow, {
        stats: [
          { label: "Health", value: shortHealthLabel(displayHealth || ""), tone: healthTone(displayHealth || "").color },
          { label: "Daemon", value: derivedDaemon.label, tone: derivedDaemon.tone },
          { label: "Rows", value: String(detail.rows.length), tone: detail.rows.length > 0 ? "cyan" : "gray" },
          { label: "Recent", value: String(recentCount), tone: "yellow", meter: renderMeter(Math.min(8, recentCount)) },
        ],
      }),
      h(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        h(Text, { color: "white", wrap: "truncate-end" }, `Posture  ${postureBits || "unknown"}`),
        h(Text, { color: "white", wrap: "truncate-end" }, `Active   ${workSummary}`),
        ...(bugFastActive && bugRefs.length > 0
          ? [h(Text, { color: "yellow", wrap: "truncate-end" }, `Blockers  ${bugRefs.join("  ")}`)]
          : []),
        h(Text, { color: "cyan", wrap: "truncate-end" }, `Recent   ${recentSummary}`),
        h(Text, { color: note ? "yellow" : "green", wrap: "truncate-end" }, `Attention  ${note || "none"}`),
      ),
      h(DetailTabStrip, { tabs: detail.tabs, activeTab: detail.activeTab }),
      h(Divider, { color: "gray", width: shellWidth - 4 }),
      detail.rows.length === 0
        ? h(Box, { marginBottom: 1 }, h(Text, { color: "gray" }, trim((detail.activeTabEntry as Record<string, unknown>)?.empty_message || "No rows.")))
        : h(
          Box,
          { flexDirection: "column", marginBottom: 1 },
          h(DetailTableHeader, { key: "header", width: shellWidth - 4 }),
          h(Divider, { key: "divider", color: "gray", width: shellWidth - 6 }),
          ...detail.rows.map((entry: Record<string, unknown>, index: number) => h(CompactDetailListRow, {
            key: (entry.id as string) || String(index),
            entry,
            selected: index === detail.selectedIndex,
            width: shellWidth - 4,
          })),
        ),
      h(Divider, { color: "gray", width: shellWidth - 4 }),
      h(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        h(DetailInspector, { row: detail.selectedRow, note: inspectorNote }),
      ),
      h(Text, { color: "gray", dimColor: true }, "esc back · tab/h/l tabs · j/k move · enter live session · r refresh · q quit"),
    ),
  );
}
