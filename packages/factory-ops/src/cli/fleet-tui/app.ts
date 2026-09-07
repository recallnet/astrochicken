/**
 * Main fleet TUI app component and fleet screen.
 */

import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { FactoryDetailScreen, SummaryCard } from "./components/detail-screen.ts";
import { FactoryTableHeader, FactoryTableRow } from "./components/fleet-table.ts";
import { Divider, ViewPill, h, useTerminalDimensions } from "./components/shared.ts";
import { InlineStatRow } from "./components/stat-row.ts";
import {
  availableViews,
  healthTone,
  renderMeter,
  rowCurrentSummary,
  rowRecentSummary,
  shortHealthLabel,
  toNumber,
  topSummary,
  trim,
  warningSummary,
} from "./format.ts";
import {
  buildFleetTuiState,
  normalizeFleetTuiRefreshMs,
  reduceFleetTuiKeypress,
  visibleRows,
} from "./state.ts";

function FleetScreen({ snapshot = {}, uiState = {}, busyLabel = "" }) {
  const current = uiState._computed || buildFleetTuiState(snapshot, uiState);
  const summary = topSummary(snapshot);
  const selected = current.selectedRow;
  const host = trim(process.env.HOSTNAME || process.env.HOST || "");
  const generated = trim(snapshot.generated_at);
  const [columns = 120] = useTerminalDimensions();
  const shellWidth = Math.max(90, columns - 4);

  return h(
    Box,
    { paddingX: 1 },
    h(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: "cyan",
        paddingX: 1,
      },
      h(
        Box,
        { justifyContent: "space-between", marginBottom: 1 },
        h(
          Box,
          null,
          h(Text, { color: "black", backgroundColor: "cyan", bold: true }, " HATCH OPS "),
          h(Text, { color: "gray" }, "  Fleet control room"),
        ),
        h(
          Box,
          null,
          busyLabel ? h(Text, { color: "yellow" }, busyLabel) : null,
          busyLabel ? h(Text, { color: "gray" }, "  ") : null,
          h(Text, { color: "gray" }, host || "local host"),
          h(Text, { color: "gray" }, "  "),
          h(Text, { color: "white", bold: true }, generated ? generated.slice(11, 16) : ""),
        ),
      ),
      h(InlineStatRow, {
        stats: [
          { label: "Factories", value: String(summary.total), tone: "cyan" },
          { glyph: "●", label: "Running", value: String(summary.running), tone: "green" },
          { glyph: "▲", label: "Unhealthy", value: String(summary.unhealthy), tone: summary.unhealthy > 0 ? "red" : "gray" },
          { glyph: "◆", label: "Recent", value: String(summary.recent), tone: "yellow", meter: renderMeter(Math.min(8, summary.recent)) },
        ],
      }),
      h(
        Box,
        { justifyContent: "space-between", marginBottom: 1 },
        h(
          Box,
          null,
          ...availableViews().map((view, index) => h(ViewPill, {
            key: view.id,
            title: view.title,
            selected: current.activeView === view.id,
            index,
          })),
        ),
        h(Text, { color: "gray" }, current.searchQuery ? `search · ${current.searchQuery}` : "search · none"),
      ),
      h(Divider, { color: "gray", width: shellWidth - 4 }),
      h(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        h(FactoryTableHeader, { key: "header", width: shellWidth - 4 }),
        h(Divider, { key: "divider", color: "gray", width: shellWidth - 6 }),
        current.rows.length === 0
          ? h(Text, { key: "empty", color: "gray" }, "No factories match the current filter.")
          : current.rows.map((row, index) => h(FactoryTableRow, {
            key: row.factory_id,
            row,
            selected: index === current.selectedIndex,
            width: shellWidth - 4,
          })),
      ),
      selected
        ? h(SummaryCard, { row: selected, snapshot, width: shellWidth - 4 })
        : null,
      uiState.searchMode
        ? h(
          Box,
          { marginBottom: 1 },
          h(Text, { color: "yellow", bold: true }, "Search  "),
          h(TextInput, {
            value: current.searchQuery,
            placeholder: "filter factories",
            focus: true,
            onChange: (value) => {
              uiState.onSearchChange?.(value);
            },
            onSubmit: () => {
              uiState.onSearchSubmit?.();
            },
          }),
        )
        : null,
      h(Text, { color: uiState.searchMode ? "yellow" : "gray", dimColor: !uiState.searchMode }, uiState.searchMode ? "Search mode · type to filter · enter to apply · esc to clear" : "j/k move · tab switch views · / search · r refresh · enter detail · q quit"),
    ),
  );
}

const NAV_DEBOUNCE_MS = 16;

function formatAsyncErrorMessage(error) {
  const raw = String(error?.message || error || "").trim();
  if (!raw) return "Unknown error";
  const lines = raw
    .split("\n")
    .map((line) => trim(line))
    .filter(Boolean)
    .filter((line) => !line.startsWith("at "))
    .filter((line) => !line.startsWith("Node.js v"))
    .filter((line) => !line.includes("/node_modules/"))
    .filter((line) => !line.includes("inline-projection.mjs"));
  return lines[0] || "Unknown error";
}

function buildDetailLoadFailureDashboard(error) {
  const message = formatAsyncErrorMessage(error) || "Unable to load live factory detail.";
  return {
    summary: {
      health: "unknown",
      state_action: "error",
      state_reason: message,
    },
    tabs: [{
      id: "now",
      title: "Now",
      rows: [],
      // @context:regression The detail pane can depend on canonical status, which is intentionally unavailable on some hosts.
      // The TUI must surface the missing prerequisite inline instead of letting the async rejection terminate Ink.
      empty_message: `Unable to load live factory detail. ${message}`,
    }],
  };
}

export function FactoryFleetTuiApp(props) {
  const {
    initialSnapshot = {},
    initialUiState = {},
    loadSnapshot = async () => initialSnapshot,
    loadFactoryDetail = async () => ({ tabs: [], summary: {} }),
    refreshMs = 10_000,
    onAction = () => {},
  } = props;

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [uiState, setUiState] = useState({
    activeView: "all",
    mode: "fleet",
    searchMode: false,
    searchQuery: "",
    selectedIndex: 0,
    selectedRowId: "",
    detailFactoryContext: null,
    detailDashboard: null,
    detailActiveTab: "now",
    detailSelectedIndex: 0,
    detailSelectedRowId: "",
    ...initialUiState,
  });
  const actionTakenRef = useRef(false);
  const refreshInFlightRef = useRef(null);
  const lastGeneratedRef = useRef(null);
  const navDebounceRef = useRef(null);
  const detailRequestIdRef = useRef(0);
  // Live refs so interval/async callbacks never read stale closures
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;
  const refreshFnRef = useRef(null);

  // Memoize computed state to avoid double computation
  const computed = useMemo(
    () => buildFleetTuiState(snapshot, uiState),
    [snapshot, uiState.activeView, uiState.searchQuery, uiState.selectedIndex, uiState.selectedRowId, uiState.searchMode],
  );

  // Unified busyLabel inside state
  const busyLabel = uiState._busyLabel || "";

  const applyUiState = (next) => {
    setUiState((previous) => {
      const changed = Object.keys(next).some((k) => previous[k] !== next[k]);
      if (!changed) return previous;
      return { ...previous, ...next };
    });
  };

  useEffect(() => {
    const doRefresh = async (label = "") => {
      if (actionTakenRef.current) return;
      if (refreshInFlightRef.current) return;
      if (label) applyUiState({ _busyLabel: label });
      refreshInFlightRef.current = true;
      try {
        if (actionTakenRef.current) return;
        const currentUi = uiStateRef.current;
        if (trim(currentUi.mode) === "detail" && currentUi.detailFactoryContext) {
          let nextDetail;
          try {
            nextDetail = await loadFactoryDetail({ initialFactoryContext: currentUi.detailFactoryContext });
          } catch (error) {
            nextDetail = buildDetailLoadFailureDashboard(error);
          }
          if (actionTakenRef.current) return;
          applyUiState({ detailDashboard: nextDetail, _busyLabel: "" });
        } else {
          let next;
          try {
            next = await loadSnapshot();
          } catch (error) {
            applyUiState({ _busyLabel: `Refresh failed: ${formatAsyncErrorMessage(error)}` });
            return;
          }
          if (actionTakenRef.current) return;
          const nextGenerated = trim(next?.generated_at);
          if (nextGenerated && nextGenerated === lastGeneratedRef.current) {
            applyUiState({ _busyLabel: "" });
            return;
          }
          lastGeneratedRef.current = nextGenerated;
          setSnapshot(next);
          applyUiState({ _busyLabel: "" });
        }
      } finally {
        refreshInFlightRef.current = null;
      }
    };

    refreshFnRef.current = doRefresh;

    void doRefresh(Array.isArray(initialSnapshot?.factories) && initialSnapshot.factories.length > 0
      ? "Hydrating fleet…"
      : "Loading fleet…");

    const timer = setInterval(() => {
      void doRefresh("");
    }, normalizeFleetTuiRefreshMs(refreshMs));
    return () => clearInterval(timer);
  }, [initialSnapshot, loadSnapshot, loadFactoryDetail, refreshMs]);

  useInput((input, key) => {
    if (actionTakenRef.current) return;

    // Debounce rapid navigation keypresses
    const isNavKey = key?.downArrow || key?.upArrow || input === "j" || input === "k";
    if (isNavKey && navDebounceRef.current) return;
    if (isNavKey) {
      navDebounceRef.current = setTimeout(() => { navDebounceRef.current = null; }, NAV_DEBOUNCE_MS);
    }

    const reduced = reduceFleetTuiKeypress({ snapshot: snapshotRef.current, state: uiStateRef.current, input, key });
    if (reduced.state !== uiStateRef.current) {
      applyUiState(reduced.state);
    }
    if (reduced.action.type === "refresh") {
      void refreshFnRef.current?.("Refreshing…");
      return;
    }
    if (reduced.action.type === "refresh_detail") {
      void refreshFnRef.current?.("Refreshing detail…");
      return;
    }
    if (reduced.action.type === "open_detail") {
      void (async () => {
        const requestId = detailRequestIdRef.current + 1;
        detailRequestIdRef.current = requestId;
        applyUiState({
          ...reduced.action.uiState,
          mode: "detail",
          detailFactoryContext: reduced.action.launch?.initialFactoryContext || null,
          detailDashboard: {
            summary: {},
            tabs: [{
              id: "now",
              title: "Now",
              rows: [],
              empty_message: "Loading live factory detail…",
            }],
          },
          detailActiveTab: "now",
          detailSelectedIndex: 0,
          detailSelectedRowId: "",
          _busyLabel: `Loading ${trim(reduced.action.launch?.row?.factory_id || "factory")}…`,
        });
        let detailDashboard;
        try {
          detailDashboard = await loadFactoryDetail(reduced.action.launch || {});
        } catch (error) {
          detailDashboard = buildDetailLoadFailureDashboard(error);
        }
        if (actionTakenRef.current) return;
        if (detailRequestIdRef.current !== requestId) return;
        applyUiState({
          detailDashboard,
          _busyLabel: "",
        });
      })();
      return;
    }
    if (reduced.action.type === "quit" || reduced.action.type === "session") {
      actionTakenRef.current = true;
      onAction(reduced.action);
    }
  });

  // Pass computed state to screens to avoid double computation
  const screenProps = {
    snapshot,
    uiState: {
      ...uiState,
      _computed: computed,
      onSearchChange: (value) => applyUiState({ searchQuery: value, selectedIndex: 0, selectedRowId: "" }),
      onSearchSubmit: () => applyUiState({ searchMode: false }),
    },
    busyLabel,
  };

  if (trim(uiState.mode) === "detail") {
    return h(FactoryDetailScreen, screenProps);
  }
  return h(FleetScreen, screenProps);
}
