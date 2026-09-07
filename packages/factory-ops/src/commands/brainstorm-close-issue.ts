import { writeBrainstormCursor } from "./brainstorm-cursor.ts";
import { parseJson, trim, gh } from "../lib/cli-helpers.ts";

function requiredText(value = "", key = "value") {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`brainstorm_close_issue:missing_${key}`);
  return normalized;
}

function parseNextCursorPayload(raw = "") {
  const parsed = parseJson(String(raw || ""), null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  if (String(parsed.schema || "").trim() !== "brainstorm-cursor/v1") {
    return null;
  }

  return {
    last_brainstorm_issue_number: String(parsed.last_brainstorm_issue_number || "").trim(),
    last_seed_prompt: String(parsed.last_seed_prompt || "").trim(),
    last_intent_stack_sha256: String(parsed.last_intent_stack_sha256 || "").trim(),
    last_shipped_goals_sha256: String(parsed.last_shipped_goals_sha256 || "").trim(),
    last_scenario_holdouts_sha256: String(parsed.last_scenario_holdouts_sha256 || "").trim(),
    intent_stack_snapshot: String(parsed.intent_stack_snapshot || ""),
    shipped_goals_snapshot: String(parsed.shipped_goals_snapshot || ""),
    scenario_holdouts_snapshot: String(parsed.scenario_holdouts_snapshot || ""),
  };
}

export function closeBrainstormIssue({
  // Repo must be the managed target_repo when invoked from domain_brainstorm.
  repo = "",
  brainstormIssueNumber = "",
  factoryId = "",
  rootDir = ".",
  nextCursorRaw = "",
  ghExec = gh,
} = {}) {
  const repoSlug = requiredText(repo, "repo");
  const issueNumber = requiredText(brainstormIssueNumber, "brainstorm_issue_number");

  const comment = "Brainstorm complete.";

  const commentOut = ghExec([
    "issue",
    "comment",
    issueNumber,
    "--repo",
    repoSlug,
    "--body",
    comment,
  ]);
  if (!commentOut.ok) {
    throw new Error(`brainstorm_close_issue:comment_failed:${trim(commentOut.stderr || commentOut.stdout || "unknown_error")}`);
  }

  const closeOut = ghExec([
    "issue",
    "close",
    issueNumber,
    "--repo",
    repoSlug,
    "--reason",
    "completed",
  ]);
  if (!closeOut.ok) {
    throw new Error(`brainstorm_close_issue:close_failed:${trim(closeOut.stderr || closeOut.stdout || "unknown_error")}`);
  }

  const nextCursor = parseNextCursorPayload(nextCursorRaw);
  const cursorResult = nextCursor
    ? writeBrainstormCursor({
      factoryId,
      rootDir,
      cursor: {
        ...nextCursor,
        last_brainstorm_issue_number: nextCursor.last_brainstorm_issue_number || issueNumber,
      },
    })
    : null;

  return {
    ok: true,
    brainstorm_issue_number: issueNumber,
    closed: "true",
    cursor_path: cursorResult?.cursor_path || "",
    cursor_updated_at: cursorResult?.cursor?.updated_at || "",
  };
}
