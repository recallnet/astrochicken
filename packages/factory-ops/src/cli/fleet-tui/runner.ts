/**
 * Fleet TUI runner — manages ink session lifecycle.
 */

import { render } from "ink";
import React from "react";

import { enterFullscreenTui, exitFullscreenTui } from "../factory-follow-render.ts";
import { FactoryFleetTuiApp } from "./app.ts";
import { trim } from "./format.ts";

function h(type, props, ...children) {
  return React.createElement(type, props, ...children);
}

function runFleetInkSession({
  snapshot,
  uiState,
  loadSnapshot,
  loadFactoryDetail,
  stdout,
  stdin,
  refreshMs,
} = {}) {
  return new Promise((resolve) => {
    let instance = null;
    const finish = (action = { type: "quit", uiState }) => {
      try { instance?.unmount(); } catch { /* ignore */ }
      resolve(action);
    };

    instance = render(
      h(FactoryFleetTuiApp, {
        initialSnapshot: snapshot,
        initialUiState: uiState,
        loadSnapshot,
        loadFactoryDetail,
        refreshMs,
        onAction: finish,
      }),
      {
        stdout,
        stdin,
        exitOnCtrlC: false,
      },
    );
  });
}

export async function runFactoryFleetTui({
  initialSnapshot = null,
  loadSnapshot,
  loadFactoryDetail = async () => ({ tabs: [], summary: {} }),
  stdout = process.stdout,
  stdin = process.stdin,
  refreshMs = 10_000,
  launchSessionBrowser = null,
} = {}) {
  let snapshot = initialSnapshot || {
    generated_at: new Date().toISOString(),
    fleet_totals: {
      total_factories: 0,
      healthy: 0,
      blocked: 0,
      unhealthy: 0,
      active_waves: 0,
      active_issues: 0,
    },
    warnings: ["fleet_snapshot_loading"],
    factories: [],
  };
  let uiState = {
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
  };

  let stopped = false;
  while (!stopped) {
    enterFullscreenTui(stdout);
    const action = await runFleetInkSession({
      snapshot,
      uiState,
      loadSnapshot,
      loadFactoryDetail,
      stdout,
      stdin,
      refreshMs,
    });
    exitFullscreenTui(stdout);

    uiState = {
      ...uiState,
      ...(action?.uiState || {}),
    };

    if (!action || action.type === "quit") {
      stopped = true;
      continue;
    }

    if (action.type === "session" && typeof launchSessionBrowser === "function") {
      await launchSessionBrowser(action.launch);
    }

    snapshot = await loadSnapshot();
  }
}
