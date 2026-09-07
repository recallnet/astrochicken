import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";

export const RELEASE_DEDUP_CURSOR_SCHEMA = "release-dedup-cursor/v1";



function toUniqueNumbers(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(
    arr.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0),
  )].sort((a, b) => a - b);
}

function toUniqueStrings(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(
    arr.map((s) => String(s || "").trim()).filter(Boolean),
  )].sort();
}

function resolveCursorPath({ factoryId = "", rootDir = "." } = {}) {
  const id = trim(factoryId) || "default";
  return join(String(rootDir || "."), ".hatch", "factories", id, "release-dedup-cursor.json");
}

export function readReleaseDedupCursor({ factoryId = "", rootDir = "." } = {}) {
  const cursorPath = resolveCursorPath({ factoryId, rootDir });
  if (!existsSync(cursorPath)) return null;

  const raw = parseJson(readFileSync(cursorPath, "utf8"), null);
  if (!raw || typeof raw !== "object") return null;
  if (trim(raw.schema) !== RELEASE_DEDUP_CURSOR_SCHEMA) return null;

  return {
    schema: RELEASE_DEDUP_CURSOR_SCHEMA,
    factory_id: trim(raw.factory_id),
    last_reported_at: trim(raw.last_reported_at),
    last_release_sha: trim(raw.last_release_sha),
    seen_goal_numbers: toUniqueNumbers(raw.seen_goal_numbers),
    seen_issues: toUniqueNumbers(raw.seen_issues),
    seen_prs: toUniqueNumbers(raw.seen_prs),
    updated_at: trim(raw.updated_at),
  };
}

export function writeReleaseDedupCursor({ factoryId = "", rootDir = ".", cursor = {} } = {}) {
  const cursorPath = resolveCursorPath({ factoryId, rootDir });
  const now = new Date().toISOString();

  const payload = {
    schema: RELEASE_DEDUP_CURSOR_SCHEMA,
    factory_id: trim(factoryId) || "default",
    last_reported_at: trim(cursor.last_reported_at) || now,
    last_release_sha: trim(cursor.last_release_sha),
    seen_goal_numbers: toUniqueNumbers(cursor.seen_goal_numbers),
    seen_issues: toUniqueNumbers(cursor.seen_issues),
    seen_prs: toUniqueNumbers(cursor.seen_prs),
    updated_at: now,
  };

  mkdirSync(dirname(cursorPath), { recursive: true });
  const tmpPath = `${cursorPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmpPath, cursorPath);

  return { ok: true, cursor_path: cursorPath, cursor: payload };
}

export function updateReleaseDedupCursorFromDelivery({
  factoryId = "",
  rootDir = ".",
  reportContext = {},
  deliveryStatus = "",
} = {}) {
  const deliveredStatuses = new Set(["delivered", "published", "published_issue", "delivered_issue_only", "delivered_slack_and_issue"]);

  // deliveryStatus may be a plain string ("published") or a JSON delivery result
  // object serialized as a string ({"ok":true,"status":"published",...}).
  let status = trim(deliveryStatus);
  if (status.startsWith("{")) {
    try {
      const parsed = JSON.parse(status);
      status = trim(parsed?.status || "");
    } catch {
      // Not valid JSON — treat as raw status string
    }
  }

  // Only persist cursor on successful delivery
  if (!deliveredStatuses.has(status)) {
    return { ok: true, action: "skipped", reason: `delivery_status=${status}` };
  }

  const ctx = reportContext && typeof reportContext === "object" ? reportContext : {};
  const goals = Array.isArray(ctx.goals) ? ctx.goals : [];
  const issues = Array.isArray(ctx.issues) ? ctx.issues : [];
  const prs = Array.isArray(ctx.prs) ? ctx.prs : [];

  // Merge with existing cursor to accumulate seen items
  const existing = readReleaseDedupCursor({ factoryId, rootDir });
  const mergedGoalNumbers = [...new Set([
    ...(existing?.seen_goal_numbers || []),
    ...goals.map((g) => Number(g?.number)).filter(Number.isFinite),
  ])];
  const mergedIssues = [...new Set([
    ...(existing?.seen_issues || []),
    ...issues.map((i) => Number(i?.number)).filter(Number.isFinite),
  ])];
  const mergedPrs = [...new Set([
    ...(existing?.seen_prs || []),
    ...prs.map((p) => Number(p?.number)).filter(Number.isFinite),
  ])];

  const result = writeReleaseDedupCursor({
    factoryId,
    rootDir,
    cursor: {
      last_reported_at: trim(ctx.generated_at) || new Date().toISOString(),
      last_release_sha: trim(ctx.last_commit_sha),
      seen_goal_numbers: mergedGoalNumbers,
      seen_issues: mergedIssues,
      seen_prs: mergedPrs,
    },
  });

  return {
    ok: true,
    action: "updated",
    cursor_path: result.cursor_path,
    seen_goal_numbers_count: mergedGoalNumbers.length,
    seen_issues_count: mergedIssues.length,
    seen_prs_count: mergedPrs.length,
  };
}
