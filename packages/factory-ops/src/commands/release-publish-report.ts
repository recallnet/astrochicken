import { gh, ghJson, trim } from "../lib/cli-helpers.ts";

export const RELEASE_REPORT_LABEL = "release-report";

const RELEASE_REPORT_LABEL_COLOR = "1d76db";
const RELEASE_REPORT_LABEL_DESCRIPTION = "Durable release understanding reports";

function asString(value) {
  return String(value ?? "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseIssueNumberFromUrl(url = "") {
  const match = asString(url).match(/\/issues\/(\d+)(?:$|[/?#])/);
  return Number(match?.[1] || 0);
}

function buildReleaseReportDateStamp(context = {}) {
  const generatedAt = new Date(asString(context?.generated_at) || Date.now());
  if (!Number.isFinite(generatedAt.getTime())) return "unknown-date";
  return generatedAt.toISOString().slice(0, 10);
}

function buildReleaseReportFingerprint({ context = {} } = {}) {
  const dateStamp = buildReleaseReportDateStamp(context);
  const factoryId = asString(context?.factory_id) || "unknown-factory";
  const goalNumbers = asArray(context?.goals)
    .map((goal) => Number(goal?.number || 0))
    .filter((number) => number > 0)
    .sort((left, right) => left - right)
    .slice(0, 5);
  const issueNumbers = asArray(context?.issues)
    .map((issue) => Number(issue?.number || 0))
    .filter((number) => number > 0)
    .sort((left, right) => left - right)
    .slice(0, 5);
  const commitCount = Number(context?.metrics?.commits_landed || 0);
  const lastCommitSha = asString(context?.last_commit_sha).slice(0, 12);
  return `${factoryId}:${dateStamp}:g-${goalNumbers.join(".") || "0"}:i-${issueNumbers.join(".") || "0"}:c-${commitCount}:last-${lastCommitSha}`;
}

function buildMetricsTable(context = {}) {
  const metrics = context?.metrics && typeof context.metrics === "object" ? context.metrics : {};
  return [
    "| Metric | Value |",
    "| --- | --- |",
    `| Factory | ${asString(context?.factory_id) || "unknown"} |`,
    `| Window | ${asString(context?.since_iso) || "(unknown)"} to ${asString(context?.generated_at) || "(unknown)"} |`,
    `| Goals closed | ${Number(metrics.goals_closed || 0)} |`,
    `| Issues closed | ${Number(metrics.issues_closed || 0)} |`,
    `| Commits landed | ${Number(metrics.commits_landed || 0)} |`,
  ].join("\n");
}

export function buildReleaseReportIssueTitle({ context = {} } = {}) {
  const factoryId = asString(context?.factory_id) || "unknown-factory";
  const stamp = buildReleaseReportDateStamp(context);
  return `Release Understanding Report — ${factoryId} — ${stamp}`;
}

export function buildReleaseReportIssueBody({ context = {}, narrative = {}, issueUrl = "" } = {}) {
  const reportBody = asString(narrative?.report_body);
  const fingerprint = buildReleaseReportFingerprint({ context });

  return [
    reportBody || "# Release understanding report\n\nNo narrative was provided.",
    "",
    "---",
    "",
    buildMetricsTable(context),
    "",
    `<!-- release-report-fingerprint: ${fingerprint} -->`,
  ].join("\n");
}

function ensureReleaseReportLabel({ repo = "", ghFn = gh } = {}) {
  if (!repo) return { ok: false, error: "missing_repo" };
  const out = ghFn([
    "label",
    "create",
    RELEASE_REPORT_LABEL,
    "--repo",
    repo,
    "--description",
    RELEASE_REPORT_LABEL_DESCRIPTION,
    "--color",
    RELEASE_REPORT_LABEL_COLOR,
    "--force",
  ]);
  return out?.ok ? { ok: true } : { ok: false, error: asString(out?.stderr || out?.stdout || "label_create_failed") };
}

function findExistingReportIssue({ repo = "", fingerprint = "", ghJsonFn = ghJson } = {}) {
  const issues = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--label",
    RELEASE_REPORT_LABEL,
    "--json",
    "number,title,url,body",
  ], []);
  return asArray(issues).find((issue) => asString(issue?.body).includes(`release-report-fingerprint: ${fingerprint}`)) || null;
}

export function publishReleaseReportIssue({ repo = "", context = {}, narrative = {}, ghFn = gh, ghJsonFn = ghJson } = {}) {
  const normalizedRepo = asString(repo || context?.repo);
  if (!normalizedRepo) {
    return { ok: false, status: "failed", error: "missing_repo", issue_number: 0, issue_url: "" };
  }

  const label = ensureReleaseReportLabel({ repo: normalizedRepo, ghFn });
  if (!label.ok) {
    return { ok: false, status: "failed", error: `label_create_failed:${label.error}`, issue_number: 0, issue_url: "" };
  }

  const title = buildReleaseReportIssueTitle({ context, narrative });
  const fingerprint = buildReleaseReportFingerprint({ context });
  const existing = findExistingReportIssue({ repo: normalizedRepo, fingerprint, ghJsonFn });
  const body = buildReleaseReportIssueBody({ context, narrative, issueUrl: existing?.url || "" });

  if (existing?.number) {
    const out = ghFn([
      "issue", "edit", String(existing.number),
      "--repo", normalizedRepo,
      "--title", title,
      "--body", body,
      "--add-label", RELEASE_REPORT_LABEL,
    ]);
    return out?.ok
      ? { ok: true, status: "published", issue_number: Number(existing.number), issue_url: asString(existing.url), title }
      : { ok: false, status: "failed", error: asString(out?.stderr || out?.stdout || "issue_update_failed"), issue_number: Number(existing.number), issue_url: asString(existing.url), title };
  }

  const out = ghFn([
    "issue", "create",
    "--repo", normalizedRepo,
    "--title", title,
    "--body", body,
    "--label", RELEASE_REPORT_LABEL,
  ]);
  const issueUrl = asString(out?.stdout);
  return out?.ok
    ? { ok: true, status: "published", issue_number: parseIssueNumberFromUrl(issueUrl), issue_url: issueUrl, title }
    : { ok: false, status: "failed", error: asString(out?.stderr || out?.stdout || "issue_create_failed"), issue_number: 0, issue_url: "", title };
}
