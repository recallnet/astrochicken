import {
  readBrainstormCursor,
  resolveBrainstormCursorPath,
  sha256Text,
} from "./brainstorm-cursor.ts";
import { parseJson } from "../lib/cli-helpers.ts";

const DEFAULT_SEED_PROMPT = "highest ROI goal given current state";

function toStringSafe(value = "") {
  return String(value ?? "").trim();
}

function hasBodyText(value = "") {
  return toStringSafe(value).length > 0;
}

function normalizeDelta({ currentText = "", previousText = "", changedCode = "unchanged", unchangedCode = "unchanged" } = {}) {
  const current = String(currentText || "");
  const previous = String(previousText || "");
  if (!previous) {
    return {
      status: current ? "initial" : unchangedCode,
      previous_present: "false",
      previous_value: "",
      current_value: current,
      changed: current ? "true" : "false",
    };
  }
  const changed = current !== previous;
  return {
    status: changed ? changedCode : unchangedCode,
    previous_present: "true",
    previous_value: previous,
    current_value: current,
    changed: changed ? "true" : "false",
  };
}

export function loadBrainstormContext({
  factoryId = "",
  rootDir = ".",
  brainstormIssueNumber = "",
  brainstormIssueBody = "",
  intentStackRaw = "",
  shippedGoalsSinceLastRaw = "",
  scenarioHoldoutsRaw = "",
  openBacklogSummary = "",
} = {}) {
  const issueNumber = toStringSafe(brainstormIssueNumber);
  if (!issueNumber) {
    throw new Error("brainstorm_load_context:missing_brainstorm_issue_number");
  }

  const issueBody = String(brainstormIssueBody || "");
  const seedPrompt = hasBodyText(issueBody) ? toStringSafe(issueBody) : DEFAULT_SEED_PROMPT;
  const seedPromptSource = hasBodyText(issueBody) ? "issue_body" : "default_seed";

  const intentStackText = String(intentStackRaw || "");
  const shippedGoalsText = String(shippedGoalsSinceLastRaw || "");
  const scenarioHoldoutsText = String(scenarioHoldoutsRaw || "");
  const backlogSummaryText = String(openBacklogSummary || "");

  const intentStackParsed = parseJson(intentStackText, null);
  const intentStackSummary = toStringSafe(intentStackParsed?.intent_stack_summary || "");

  const cursor = readBrainstormCursor({ factoryId, rootDir });

  const intentStackDelta = normalizeDelta({
    currentText: intentStackText,
    previousText: String(cursor?.intent_stack_snapshot || ""),
    changedCode: "changed",
    unchangedCode: "unchanged",
  });

  const shippedGoalsDelta = normalizeDelta({
    currentText: shippedGoalsText,
    previousText: String(cursor?.shipped_goals_snapshot || ""),
    changedCode: "updated",
    unchangedCode: "unchanged",
  });

  const scenarioHoldoutsDelta = normalizeDelta({
    currentText: scenarioHoldoutsText,
    previousText: String(cursor?.scenario_holdouts_snapshot || ""),
    changedCode: "updated",
    unchangedCode: "unchanged",
  });

  const cursorPath = resolveBrainstormCursorPath({ factoryId, rootDir });

  const nextCursor = {
    schema: "brainstorm-cursor/v1",
    factory_id: String(factoryId || "").trim() || "default",
    last_brainstorm_issue_number: issueNumber,
    last_seed_prompt: seedPrompt,
    last_intent_stack_sha256: sha256Text(intentStackText),
    last_shipped_goals_sha256: sha256Text(shippedGoalsText),
    last_scenario_holdouts_sha256: sha256Text(scenarioHoldoutsText),
    intent_stack_snapshot: intentStackText,
    shipped_goals_snapshot: shippedGoalsText,
    scenario_holdouts_snapshot: scenarioHoldoutsText,
  };

  return {
    brainstorm_issue_number: issueNumber,
    seed_prompt: seedPrompt,
    seed_prompt_source: seedPromptSource,
    intent_stack_changed: intentStackDelta.changed,
    intent_stack_delta: intentStackDelta,
    intent_stack_summary: intentStackSummary,
    shipped_goals_delta: shippedGoalsDelta,
    scenario_holdouts_delta: scenarioHoldoutsDelta,
    open_backlog_summary: backlogSummaryText,
    cursor_path: cursorPath,
    next_cursor: nextCursor,
    next_cursor_b64: Buffer.from(JSON.stringify(nextCursor), "utf8").toString("base64"),
  };
}
