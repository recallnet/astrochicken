import { parseJson } from "../lib/cli-helpers.ts";

function toNumber(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : 0;
}

function buildRepairPrompt(errors = [], goalIssues = []) {
  return [
    "Your previous goal review JSON failed deterministic validation.",
    "Re-emit the full decisions JSON and fix every error below.",
    ...errors.map((error, index) => `${index + 1}. ${error}`),
    "",
    "Known open goals:",
    JSON.stringify(goalIssues, null, 2),
    "",
    "Rules:",
    "- Include every input goal exactly once.",
    "- Use only issue numbers from the input.",
    "- decision must be keep, duplicate, or close.",
    "- duplicate requires canonical_issue pointing to another input goal.",
    "- keep/close must not set canonical_issue.",
  ].join("\n");
}

export function validateGoalDecisions({ decisionsRaw = "", goalIssuesRaw = "[]" } = {}) {
  const parsed = parseJson(decisionsRaw, null);
  const goalIssues = parseJson(goalIssuesRaw, []);
  const goalRows = Array.isArray(goalIssues) ? goalIssues : [];
  const validGoals = new Set(goalRows.map((item) => toNumber(item?.number)).filter((item) => item > 0));

  if (!parsed || !Array.isArray(parsed.decisions)) {
    return {
      ok: false,
      error: "goal review must return an object with a decisions array",
      retry_prompt: buildRepairPrompt(["Return an object with top-level key `decisions` containing an array."], goalRows),
      decisions: [],
    };
  }

  const errors = [];
  const normalized = [];
  const seen = new Set();

  for (const item of parsed.decisions) {
    const issue = toNumber(item?.issue_number);
    const decision = String(item?.decision || "").trim().toLowerCase();
    const canonicalIssue = toNumber(item?.canonical_issue);
    const reason = String(item?.reason || "").trim();

    if (!validGoals.has(issue)) errors.push(`decision references unknown goal #${String(item?.issue_number ?? "")}`);
    if (seen.has(issue)) errors.push(`goal #${issue} appears more than once in decisions`);
    if (issue > 0) seen.add(issue);
    if (!["keep", "duplicate", "close"].includes(decision)) errors.push(`goal #${issue || "?"} has invalid decision ${decision || "(empty)"}`);
    if (decision === "duplicate") {
      if (!validGoals.has(canonicalIssue) || canonicalIssue === issue) errors.push(`goal #${issue} duplicate canonical_issue must reference another input goal`);
    } else if (canonicalIssue > 0) {
      errors.push(`goal #${issue} set canonical_issue but decision is ${decision}`);
    }

    normalized.push({
      issue_number: issue,
      decision,
      canonical_issue: canonicalIssue,
      reason,
    });
  }

  for (const issue of validGoals) {
    if (!seen.has(issue)) errors.push(`input goal #${issue} is missing from decisions`);
  }

  const ok = errors.length === 0;
  return {
    ok,
    error: ok ? "" : errors.join("; "),
    retry_prompt: ok ? "" : buildRepairPrompt(errors, goalRows),
    decisions: ok ? normalized : [],
  };
}
