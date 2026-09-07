import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  loadFactoryConfig,
  resolveControlPlaneRepo as resolveFactoryControlPlaneRepo,
} from "./factory-config-loader.ts";
export { loadFactoryConfig, resolveFactoryControlPlaneRepo };
import { trim, parseJson, ghJson } from "../lib/cli-helpers.ts";
import {
  resolvePacketStoragePath,
  validateDurablePacketPayload,
} from "../lib/packet-core.ts";

export function hasLabel(issue, name) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === name);
}

export function asPositiveInt(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}


export function encodeJsonB64(value = {}) {
  try {
    return Buffer.from(JSON.stringify(value || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
}

export function extractWaveGiveupSourceIssueNumber({ title = "", body = "" } = {}) {
  const titleText = String(title || "");
  if (!/^\[bug\]\s*wave-issue-giveup-/i.test(titleText)) return 0;

  const titleMatch = titleText.match(/Issue\s*#(\d+)\s+gave\s+up/i);
  if (titleMatch) return asPositiveInt(titleMatch[1]);

  const fencedJson = String(body || "").match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedJson?.[1]) {
    const parsed = parseJson(fencedJson[1], null);
    const fromPayload = asPositiveInt(parsed?.evidence?.issue_number || parsed?.issue_number);
    if (fromPayload > 0) return fromPayload;
  }

  const bodyMatch = String(body || "").match(/"issue_number"\s*:\s*"?(\d+)"?/i);
  if (bodyMatch) return asPositiveInt(bodyMatch[1]);

  return 0;
}

export function resolveIssueState({ repo = "", issueNumber = 0, ghJsonFn = ghJson } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedIssueNumber = asPositiveInt(issueNumber);
  if (!resolvedRepo || resolvedIssueNumber <= 0) return "";
  try {
    const viewed = ghJsonFn([
      "issue", "view", String(resolvedIssueNumber), "--repo", resolvedRepo, "--json", "state",
    ], {});
    return String(viewed?.state || "").trim().toUpperCase();
  } catch {
    return "";
  }
}

function extractRecurrenceKeyFromBugBody(body = "") {
  const text = String(body || "");
  const fencedJson = Array.from(text.matchAll(/```json\s*([\s\S]*?)\s*```/gi));
  for (const block of fencedJson) {
    const parsed = parseJson(block?.[1] || "", null);
    const recurrenceKey = trim(
      parsed?.evidence?.recurrence_key
      || parsed?.recurrence_key,
    );
    if (recurrenceKey) return recurrenceKey;
  }
  const markdownTable = text.match(/recurrence_key\s*[:|]\s*`?([A-Za-z0-9_:-]+)`?/i);
  return trim(markdownTable?.[1] || "");
}

export function collectClosedFallbackDefectBugHistory({ repo = "", ghJsonFn = ghJson } = {}) {
  if (!trim(repo)) return [];
  const closedBugs = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "closed", "--label", "bug", "--limit", "200",
    "--json", "number,title,body,closedAt",
  ], []);
  if (!Array.isArray(closedBugs)) return [];
  return closedBugs
    .map((bug) => ({
      recurrence_key: extractRecurrenceKeyFromBugBody(bug?.body),
      closed_at: trim(bug?.closedAt || ""),
    }))
    .filter((item) => item.recurrence_key && item.closed_at);
}

function classifyCliCrash(errorText = "") {
  const msg = String(errorText || "");
  if (!msg) return "";
  if (/SyntaxError:\s*Unexpected token '<<'/.test(msg) || /<<<<<<<\s+HEAD/.test(msg)) return "merge_marker_in_executable";
  if (/does not provide an export named/.test(msg)) return "module_export_contract_mismatch";
  if (/ERR_MODULE_NOT_FOUND|Cannot find module/.test(msg)) return "module_not_found";
  if (/SyntaxError:/.test(msg) || /ReferenceError:/.test(msg) || /TypeError:/.test(msg)) return "runtime_module_error";
  return "";
}

export function scanRecentCliCrashes({ runsDir = ".hatch/runs", nowMs = Date.now(), windowMs = 10 * 60 * 1000 } = {}) {
  let runIds = [];
  try {
    runIds = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const incidents = [];
  for (const runId of runIds) {
    const statePath = join(runsDir, runId, "state.json");
    let state;
    try {
      state = parseJson(readFileSync(statePath, "utf8"), null);
    } catch {
      continue;
    }
    if (!state || String(state.status || "") !== "failed") continue;
    const updatedMs = Date.parse(String(state.updatedAt || ""));
    if (Number.isFinite(updatedMs) && (nowMs - updatedMs) > windowMs) continue;
    const records = Array.isArray(state.records) ? state.records : [];
    const failing = [...records].reverse().find((r) => String(r?.outcome?.status || "") === "failed");
    const errorText = String(failing?.outcome?.error || "");
    const crashType = classifyCliCrash(errorText);
    if (!crashType) continue;
    const fileMatch = errorText.match(/file:\/\/(.+?):\d+/);
    incidents.push({
      run_id: String(state.runId || runId),
      pipeline: String(state.pipelineFile || state.pipeline || ""),
      node: String(failing?.nodeId || state.currentNode || ""),
      crash_type: crashType,
      file_path: fileMatch ? String(fileMatch[1] || "") : "",
      error_excerpt: errorText.split("\n").slice(0, 4).join("\n"),
    });
  }
  return incidents.slice(0, 5);
}

function hasMergeMarkersInFile(filePath = "") {
  const resolved = String(filePath || "").trim();
  if (!resolved || !existsSync(resolved)) return true;
  try {
    const body = String(readFileSync(resolved, "utf8") || "");
    return /(^|\n)(<<<<<<<|=======|>>>>>>>)(\s|$)/m.test(body);
  } catch {
    return true;
  }
}

export function shouldEscalateCliCrash(crash = {}) {
  const crashType = String(crash?.crash_type || "");
  if (crashType !== "merge_marker_in_executable") return true;
  return hasMergeMarkersInFile(String(crash?.file_path || ""));
}

function inferRepoPathFromRunsDir(runsDir = "") {
  const resolvedRunsDir = resolve(trim(runsDir) || ".").replace(/\\/g, "/");
  const hatchMarkerIndex = resolvedRunsDir.lastIndexOf("/.hatch/");
  if (hatchMarkerIndex > 0) {
    return resolvedRunsDir.slice(0, hatchMarkerIndex);
  }
  if (resolvedRunsDir.endsWith("/.hatch")) {
    return resolvedRunsDir.slice(0, -"/.hatch".length);
  }
  if (resolvedRunsDir.endsWith("/runs")) {
    return resolvedRunsDir.slice(0, -"/runs".length);
  }
  return resolve(".");
}

export function persistDurableSnapshotPacket({ repo = "", runsDir = "", packet = {} } = {}) {
  const validation = validateDurablePacketPayload(packet);
  if (!validation.ok) {
    throw new Error(`invalid_durable_snapshot_packet:${validation.errors.join(",")}`);
  }

  const persistenceRepo = trim(repo) ? resolve(repo) : inferRepoPathFromRunsDir(runsDir);
  const resolved = resolvePacketStoragePath({
    repo: persistenceRepo,
    packetType: packet?.packet_type,
    packetId: packet?.packet_id,
    factoryId: packet?.factory_id,
    runId: packet?.run_id,
  });
  mkdirSync(dirname(resolved.packet_path), { recursive: true });
  writeFileSync(resolved.packet_path, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return {
    packet_path: resolved.packet_path,
    storage_class: resolved.storage_class,
  };
}
