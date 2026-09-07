/**
 * State management for fleet TUI — reducer, state builders, navigation.
 */

import { resolveDashboardSessionBrowserLaunch } from "../factory-dashboard-tui.ts";
import {
  availableViews,
  matchesSearch,
  matchesView,
  trim,
} from "./format.ts";

export function nextIndex(current, max, delta) {
  if (max <= 0) return 0;
  return Math.min(Math.max(0, current + delta), max - 1);
}

export function normalizeFleetKey(key = {}) {
  if (key?.upArrow) return { ...key, name: "up" };
  if (key?.downArrow) return { ...key, name: "down" };
  if (key?.leftArrow) return { ...key, name: "left" };
  if (key?.rightArrow) return { ...key, name: "right" };
  if (key?.return) return { ...key, name: "return" };
  if (key?.escape) return { ...key, name: "escape" };
  if (key?.tab) return { ...key, name: "tab" };
  if (key?.backspace) return { ...key, name: "backspace" };
  if (key?.delete) return { ...key, name: "delete" };
  if (key?.name) return key;
  switch (key?.sequence) {
    case "\u001b[A":
      return { ...key, name: "up" };
    case "\u001b[B":
      return { ...key, name: "down" };
    case "\u001b[C":
      return { ...key, name: "right" };
    case "\u001b[D":
      return { ...key, name: "left" };
    default:
      return key;
  }
}

export function visibleRows(snapshot = {}, state = {}) {
  const rows = Array.isArray(snapshot?.factories) ? snapshot.factories : [];
  return rows
    .filter((row) => matchesView(row, state.activeView))
    .filter((row) => matchesSearch(row, state.searchQuery))
    .sort((left, right) => String(left.factory_id || "").localeCompare(String(right.factory_id || "")));
}

export function normalizeFleetTuiRefreshMs(value, fallback = 10_000) {
  return Math.max(1_500, Number(value) || fallback);
}

export function buildFleetTuiState(snapshot = {}, state = {}) {
  const views = availableViews().map((view) => view.id);
  const activeView = views.includes(state.activeView) ? state.activeView : "all";
  const searchMode = state.searchMode === true;
  const searchQuery = trim(state.searchQuery || "");
  // Reuse pre-computed rows when filtering inputs haven't changed
  const canReuse = Array.isArray(state.rows)
    && state.rows.length > 0
    && state.activeView === activeView
    && trim(state.searchQuery || "") === searchQuery;
  const rows = canReuse ? state.rows : visibleRows(snapshot, { activeView, searchQuery });
  const selectedIndex = state.selectedRowId
    ? Math.max(0, rows.findIndex((row) => trim(row.factory_id) === trim(state.selectedRowId)))
    : Math.min(Math.max(0, Number(state.selectedIndex) || 0), Math.max(0, rows.length - 1));
  const selectedRow = rows[selectedIndex] || null;
  return {
    activeView,
    searchMode,
    searchQuery,
    selectedIndex,
    selectedRowId: trim(selectedRow?.factory_id || ""),
    rows,
    selectedRow,
  };
}

export function resolveFleetDashboardLaunch(snapshot = {}, state = {}) {
  const current = buildFleetTuiState(snapshot, state);
  const row = current.selectedRow;
  if (!row) return { ok: false, reason: "no_factory_selected" };
  return {
    ok: true,
    row,
    initialFactoryContext: {
      factory_id: trim(row.factory_id),
      target_repo: trim(row.target_repo),
      control_plane_repo: trim(row.control_plane_repo),
      factory_root: trim(row.factory_root),
      factory_config_path: "",
      runs_dir: trim(row.runs_dir),
    },
  };
}

export function buildFactoryDetailState(dashboard = {}, state = {}) {
  const tabs = Array.isArray(dashboard?.tabs) ? dashboard.tabs : [];
  const tabIds = tabs.map((tab) => trim(tab.id));
  const activeTab = tabIds.includes(trim(state.detailActiveTab)) ? trim(state.detailActiveTab) : (tabIds[0] || "now");
  const activeTabEntry = tabs.find((tab) => trim(tab.id) === activeTab) || tabs[0] || { id: activeTab, title: activeTab || "Now", rows: [] };
  const rows = Array.isArray(activeTabEntry.rows) ? activeTabEntry.rows : [];
  const selectedIndex = state.detailSelectedRowId
    ? Math.max(0, rows.findIndex((row) => trim(row.id) === trim(state.detailSelectedRowId)))
    : Math.min(Math.max(0, Number(state.detailSelectedIndex) || 0), Math.max(0, rows.length - 1));
  const selectedRow = rows[selectedIndex] || null;
  return {
    tabs,
    activeTab,
    activeTabEntry,
    rows,
    selectedIndex,
    selectedRowId: trim(selectedRow?.id || ""),
    selectedRow,
  };
}

export function resolveFleetSessionLaunch(dashboard = {}, state = {}) {
  const detail = buildFactoryDetailState(dashboard, state);
  return resolveDashboardSessionBrowserLaunch(dashboard, {
    activeTab: detail.activeTab,
    selectedIndex: detail.selectedIndex,
  });
}

export function createFleetTuiAction(type = "none", payload = {}) {
  return { type, ...payload };
}

export function reduceFleetTuiKeypress({ snapshot = {}, state = {}, input = "", key = {} } = {}) {
  const normalizedKey = normalizeFleetKey(key);
  const sequence = String(normalizedKey.sequence || input || "");
  const char = sequence.length === 1 ? sequence : String(input || "");

  // Lazy: only compute derived state when needed (not for quit, nav, or no-ops)
  let _current = null;
  const current = () => { if (!_current) _current = buildFleetTuiState(snapshot, state); return _current; };
  const views = availableViews().map((view) => view.id);

  if (trim(state.mode) === "detail") {
    let _detail = null;
    const detail = () => { if (!_detail) _detail = buildFactoryDetailState(state.detailDashboard || {}, state); return _detail; };
    const lazyTabIds = () => detail().tabs.map((tab) => trim(tab.id)).filter(Boolean);
    if (char === "q" || (normalizedKey.ctrl && normalizedKey.name === "c")) {
      return { state, action: createFleetTuiAction("quit", { uiState: state }) };
    }
    if (normalizedKey.name === "escape" || char === "b") {
      return {
        state: {
          ...state,
          mode: "fleet",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    if (char === "r") {
      return { state, action: createFleetTuiAction("refresh_detail", {}) };
    }
    if (normalizedKey.name === "return" || sequence === "\r" || sequence === "\n") {
      const launch = resolveFleetSessionLaunch(state.detailDashboard || {}, state);
      if (!launch.ok) return { state, action: createFleetTuiAction("none", {}) };
      return {
        state,
        action: createFleetTuiAction("session", {
          launch: {
            ...launch,
            initialFactoryContext: state.detailFactoryContext || null,
          },
          uiState: state,
        }),
      };
    }
    if (normalizedKey.name === "tab" || normalizedKey.name === "right" || char === "l") {
      const tabIds = lazyTabIds();
      const currentIndex = Math.max(0, tabIds.indexOf(detail().activeTab));
      return {
        state: {
          ...state,
          detailActiveTab: tabIds[(currentIndex + 1) % Math.max(1, tabIds.length)] || detail().activeTab,
          detailSelectedIndex: 0,
          detailSelectedRowId: "",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    if (normalizedKey.name === "left" || char === "h") {
      const tabIds = lazyTabIds();
      const currentIndex = Math.max(0, tabIds.indexOf(detail().activeTab));
      return {
        state: {
          ...state,
          detailActiveTab: tabIds[(currentIndex - 1 + Math.max(1, tabIds.length)) % Math.max(1, tabIds.length)] || detail().activeTab,
          detailSelectedIndex: 0,
          detailSelectedRowId: "",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    if (/^[1-9]$/.test(char)) {
      const tabIds = lazyTabIds();
      const nextTab = tabIds[Number(char) - 1];
      return {
        state: {
          ...state,
          detailActiveTab: nextTab || detail().activeTab,
          detailSelectedIndex: 0,
          detailSelectedRowId: "",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    if (normalizedKey.name === "down" || char === "j") {
      return {
        state: {
          ...state,
          detailSelectedIndex: nextIndex(detail().selectedIndex, detail().rows.length, 1),
          detailSelectedRowId: "",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    if (normalizedKey.name === "up" || char === "k") {
      return {
        state: {
          ...state,
          detailSelectedIndex: nextIndex(detail().selectedIndex, detail().rows.length, -1),
          detailSelectedRowId: "",
        },
        action: createFleetTuiAction("none", {}),
      };
    }
    return { state, action: createFleetTuiAction("none", {}) };
  }

  // Quit and refresh: no derived state needed
  if (char === "q" || (normalizedKey.ctrl && normalizedKey.name === "c")) {
    return { state, action: createFleetTuiAction("quit", { uiState: state }) };
  }
  if (char === "r") {
    return { state, action: createFleetTuiAction("refresh", {}) };
  }

  if (current().searchMode) {
    if (normalizedKey.name === "escape") {
      return {
        state: buildFleetTuiState(snapshot, {
          ...current(),
          searchMode: false,
          searchQuery: "",
          selectedIndex: 0,
          selectedRowId: "",
        }),
        action: createFleetTuiAction("none", {}),
      };
    }
    return { state: current(), action: createFleetTuiAction("none", {}) };
  }

  if (normalizedKey.name === "return" || sequence === "\r" || sequence === "\n") {
    const launch = resolveFleetDashboardLaunch(snapshot, current());
    if (!launch.ok) return { state: current(), action: createFleetTuiAction("none", {}) };
    return { state: current(), action: createFleetTuiAction("open_detail", { launch, uiState: current() }) };
  }

  if (char === "/") {
    return {
      state: buildFleetTuiState(snapshot, {
        ...current(),
        searchMode: true,
        searchQuery: "",
        selectedIndex: 0,
        selectedRowId: "",
      }),
      action: createFleetTuiAction("none", {}),
    };
  }
  if (normalizedKey.name === "escape") {
    return {
      state: buildFleetTuiState(snapshot, {
        ...current(),
        searchMode: false,
        searchQuery: "",
        selectedIndex: 0,
        selectedRowId: "",
      }),
      action: createFleetTuiAction("none", {}),
    };
  }
  if (normalizedKey.name === "tab" || normalizedKey.name === "right" || char === "l") {
    const currentIndex = Math.max(0, views.indexOf(current().activeView));
    return {
      state: buildFleetTuiState(snapshot, {
        ...current(),
        activeView: views[(currentIndex + 1) % views.length],
        selectedIndex: 0,
        selectedRowId: "",
      }),
      action: createFleetTuiAction("none", {}),
    };
  }
  if (normalizedKey.name === "left" || char === "h") {
    const currentIndex = Math.max(0, views.indexOf(current().activeView));
    return {
      state: buildFleetTuiState(snapshot, {
        ...current(),
        activeView: views[(currentIndex - 1 + views.length) % views.length],
        selectedIndex: 0,
        selectedRowId: "",
      }),
      action: createFleetTuiAction("none", {}),
    };
  }
  if (/^[1-5]$/.test(char)) {
    const nextView = views[Number(char) - 1];
    return {
      state: buildFleetTuiState(snapshot, {
        ...current(),
        activeView: nextView || current().activeView,
        selectedIndex: 0,
        selectedRowId: "",
      }),
      action: createFleetTuiAction("none", {}),
    };
  }
  // Navigation: reuse rows, only patch index
  if (normalizedKey.name === "down" || char === "j") {
    const c = current();
    const idx = nextIndex(c.selectedIndex, c.rows.length, 1);
    const row = c.rows[idx] || null;
    return {
      state: { ...c, selectedIndex: idx, selectedRowId: trim(row?.factory_id || ""), selectedRow: row },
      action: createFleetTuiAction("none", {}),
    };
  }
  if (normalizedKey.name === "up" || char === "k") {
    const c = current();
    const idx = nextIndex(c.selectedIndex, c.rows.length, -1);
    const row = c.rows[idx] || null;
    return {
      state: { ...c, selectedIndex: idx, selectedRowId: trim(row?.factory_id || ""), selectedRow: row },
      action: createFleetTuiAction("none", {}),
    };
  }

  // Unrecognized key: return input state as-is (no re-render)
  return { state, action: createFleetTuiAction("none", {}) };
}
