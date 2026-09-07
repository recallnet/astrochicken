import { trim, parseJson, gh } from "../lib/cli-helpers.ts";
import { resolveDestinationRoute } from "../lib/factory-repo-identity.ts";

function requiredText(value = "", key = "value") {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`brainstorm_create_goal:missing_${key}`);
  return normalized;
}

function parseFinalReport(raw = "") {
  const parsed = parseJson(String(raw || ""), null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("brainstorm_create_goal:malformed_final_report_json");
  }
  return parsed;
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function toBulletList(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "- TBD";
  return items.map((item) => `- ${item}`).join("\n");
}

function renderGoalIssueBody({ seedPrompt = "", report = {}, finalRound = "" } = {}) {
  const goalText = trim(report.proposal) || `Propose and ship a high-ROI goal direction: ${seedPrompt}`;
  const successCriteria = toArray(report.success_criteria);
  const scopeIn = toArray(report.scope_in);
  const scopeOut = toArray(report.scope_out);
  const risks = toArray(report.risks);
  const constraints = [
    "Review and approve before adding the ready label.",
    `Derived from brainstorm deliberation (round=${finalRound || "unknown"}).`,
  ];
  const references = [
    `Seed prompt: ${seedPrompt}`,
    "Source: brainstorm capability deliberation output",
  ];

  return [
    "## Goal",
    goalText,
    "",
    "## Success Criteria",
    toBulletList(successCriteria),
    "",
    "## Scope In",
    toBulletList(scopeIn),
    "",
    "## Scope Out",
    toBulletList(scopeOut),
    "",
    "## Constraints",
    toBulletList(constraints),
    "",
    risks.length > 0 ? "## Risks" : null,
    risks.length > 0 ? toBulletList(risks) : null,
    risks.length > 0 ? "" : null,
    "## References",
    toBulletList(references),
  ].filter((line) => line !== null).join("\n");
}

function parseIssueNumberFromUrl(url = "") {
  const match = String(url || "").trim().match(/\/issues\/(\d+)$/);
  return match?.[1] ? String(match[1]) : "";
}

function resolveGoalRoute({ repo = "", destinationsJson = "", destinations = null } = {}) {
  const hasDestinationPayload = trim(destinationsJson) || destinations != null;
  if (!hasDestinationPayload) {
    const repoSlug = requiredText(repo, "repo");
    return { repo: repoSlug, labels: ["goal", "source:brainstorm"] };
  }

  const route = resolveDestinationRoute(
    {
      destinations_json: destinationsJson,
      destinations,
    },
    "goal_issues",
  );

  return {
    repo: route.repo,
    labels: Array.from(new Set(["goal", "source:brainstorm", ...route.labels])),
  };
}

export function createBrainstormGoalIssue({
  repo = "",
  destinationsJson = "",
  destinations = null,
  brainstormIssueNumber = "",
  seedPrompt = "",
  finalRound = "",
  finalReportRaw = "",
  ghExec = gh,
} = {}) {
  const route = resolveGoalRoute({ repo, destinationsJson, destinations });
  requiredText(brainstormIssueNumber, "brainstorm_issue_number");
  const seed = requiredText(seedPrompt, "seed_prompt");

  const report = parseFinalReport(finalReportRaw);

  const issueTitle = trim(report.proposal) || `Goal: ${seed}`;
  const issueBody = renderGoalIssueBody({ seedPrompt: seed, report, finalRound });

  const out = ghExec([
    "issue",
    "create",
    "--repo",
    route.repo,
    "--title",
    issueTitle.startsWith("Goal:") ? issueTitle : `Goal: ${issueTitle}`,
    "--body",
    issueBody,
    ...route.labels.flatMap((label) => ["--label", label]),
  ]);

  if (!out.ok) {
    throw new Error(`brainstorm_create_goal:issue_create_failed:${trim(out.stderr || out.stdout || "unknown_error")}`);
  }

  const issueUrl = trim(out.stdout);
  const issueNumber = parseIssueNumberFromUrl(issueUrl);

  return {
    ok: true,
    goal_issue_url: issueUrl,
    goal_issue_number: issueNumber,
    goal_issue_title: issueTitle.startsWith("Goal:") ? issueTitle : `Goal: ${issueTitle}`,
    ready_label_applied: "false",
  };
}
