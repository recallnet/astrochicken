import { promises as fsPromises } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { gh, trim } from "../lib/cli-helpers.ts";

export const EXAMPLE_WEB_REPO = "example-org/example-web";
export const EXAMPLE_WEB_COMPREHENSION_LABEL = "example-web:comprehension-contract";
export const EXAMPLE_WEB_COMPREHENSION_LABEL_COLOR = "5319e7";
export const EXAMPLE_WEB_COMPREHENSION_LABEL_DESCRIPTION = "Studio UI contract for release comprehension payloads";
export const EXAMPLE_WEB_CURSOR_SCHEMA = "example-web-comprehension-issue-cursor/v1";
export const EXAMPLE_WEB_CURSOR_RELATIVE_PATH = ".factory/state/example-web-comprehension-issue.json";

function asString(value) {
  return trim(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function parseIssueNumberFromUrl(url = "") {
  const match = asString(url).match(/\/issues\/(\d+)(?:$|[/?#])/u);
  return Number(match?.[1] || 0);
}

function renderList(items = [], { code = false, fallback = "- None" } = {}) {
  const rows = asArray(items).map((item) => `- ${code ? `\`${item}\`` : item}`);
  return rows.length > 0 ? rows.join("\n") : fallback;
}

function buildComprehensionDebtSignals(narrative = {}) {
  const explicit = asArray(narrative?.comprehension_debt_signals);
  if (explicit.length > 0) return explicit;

  const inferred = [
    ...asArray(narrative?.watch_items),
    ...asArray(narrative?.implicit_decisions),
  ];
  return [...new Set(inferred)];
}

function buildDeliveryLinks({ context = {}, narrative = {} } = {}) {
  const candidates = [
    narrative?.report_issue_url,
    narrative?.release_report_issue_url,
    context?.report_issue_url,
    context?.release_report_issue_url,
    context?.issue_url,
    context?.release_issue_url,
    narrative?.slack_permalink,
    narrative?.slack_url,
    context?.slack_permalink,
    context?.slack_url,
    context?.slack_message_url,
  ]
    .map((value) => asString(value))
    .filter(Boolean);

  return [...new Set(candidates)];
}

function resolveGeneratedAt(context = {}) {
  const raw = asString(context?.generated_at);
  if (raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export function buildReleaseShapingFollowupIssueTitle({ context = {} } = {}) {
  return `Comprehension UI contract — ${resolveGeneratedAt(context)}`;
}

export function buildReleaseShapingFollowupIssueBody({ context = {}, narrative = {}, factoryId = "" } = {}) {
  const normalizedContext = asObject(context);
  const normalizedNarrative = asObject(narrative);
  const generatedAt = resolveGeneratedAt(normalizedContext);

  const headline = asString(normalizedNarrative?.headline) || "Comprehension contract update";
  const summary = asString(normalizedNarrative?.summary) || "Release narration did not provide a summary.";
  const structuralChanges = asArray(normalizedNarrative?.structural_changes);
  const behavioralShifts = asArray(normalizedNarrative?.behavioral_shifts);
  const implicitDecisions = asArray(normalizedNarrative?.implicit_decisions);
  const entryPoints = asArray(normalizedNarrative?.entry_points);
  const proofPoints = asArray(normalizedNarrative?.proof_points);
  const debtSignals = buildComprehensionDebtSignals(normalizedNarrative);
  const diffText = asString(normalizedContext?.diff_stats?.text) || "(diff stats unavailable)";
  const metrics = asObject(normalizedContext?.metrics);
  const deliveryLinks = buildDeliveryLinks({ context: normalizedContext, narrative: normalizedNarrative });

  const payloadSample = {
    generated_at: generatedAt,
    factory_id: asString(factoryId) || asString(normalizedContext?.factory_id) || "unknown",
    repo: asString(normalizedContext?.repo) || "unknown",
    structural_changes: structuralChanges,
    behavioral_shifts: behavioralShifts,
    implicit_decisions: implicitDecisions,
    entry_points: entryPoints,
    comprehension_debt_signals: debtSignals,
  };

  return [
    `# ${headline}`,
    "",
    "## Orientation",
    summary,
    "",
    "## Structural & Behavioral Signals",
    `- Window: ${asString(normalizedContext?.since_iso) || "(unknown)"} → ${generatedAt}`,
    `- Diff stats: ${diffText}`,
    `- Metrics: goals_closed=${Number(metrics.goals_closed || 0)}, issues_closed=${Number(metrics.issues_closed || 0)}, commits_landed=${Number(metrics.commits_landed || 0)}`,
    "",
    "### Structural changes",
    renderList(structuralChanges),
    "",
    "### Behavioral shifts",
    renderList(behavioralShifts),
    "",
    "### Implicit decisions",
    renderList(implicitDecisions),
    "",
    "### Entry points",
    renderList(entryPoints, { code: true }),
    "",
    "### Proof points",
    renderList(proofPoints),
    "",
    "### Comprehension debt signals",
    renderList(debtSignals),
    "",
    "## Payload Contract",
    "The Studio surface should ingest a comprehension payload with these fields:",
    "- `structural_changes`",
    "- `behavioral_shifts`",
    "- `implicit_decisions`",
    "- `entry_points`",
    "- `comprehension_debt_signals`",
    "",
    "```json",
    JSON.stringify(payloadSample, null, 2),
    "```",
    "",
    "## Delivery Links",
    renderList(deliveryLinks, { fallback: "- No release report issue or Slack link was provided." }),
    "",
    `<!-- example-web-comprehension-contract generated_at=${generatedAt} factory_id=${asString(factoryId) || asString(normalizedContext?.factory_id) || ""} -->`,
    "",
  ].join("\n");
}

function resolveCursorPath(repoPath = ".") {
  return join(resolve(String(repoPath || ".")), EXAMPLE_WEB_CURSOR_RELATIVE_PATH);
}

async function readCursor({ repoPath = ".", fs = fsPromises, warn }) {
  const cursorPath = resolveCursorPath(repoPath);
  try {
    const raw = await fs.readFile(cursorPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      warn(`cursor_read_invalid path=${cursorPath}`);
      return { cursorPath, cursor: null };
    }
    if (asString(parsed.schema) !== EXAMPLE_WEB_CURSOR_SCHEMA) {
      warn(`cursor_schema_mismatch path=${cursorPath}`);
      return { cursorPath, cursor: null };
    }

    const issueNumber = Number(parsed.issue_number || 0);
    const generatedAt = asString(parsed.generated_at);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0 || !generatedAt) {
      warn(`cursor_contract_invalid path=${cursorPath}`);
      return { cursorPath, cursor: null };
    }

    return {
      cursorPath,
      cursor: {
        schema: EXAMPLE_WEB_CURSOR_SCHEMA,
        generated_at: generatedAt,
        issue_number: Math.trunc(issueNumber),
        issue_url: asString(parsed.issue_url),
      },
    };
  } catch (error) {
    if (String(error?.code || "") !== "ENOENT") {
      warn(`cursor_read_failed path=${cursorPath} error=${String(error?.message || error)}`);
    }
    return { cursorPath, cursor: null };
  }
}

async function writeCursor({ repoPath = ".", issueNumber = 0, issueUrl = "", generatedAt = "", fs = fsPromises, warn }) {
  const cursorPath = resolveCursorPath(repoPath);
  const payload = {
    schema: EXAMPLE_WEB_CURSOR_SCHEMA,
    generated_at: generatedAt,
    issue_number: Math.trunc(Number(issueNumber) || 0),
    issue_url: asString(issueUrl),
    updated_at: new Date().toISOString(),
  };

  try {
    await fs.mkdir(dirname(cursorPath), { recursive: true });
    await fs.writeFile(cursorPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { ok: true, cursorPath };
  } catch (error) {
    warn(`cursor_write_failed path=${cursorPath} error=${String(error?.message || error)}`);
    return { ok: false, cursorPath };
  }
}

function ensureShapingLabel({ ghFn = gh, warn }) {
  try {
    const out = ghFn([
      "label",
      "create",
      EXAMPLE_WEB_COMPREHENSION_LABEL,
      "--repo",
      EXAMPLE_WEB_REPO,
      "--description",
      EXAMPLE_WEB_COMPREHENSION_LABEL_DESCRIPTION,
      "--color",
      EXAMPLE_WEB_COMPREHENSION_LABEL_COLOR,
      "--force",
    ]);

    if (!out?.ok) {
      warn(`gh_label_ensure_failed repo=${EXAMPLE_WEB_REPO} label=${EXAMPLE_WEB_COMPREHENSION_LABEL} error=${asString(out?.stderr || out?.stdout || "label_create_failed")}`);
    }
  } catch (error) {
    warn(`gh_label_ensure_failed repo=${EXAMPLE_WEB_REPO} label=${EXAMPLE_WEB_COMPREHENSION_LABEL} error=${asString(error?.message || error || "label_create_failed")}`);
  }
}

function editIssue({ issueNumber = 0, title = "", body = "", ghFn = gh, warn }) {
  try {
    const out = ghFn([
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      EXAMPLE_WEB_REPO,
      "--title",
      title,
      "--body",
      body,
      "--add-label",
      EXAMPLE_WEB_COMPREHENSION_LABEL,
    ]);

    if (!out?.ok) {
      warn(`gh_issue_edit_failed issue=${issueNumber} error=${asString(out?.stderr || out?.stdout || "issue_edit_failed")}`);
      return { ok: false, issue_number: Number(issueNumber) || 0, issue_url: "" };
    }

    return { ok: true, issue_number: Number(issueNumber) || 0, issue_url: "" };
  } catch (error) {
    warn(`gh_issue_edit_failed issue=${issueNumber} error=${asString(error?.message || error || "issue_edit_failed")}`);
    return { ok: false, issue_number: Number(issueNumber) || 0, issue_url: "" };
  }
}

function createIssue({ title = "", body = "", ghFn = gh, warn }) {
  try {
    const out = ghFn([
      "issue",
      "create",
      "--repo",
      EXAMPLE_WEB_REPO,
      "--title",
      title,
      "--body",
      body,
      "--label",
      EXAMPLE_WEB_COMPREHENSION_LABEL,
    ]);

    if (!out?.ok) {
      warn(`gh_issue_create_failed error=${asString(out?.stderr || out?.stdout || "issue_create_failed")}`);
      return { ok: false, issue_number: 0, issue_url: "" };
    }

    const issueUrl = asString(out?.stdout);
    return {
      ok: true,
      issue_number: parseIssueNumberFromUrl(issueUrl),
      issue_url: issueUrl,
    };
  } catch (error) {
    warn(`gh_issue_create_failed error=${asString(error?.message || error || "issue_create_failed")}`);
    return { ok: false, issue_number: 0, issue_url: "" };
  }
}

export async function runReleaseShapingFollowup(options = {}) {
  const context = asObject(options.context);
  const narrative = asObject(options.narrative);
  const repoPath = asString(options.repoPath) || ".";
  const factoryId = asString(options.factoryId);
  const ghFn = typeof options.ghFn === "function" ? options.ghFn : gh;
  const fs = options.fs || fsPromises;
  const warnings = [];

  const warn = (message) => {
    const normalized = asString(message);
    if (!normalized) return;
    warnings.push(normalized);
    if (typeof options.warnFn === "function") {
      options.warnFn(normalized);
    }
  };

  const generatedAt = resolveGeneratedAt(context);
  const title = buildReleaseShapingFollowupIssueTitle({ context: { ...context, generated_at: generatedAt } });
  const body = buildReleaseShapingFollowupIssueBody({ context: { ...context, generated_at: generatedAt }, narrative, factoryId });

  ensureShapingLabel({ ghFn, warn });

  const { cursorPath, cursor } = await readCursor({ repoPath, fs, warn });
  const shouldEdit = cursor?.generated_at === generatedAt && Number(cursor?.issue_number || 0) > 0;

  const issueResult = shouldEdit
    ? editIssue({ issueNumber: cursor.issue_number, title, body, ghFn, warn })
    : createIssue({ title, body, ghFn, warn });

  if (issueResult.ok && Number(issueResult.issue_number || 0) > 0) {
    await writeCursor({
      repoPath,
      issueNumber: issueResult.issue_number,
      issueUrl: issueResult.issue_url || cursor?.issue_url || "",
      generatedAt,
      fs,
      warn,
    });
  }

  return {
    ok: true,
    status: issueResult.ok ? "published" : "best_effort_failed",
    action: issueResult.ok ? (shouldEdit ? "updated" : "created") : (shouldEdit ? "update_failed" : "create_failed"),
    issue_number: Number(issueResult.issue_number || cursor?.issue_number || 0),
    issue_url: asString(issueResult.issue_url || cursor?.issue_url),
    generated_at: generatedAt,
    target_repo: EXAMPLE_WEB_REPO,
    label: EXAMPLE_WEB_COMPREHENSION_LABEL,
    cursor_path: cursorPath,
    warnings,
  };
}
