import readline from "node:readline";

import { enterFullscreenTui, exitFullscreenTui, writeFollowFrame } from "./factory-follow-render.ts";
import { formatFactoryDashboardHuman } from "../commands/factory-dashboard.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function parseIssueNumber(value = "") {
  const normalized = String(value || "").trim().replace(/^#/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDashboardFilters(filters = {}) {
  const source = filters && typeof filters === "object" ? filters : {};
  return {
    run_id: trim(source.run_id || source.runId || ""),
    graph: trim(source.graph || ""),
    node: trim(source.node || ""),
    issue: parseIssueNumber(source.issue),
  };
}

function buildFilterPromptLabel(filters = {}) {
  const active = [
    filters.run_id ? `run=${filters.run_id}` : "",
    filters.graph ? `graph=${filters.graph}` : "",
    filters.node ? `node=${filters.node}` : "",
    Number.isFinite(filters.issue) ? `issue=#${filters.issue}` : "",
  ].filter(Boolean).join("  ");
  return active ? `Active filters: ${active}` : "Active filters: (none)";
}

function applyPromptToken(filters = {}, token = "") {
  const input = trim(token || "");
  if (!input) return { ...filters };
  const [rawKey, ...rawValueParts] = input.split("=");
  if (!rawKey || rawValueParts.length === 0) return { ...filters };
  const key = trim(rawKey).toLowerCase();
  const value = trim(rawValueParts.join("="));
  if (!value) return { ...filters };
  if (key === "run" || key === "run_id" || key === "runid") {
    return { ...filters, run_id: value };
  }
  if (key === "graph") {
    return { ...filters, graph: value };
  }
  if (key === "node") {
    return { ...filters, node: value };
  }
  if (key === "issue") {
    return { ...filters, issue: parseIssueNumber(value) };
  }
  return { ...filters };
}

function mergePromptFilters(filters = {}, prompt = "") {
  let next = normalizeDashboardFilters(filters);
  for (const token of String(prompt || "").split(/[\s,]+/).filter(Boolean)) {
    next = applyPromptToken(next, token);
  }
  return normalizeDashboardFilters(next);
}

export function resolveDashboardPromptFilters({ activeFilters = {}, promptValue = "" } = {}) {
  return mergePromptFilters(activeFilters, promptValue);
}

function serializeFiltersToPrompt(filters = {}) {
  return [
    filters.run_id ? `run=${filters.run_id}` : "",
    filters.graph ? `graph=${filters.graph}` : "",
    filters.node ? `node=${filters.node}` : "",
    Number.isFinite(filters.issue) ? `issue=${filters.issue}` : "",
  ].filter(Boolean).join(" ");
}

function normalizeDashboardKey(key = {}, chunk = "") {
  if (key?.name) return { ...key, sequence: key.sequence ?? chunk };
  switch (key?.sequence ?? chunk) {
    case "\u001b[A":
      return { ...key, name: "up", sequence: key.sequence ?? chunk };
    case "\u001b[B":
      return { ...key, name: "down", sequence: key.sequence ?? chunk };
    case "\u001b[C":
      return { ...key, name: "right", sequence: key.sequence ?? chunk };
    case "\u001b[D":
      return { ...key, name: "left", sequence: key.sequence ?? chunk };
    default:
      return { ...key, sequence: key.sequence ?? chunk };
  }
}

export function reduceDashboardTuiKeypress({ dashboard = {}, state = {}, key = {}, chunk = "", canInspect = false } = {}) {
  const current = buildState(dashboard, state);
  const normalized = normalizeDashboardKey(key, chunk);
  const tabIds = (Array.isArray(dashboard.tabs) ? dashboard.tabs : []).map((tab) => tab.id);
  const sequence = String(normalized.sequence || "");
  const rows = rowsForState(dashboard, current);

  if (current.promptOpen) {
    if (normalized.name === "escape") {
      return {
        state: buildState(dashboard, { ...current, promptOpen: false, promptValue: "" }),
        action: { type: "render" },
      };
    }
    if (normalized.name === "backspace") {
      return {
        state: buildState(dashboard, { ...current, promptValue: current.promptValue.slice(0, -1) }),
        action: { type: "render" },
      };
    }
    if (normalized.name === "return") {
      return {
        state: buildState(dashboard, {
          ...current,
          promptOpen: false,
          promptValue: "",
          activeFilters: resolveDashboardPromptFilters({
            activeFilters: current.activeFilters,
            promptValue: current.promptValue,
          }),
        }),
        action: { type: "refresh" },
      };
    }
    if (typeof chunk === "string" && chunk >= " " && chunk !== "\u007f") {
      return {
        state: buildState(dashboard, {
          ...current,
          promptValue: `${current.promptValue}${chunk}`,
        }),
        action: { type: "render" },
      };
    }
    return { state: current, action: { type: "none" } };
  }

  if (normalized.name === "q" || (normalized.ctrl && normalized.name === "c")) {
    return { state: current, action: { type: "quit" } };
  }
  if (normalized.name === "f") {
    return {
      state: buildState(dashboard, {
        ...current,
        promptOpen: true,
        promptValue: serializeFiltersToPrompt(current.activeFilters),
      }),
      action: { type: "render" },
    };
  }
  if (normalized.name === "tab" || normalized.name === "right" || normalized.name === "l") {
    const currentIndex = Math.max(0, tabIds.indexOf(current.activeTab));
    return {
      state: buildState(dashboard, {
        ...current,
        activeTab: tabIds[(currentIndex + 1) % Math.max(1, tabIds.length)] || current.activeTab,
        selectedIndex: 0,
      }),
      action: { type: "render" },
    };
  }
  if (/^[1-9]$/.test(sequence)) {
    const index = Number(sequence) - 1;
    if (!tabIds[index]) return { state: current, action: { type: "none" } };
    return {
      state: buildState(dashboard, {
        ...current,
        activeTab: tabIds[index],
        selectedIndex: 0,
      }),
      action: { type: "render" },
    };
  }
  if (normalized.name === "left" || normalized.name === "h") {
    const currentIndex = Math.max(0, tabIds.indexOf(current.activeTab));
    return {
      state: buildState(dashboard, {
        ...current,
        activeTab: tabIds[(currentIndex - 1 + Math.max(1, tabIds.length)) % Math.max(1, tabIds.length)] || current.activeTab,
        selectedIndex: 0,
      }),
      action: { type: "render" },
    };
  }
  if (normalized.name === "down" || normalized.name === "j") {
    return {
      state: buildState(dashboard, {
        ...current,
        selectedIndex: nextIndex(current.selectedIndex, rows.length, 1),
      }),
      action: { type: "render" },
    };
  }
  if (normalized.name === "up" || normalized.name === "k") {
    return {
      state: buildState(dashboard, {
        ...current,
        selectedIndex: nextIndex(current.selectedIndex, rows.length, -1),
      }),
      action: { type: "render" },
    };
  }
  if (normalized.name === "r") {
    return { state: current, action: { type: "refresh" } };
  }
  if (normalized.name === "i" && canInspect) {
    return { state: current, action: { type: "inspect" } };
  }
  return { state: current, action: { type: "none" } };
}

function buildState(dashboard = {}, state = {}) {
  const tabs = Array.isArray(dashboard.tabs) ? dashboard.tabs : [];
  const tabIds = tabs.map((tab) => tab.id);
  const activeTab = tabIds.includes(state.activeTab) ? state.activeTab : (tabIds[0] || "now");
  const rows = tabs.find((tab) => tab.id === activeTab)?.rows || [];
  const selectedIndex = Math.min(Math.max(0, Number(state.selectedIndex) || 0), Math.max(0, rows.length - 1));
  const selectedRowId = rows[selectedIndex]?.id || "";
  const promptOpen = state.promptOpen === true;
  const promptValue = trim(state.promptValue || "");
  const initialFilters = normalizeDashboardFilters(state.initialFilters || dashboard?.summary?.filters || {});
  const activeFilters = normalizeDashboardFilters(dashboard?.summary?.filters || initialFilters);
  return {
    activeTab,
    selectedIndex,
    selectedRowId,
    promptOpen,
    promptValue,
    initialFilters,
    activeFilters,
  };
}

function nextIndex(current, max, delta) {
  if (max <= 0) return 0;
  return Math.min(Math.max(0, current + delta), max - 1);
}

function getTerminalSize(stdout) {
  return {
    terminalColumns: stdout?.columns || 120,
    terminalRows: stdout?.rows || 40,
  };
}

function rowsForState(dashboard = {}, state = {}) {
  return (dashboard.tabs.find((tab) => tab.id === state.activeTab)?.rows) || [];
}

export function resolveDashboardSessionBrowserLaunch(dashboard = {}, state = {}) {
  const current = buildState(dashboard, state);
  const row = rowsForState(dashboard, current)[current.selectedIndex] || null;
  if (!row) return { ok: false, reason: "no_row_selected" };
  const runIdentity = row?.runIdentity && typeof row.runIdentity === "object"
    ? {
      run_id: trim(row.runIdentity.run_id || ""),
      graph: trim(row.runIdentity.graph || ""),
      node: trim(row.runIdentity.node || ""),
      issue_number: Number(row.runIdentity.issue_number || 0) || null,
    }
    : null;
  const target = row?.refs?.live_attach_target || null;
  const sessionLog = trim(row?.refs?.trace_session_log || "");
  const runId = trim(target?.run_id || runIdentity?.run_id || row?.refs?.trace_run_id || row?.refs?.run_id || "");
  if (!runId && !sessionLog) return { ok: false, reason: "no_session_surface" };
  return {
    ok: true,
    initialRowId: trim(row.id || ""),
    runIdentity,
    initialTarget: target || { run_id: runId },
  };
}

export async function runFactoryDashboardTui({
  loadSnapshot,
  stdout = process.stdout,
  stdin = process.stdin,
  refreshMs = 2000,
  initialFilters = {},
  launchSessionBrowser = null,
} = {}) {
  let stopped = false;
  let state = buildState({}, {
    activeTab: "now",
    selectedIndex: 0,
    initialFilters,
    activeFilters: normalizeDashboardFilters(initialFilters),
    promptOpen: false,
    promptValue: "",
  });

  const loadDashboard = async () => loadSnapshot({ filters: state.activeFilters });
  let dashboard = await loadDashboard();
  state = buildState(dashboard, state);

  const render = () => {
    const size = getTerminalSize(stdout);
    const frameLines = [
      formatFactoryDashboardHuman(dashboard, { ...state, ...size, initialFilters: state.activeFilters }),
      "",
      `Filter prompt  f (set run=<id> graph=<name> node=<name> issue=<n>)  ${buildFilterPromptLabel(state.activeFilters)}`,
    ];
    if (state.promptOpen) {
      frameLines.push(`Set filters > ${state.promptValue}`);
      frameLines.push("  Enter applies. Esc clears draft. Example: run=run-123 graph=goal_issue_execute.dot node=build issue=2175");
    }
    writeFollowFrame(stdout, frameLines.join("\n"));
  };

  const refresh = async () => {
    dashboard = await loadDashboard();
    state = buildState(dashboard, state);
    render();
  };

  readline.emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  if (stdin.isTTY) stdin.setRawMode(true);

  const onResize = () => {
    if (!stopped) render();
  };

  const onKeypress = async (chunk, key = {}) => {
    const next = reduceDashboardTuiKeypress({
      dashboard,
      state,
      key,
      chunk,
      canInspect: typeof launchSessionBrowser === "function",
    });
    state = next.state;

    if (next.action.type === "quit") {
      stopped = true;
      return;
    }
    if (next.action.type === "none") {
      return;
    }
    if (next.action.type === "render") {
      render();
      return;
    }
    if (next.action.type === "refresh") {
      await refresh();
      return;
    }
    if (next.action.type === "inspect") {
      const launch = resolveDashboardSessionBrowserLaunch(dashboard, state);
      if (!launch.ok) {
        render();
        return;
      }
      await launchSessionBrowser(launch);
      await refresh();
    }
  };

  const interval = setInterval(async () => {
    if (!stopped) await refresh();
  }, Math.max(250, Number(refreshMs) || 2000));

  try {
    enterFullscreenTui(stdout);
    stdin.on("keypress", onKeypress);
    stdout.on("resize", onResize);
    await refresh();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    clearInterval(interval);
    stdin.off("keypress", onKeypress);
    stdout.off("resize", onResize);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    exitFullscreenTui(stdout);
  }
}
