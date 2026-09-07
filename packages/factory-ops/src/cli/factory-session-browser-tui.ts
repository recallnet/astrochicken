import { statSync } from "node:fs";
import readline from "node:readline";

import { enterFullscreenTui, exitFullscreenTui, writeFollowFrame } from "./factory-follow-render.ts";
import { resolveSessionBrowserOpenSpec } from "../commands/factory-session-browser.ts";
import { readSessionEntries, renderSessionLine } from "../lib/factory-session-log.ts";
import { createResumableSessionRuntime } from "../lib/session-resume.ts";
import { createSessionTransport } from "../lib/session-transport.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function viewIds(snapshot = {}) {
  return Object.keys(snapshot.views || {});
}

function rowsForView(snapshot = {}, activeView = "active") {
  return Array.isArray(snapshot?.views?.[activeView]?.rows) ? snapshot.views[activeView].rows : [];
}

function filterRows(rows = [], query = "") {
  const needle = trim(query).toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.title,
      row.summary,
      row.issue,
      row.goal_issue,
      row.run_id,
      row.trace_kind,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function nextIndex(current, max, delta) {
  if (max <= 0) return 0;
  return Math.min(Math.max(0, current + delta), max - 1);
}

function normalizeBrowserKey(key = {}) {
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

export function createSessionBrowserAction(type = "none", payload = {}) {
  return { type, ...payload };
}

export function buildSessionBrowserState(snapshot = {}, state = {}) {
  const ids = viewIds(snapshot);
  const activeView = ids.includes(state.activeView) ? state.activeView : (ids[0] || "active");
  const searchQuery = trim(state.searchQuery || "");
  const visibleRows = filterRows(rowsForView(snapshot, activeView), searchQuery);
  const selectedIndex = state.selectedRowId
    ? Math.max(0, visibleRows.findIndex((row) => row.id === state.selectedRowId))
    : Math.min(Math.max(0, Number(state.selectedIndex) || 0), Math.max(0, visibleRows.length - 1));
  const selectedRow = visibleRows[selectedIndex] || null;
  return {
    activeView,
    mode: ["browser", "live", "resume", "transcript"].includes(state.mode) ? state.mode : "browser",
    searchMode: state.searchMode === true,
    searchQuery,
    selectedIndex,
    selectedRowId: selectedRow?.id || "",
    visibleRows,
    selectedRow,
    message: trim(state.message || ""),
  };
}

export function reduceSessionBrowserKeypress({ snapshot = {}, state = {}, key = {} } = {}) {
  const current = buildSessionBrowserState(snapshot, state);
  const normalizedKey = normalizeBrowserKey(key);
  const ids = viewIds(snapshot);

  if (current.mode !== "browser") {
    if (normalizedKey.name === "escape") {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, mode: "browser", message: "" }),
        action: createSessionBrowserAction("close_view", {}),
      };
    }
    return { state: current, action: createSessionBrowserAction("none", {}) };
  }

  if (current.searchMode) {
    if (normalizedKey.name === "return") {
      return { state: buildSessionBrowserState(snapshot, { ...current, searchMode: false }), action: createSessionBrowserAction("none", {}) };
    }
    if (normalizedKey.name === "escape") {
      return { state: buildSessionBrowserState(snapshot, { ...current, searchMode: false, searchQuery: "" }), action: createSessionBrowserAction("none", {}) };
    }
    if (normalizedKey.name === "backspace") {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, searchQuery: current.searchQuery.slice(0, -1) }),
        action: createSessionBrowserAction("none", {}),
      };
    }
    if (trim(normalizedKey.sequence)) {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, searchQuery: `${current.searchQuery}${normalizedKey.sequence}` }),
        action: createSessionBrowserAction("none", {}),
      };
    }
    return { state: current, action: createSessionBrowserAction("none", {}) };
  }

  if (normalizedKey.name === "tab" || normalizedKey.name === "right" || normalizedKey.name === "l") {
    const idx = Math.max(0, ids.indexOf(current.activeView));
    return {
      state: buildSessionBrowserState(snapshot, { ...current, activeView: ids[(idx + 1) % Math.max(1, ids.length)], selectedIndex: 0, selectedRowId: "" }),
      action: createSessionBrowserAction("none", {}),
    };
  }
  if (normalizedKey.name === "left" || normalizedKey.name === "h") {
    const idx = Math.max(0, ids.indexOf(current.activeView));
    return {
      state: buildSessionBrowserState(snapshot, { ...current, activeView: ids[(idx - 1 + Math.max(1, ids.length)) % Math.max(1, ids.length)], selectedIndex: 0, selectedRowId: "" }),
      action: createSessionBrowserAction("none", {}),
    };
  }
  if (normalizedKey.name === "down" || normalizedKey.name === "j") {
    return {
      state: buildSessionBrowserState(snapshot, {
        ...current,
        selectedIndex: nextIndex(current.selectedIndex, current.visibleRows.length, 1),
        selectedRowId: "",
      }),
      action: createSessionBrowserAction("none", {}),
    };
  }
  if (normalizedKey.name === "up" || normalizedKey.name === "k") {
    return {
      state: buildSessionBrowserState(snapshot, {
        ...current,
        selectedIndex: nextIndex(current.selectedIndex, current.visibleRows.length, -1),
        selectedRowId: "",
      }),
      action: createSessionBrowserAction("none", {}),
    };
  }
  if (normalizedKey.sequence === "/") {
    return {
      state: buildSessionBrowserState(snapshot, { ...current, searchMode: true, searchQuery: "" }),
      action: createSessionBrowserAction("none", {}),
    };
  }
  if (normalizedKey.name === "return") {
    const row = current.selectedRow;
    const open = resolveSessionBrowserOpenSpec(row);
    if (open.mode === "live") {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, mode: "live" }),
        action: createSessionBrowserAction("open_live", { rowId: row.id }),
      };
    }
    if (open.mode === "resume") {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, mode: "resume" }),
        action: createSessionBrowserAction("open_resume", { rowId: row.id }),
      };
    }
    if (open.mode === "transcript") {
      return {
        state: buildSessionBrowserState(snapshot, { ...current, mode: "transcript" }),
        action: createSessionBrowserAction("open_transcript", { rowId: row.id }),
      };
    }
  }
  return { state: current, action: createSessionBrowserAction("none", {}) };
}

export function formatSessionBrowserListFrame(snapshot = {}, state = {}) {
  const current = buildSessionBrowserState(snapshot, state);
  const rows = current.visibleRows;
  const views = viewIds(snapshot).map((id, index) => `${current.activeView === id ? ">" : ""}${index + 1}:${snapshot.views[id].title}${current.activeView === id ? "<" : ""}`).join("   ");
  const lines = [
    `FACTORY SESSION BROWSER  ${trim(snapshot?.context?.factory_id || "") || "factory"}`,
    "======================================================================",
    `Views  ${views}`,
    `Search=${current.searchQuery || "(none)"}  Mode=${current.mode}  Rows=${rows.length}`,
    "----------------------------------------------------------------------",
  ];
  if (rows.length === 0) {
    lines.push(snapshot?.views?.[current.activeView]?.empty_message || "No sessions.");
  } else {
    lines.push("#  KIND       MODE     ISSUE    TITLE                           STATUS    STEP   AGE     SUMMARY");
    lines.push("-- ---------- -------- -------- ------------------------------- --------- ------ ------- --------------------------------");
    rows.forEach((row, index) => {
      const marker = index === current.selectedIndex ? "->" : `${index + 1}.`;
      lines.push(`${marker.padEnd(3)} ${String(row.kind || "").slice(0, 10).padEnd(10)} ${String(row.mode || "").slice(0, 8).padEnd(8)} ${String(row.issue || "").padEnd(8)} ${String(row.title || "").slice(0, 31).padEnd(31)} ${String(row.status || "").slice(0, 9).padEnd(9)} ${String(row.progress_label || "").slice(0, 6).padEnd(6)} ${String(row.updated_age || "").padEnd(7)} ${String(row.summary || "").slice(0, 32)}`);
    });
  }
  lines.push("");
  lines.push("Selection");
  if (current.selectedRow) {
    lines.push(`  ${current.selectedRow.title}  [${current.selectedRow.kind}/${current.selectedRow.mode}]`);
    lines.push(`  run=${current.selectedRow.run_id}  issue=${current.selectedRow.issue || "n/a"}  goal=${current.selectedRow.goal_issue || "n/a"}  step=${current.selectedRow.progress_label || "n/a"}`);
  } else {
    lines.push("  No row selected.");
  }
  lines.push("");
  lines.push("Keys  tab/l/h switch views  j/k move  enter open  / search  esc back  q quit");
  return lines.join("\n");
}

function formatTranscriptFrame({ row = null, lines = [], error = "" } = {}) {
  const out = [
    `TRANSCRIPT  ${trim(row?.title || row?.run_id || "session")}  [read-only]`,
    "======================================================================",
  ];
  if (trim(error)) out.push(`Error: ${trim(error)}`);
  out.push(...(lines.length > 0 ? lines : ["(empty transcript)"]));
  out.push("");
  out.push("Keys  esc back");
  return out.join("\n");
}

function formatLiveFrame({ row = null, events = [], input = "", error = "" } = {}) {
  const out = [
    `LIVE SESSION  ${trim(row?.title || row?.run_id || "session")}  [read-write]`,
    "======================================================================",
  ];
  if (trim(error)) out.push(`Error: ${trim(error)}`);
  out.push(...(events.length > 0 ? events : ["(waiting for session events)"]));
  out.push("");
  out.push(`> ${input}`);
  out.push("Keys  enter send steer  esc back");
  return out.join("\n");
}

function formatResumeFrame({ row = null, events = [], input = "", error = "" } = {}) {
  const out = [
    `RESUMED SESSION  ${trim(row?.title || row?.run_id || "session")}  [read-write]`,
    "======================================================================",
  ];
  if (trim(error)) out.push(`Error: ${trim(error)}`);
  out.push(...(events.length > 0 ? events : ["(waiting for resumed session events)"]));
  out.push("");
  out.push(`> ${input}`);
  out.push("Keys  enter send prompt  esc back");
  return out.join("\n");
}

function renderTransportEvent(event = {}) {
  if (!event || typeof event !== "object") return trim(event);
  if (event.type === "assistant.delta") return `assistant ${trim(event.text || "")}`.trim();
  if (event.type === "tool.start") return `tool ${trim(event.name || "unknown")} start`.trim();
  if (event.type === "tool.end") return `tool ${trim(event.name || "unknown")} end`.trim();
  if (event.type === "session_transport.connected") return "connected";
  if (event.type === "session_transport.error") return `transport error: ${trim(event.message || event.code || "")}`;
  return trim(JSON.stringify(event));
}

async function runTranscriptView({
  row,
  stdout,
  stdin,
} = {}) {
  let stopped = false;
  let lastSize = -1;
  let renderedLines = [];
  let error = "";

  const render = () => {
    writeFollowFrame(stdout, formatTranscriptFrame({ row, lines: renderedLines, error }));
  };

  const refresh = () => {
    try {
      const size = statSync(row.session_log).size;
      if (size === lastSize) return;
      lastSize = size;
      renderedLines = readSessionEntries(row.session_log).map((entry) => renderSessionLine(JSON.stringify(entry))).slice(-30);
      error = "";
    } catch (nextError) {
      error = String(nextError?.message || nextError);
    }
    render();
  };

  const onKeypress = (_, key = {}) => {
    if (key.name === "escape" || key.name === "q") stopped = true;
  };

  stdin.on("keypress", onKeypress);
  const interval = setInterval(refresh, 1000);
  try {
    refresh();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    clearInterval(interval);
    stdin.off("keypress", onKeypress);
  }
}

async function runLiveView({
  row,
  snapshot,
  stdout,
  stdin,
} = {}) {
  let stopped = false;
  let input = "";
  let error = "";
  const events = [];
  const transport = createSessionTransport({
    factoryId: trim(snapshot?.context?.factory_id || row?.factory_id || ""),
    runsDir: trim(snapshot?.context?.runs_dir || ""),
    target: row.live_attach_target,
  });

  const render = () => {
    writeFollowFrame(stdout, formatLiveFrame({ row, events: events.slice(-30), input, error }));
  };

  const unsubscribe = transport.subscribe((event) => {
    events.push(renderTransportEvent(event));
    render();
  });

  const onKeypress = async (chunk, key = {}) => {
    if (key.name === "escape") {
      stopped = true;
      return;
    }
    if (key.name === "backspace") {
      input = input.slice(0, -1);
      render();
      return;
    }
    if (key.name === "return") {
      const message = trim(input);
      input = "";
      if (!message) {
        render();
        return;
      }
      try {
        await transport.steer(message);
        events.push(`you ${message}`);
        error = "";
      } catch (nextError) {
        error = String(nextError?.message || nextError);
      }
      render();
      return;
    }
    if (typeof chunk === "string" && chunk >= " " && chunk !== "\u007f") {
      input += chunk;
      render();
    }
  };

  stdin.on("keypress", onKeypress);
  try {
    render();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    unsubscribe();
    stdin.off("keypress", onKeypress);
  }
}

async function runResumeView({
  row,
  stdout,
  stdin,
  createResumableSessionRuntimeFn = createResumableSessionRuntime,
} = {}) {
  let stopped = false;
  let input = "";
  let error = "";
  const events = [];
  const runtime = await createResumableSessionRuntimeFn({
    target: row.resume_target,
  });

  const render = () => {
    writeFollowFrame(stdout, formatResumeFrame({ row, events: events.slice(-30), input, error }));
  };

  const unsubscribe = runtime.subscribe((event) => {
    events.push(renderTransportEvent(event));
    render();
  });

  const onKeypress = async (chunk, key = {}) => {
    if (key.name === "escape") {
      stopped = true;
      return;
    }
    if (key.name === "backspace") {
      input = input.slice(0, -1);
      render();
      return;
    }
    if (key.name === "return") {
      const message = trim(input);
      input = "";
      if (!message) {
        render();
        return;
      }
      try {
        await runtime.prompt(message);
        events.push(`you ${message}`);
        error = "";
      } catch (nextError) {
        error = String(nextError?.message || nextError);
      }
      render();
      return;
    }
    if (typeof chunk === "string" && chunk >= " " && chunk !== "\u007f") {
      input += chunk;
      render();
    }
  };

  stdin.on("keypress", onKeypress);
  try {
    render();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    unsubscribe();
    runtime.dispose?.();
    stdin.off("keypress", onKeypress);
  }
}

function resolveInitialState(snapshot = {}, initialTarget = null) {
  if (!initialTarget || typeof initialTarget !== "object") return buildSessionBrowserState(snapshot, { activeView: "active" });
  for (const view of viewIds(snapshot)) {
    const rows = rowsForView(snapshot, view);
    const found = rows.find((row) => trim(row.run_id) === trim(initialTarget.run_id));
    if (found) return buildSessionBrowserState(snapshot, { activeView: view, selectedRowId: found.id });
  }
  return buildSessionBrowserState(snapshot, { activeView: "active" });
}

export async function runFactorySessionBrowserTui({
  loadSnapshot,
  stdout = process.stdout,
  stdin = process.stdin,
  refreshMs = 2000,
  initialTarget = null,
} = {}) {
  let stopped = false;
  let snapshot = await loadSnapshot();
  let state = resolveInitialState(snapshot, initialTarget);

  const render = () => {
    if (state.mode === "browser") {
      writeFollowFrame(stdout, formatSessionBrowserListFrame(snapshot, state));
    }
  };

  const refresh = async () => {
    snapshot = await loadSnapshot();
    state = buildSessionBrowserState(snapshot, state);
    render();
  };

  readline.emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  if (stdin.isTTY) stdin.setRawMode(true);

  const onKeypress = async (chunk, key = {}) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      stopped = true;
      return;
    }
    const next = reduceSessionBrowserKeypress({ snapshot, state, key: { ...key, sequence: key.sequence ?? chunk } });
    state = next.state;
    render();
    if (next.action.type === "open_transcript") {
      const row = state.selectedRow;
      if (row) {
        await runTranscriptView({ row, stdout, stdin });
        state = buildSessionBrowserState(snapshot, { ...state, mode: "browser" });
        render();
      }
      return;
    }
    if (next.action.type === "open_live") {
      const row = state.selectedRow;
      if (row) {
        const open = resolveSessionBrowserOpenSpec(row);
        if (open.mode === "live") {
          await runLiveView({ row, snapshot, stdout, stdin });
        } else if (open.session_log) {
          await runTranscriptView({ row, stdout, stdin });
        }
        state = buildSessionBrowserState(snapshot, { ...state, mode: "browser" });
        render();
      }
      return;
    }
    if (next.action.type === "open_resume") {
      const row = state.selectedRow;
      if (row) {
        const open = resolveSessionBrowserOpenSpec(row);
        if (open.mode === "resume") {
          await runResumeView({ row, stdout, stdin });
        } else if (open.session_log) {
          await runTranscriptView({ row, stdout, stdin });
        }
        state = buildSessionBrowserState(snapshot, { ...state, mode: "browser" });
        render();
      }
    }
  };

  const interval = setInterval(async () => {
    if (!stopped && state.mode === "browser") await refresh();
  }, Math.max(250, Number(refreshMs) || 2000));

  try {
    enterFullscreenTui(stdout);
    stdin.on("keypress", onKeypress);
    await refresh();
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    clearInterval(interval);
    stdin.off("keypress", onKeypress);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    exitFullscreenTui(stdout);
  }
}
