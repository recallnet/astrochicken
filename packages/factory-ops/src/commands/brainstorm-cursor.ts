import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseJson, trim } from "../lib/cli-helpers.ts";

export const BRAINSTORM_CURSOR_SCHEMA = "brainstorm-cursor/v1";

function normalizeFactoryId(factoryId = "") {
  return trim(factoryId) || "default";
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export function resolveBrainstormCursorPath({ factoryId = "", rootDir = "." } = {}) {
  return join(String(rootDir || "."), ".hatch", "factories", normalizeFactoryId(factoryId), "brainstorm-cursor.json");
}

export const BRAINSTORM_CONTEXT_CURSOR_SCHEMA = BRAINSTORM_CURSOR_SCHEMA;
export const resolveBrainstormContextCursorPath = resolveBrainstormCursorPath;

export function sha256Text(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function readBrainstormCursor({ factoryId = "", rootDir = "." } = {}) {
  const cursorPath = resolveBrainstormCursorPath({ factoryId, rootDir });
  if (!existsSync(cursorPath)) return null;

  const raw = parseJson(readFileSync(cursorPath, "utf8"), null);
  if (!raw || typeof raw !== "object") return null;
  if (normalizeText(raw.schema) !== BRAINSTORM_CURSOR_SCHEMA) return null;

  return {
    schema: BRAINSTORM_CURSOR_SCHEMA,
    factory_id: normalizeFactoryId(raw.factory_id || factoryId),
    last_brainstorm_issue_number: normalizeText(raw.last_brainstorm_issue_number),
    last_seed_prompt: normalizeText(raw.last_seed_prompt),
    last_intent_stack_sha256: normalizeText(raw.last_intent_stack_sha256),
    last_shipped_goals_sha256: normalizeText(raw.last_shipped_goals_sha256),
    last_scenario_holdouts_sha256: normalizeText(raw.last_scenario_holdouts_sha256),
    intent_stack_snapshot: String(raw.intent_stack_snapshot || ""),
    shipped_goals_snapshot: String(raw.shipped_goals_snapshot || ""),
    scenario_holdouts_snapshot: String(raw.scenario_holdouts_snapshot || ""),
    updated_at: normalizeText(raw.updated_at),
  };
}

export function writeBrainstormCursor({
  factoryId = "",
  rootDir = ".",
  cursor = {},
} = {}) {
  const cursorPath = resolveBrainstormCursorPath({ factoryId, rootDir });
  const now = new Date().toISOString();
  const payload = {
    schema: BRAINSTORM_CURSOR_SCHEMA,
    factory_id: normalizeFactoryId(factoryId),
    last_brainstorm_issue_number: normalizeText(cursor.last_brainstorm_issue_number),
    last_seed_prompt: normalizeText(cursor.last_seed_prompt),
    last_intent_stack_sha256: normalizeText(cursor.last_intent_stack_sha256),
    last_shipped_goals_sha256: normalizeText(cursor.last_shipped_goals_sha256),
    last_scenario_holdouts_sha256: normalizeText(cursor.last_scenario_holdouts_sha256),
    intent_stack_snapshot: String(cursor.intent_stack_snapshot || ""),
    shipped_goals_snapshot: String(cursor.shipped_goals_snapshot || ""),
    scenario_holdouts_snapshot: String(cursor.scenario_holdouts_snapshot || ""),
    updated_at: now,
  };

  mkdirSync(dirname(cursorPath), { recursive: true });
  const tmpPath = `${cursorPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmpPath, cursorPath);

  return {
    ok: true,
    cursor_path: cursorPath,
    cursor: payload,
  };
}

export const readBrainstormContextCursor = readBrainstormCursor;
export const writeBrainstormContextCursor = writeBrainstormCursor;
