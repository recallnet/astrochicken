import { promises as fsPromises } from "node:fs";
import { join } from "node:path";

import { resolveGhRepo } from "./common-resolve-gh-repo.ts";
import { RELEASE_REPORT_LABEL } from "./release-publish-report.ts";
import { ghJson, trim } from "../lib/cli-helpers.ts";

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_LIMIT = 5;
const DEFAULT_OUT_DIR = "reports/comprehension";

function asString(value) {
  return trim(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function toIsoOrEmpty(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseMetricsFromBody(body = "") {
  const normalized = String(body || "");
  return {
    goals_closed: toCount(normalized.match(/\|\s*Goals closed\s*\|\s*(\d+)\s*\|/iu)?.[1]),
    issues_closed: toCount(normalized.match(/\|\s*Issues closed\s*\|\s*(\d+)\s*\|/iu)?.[1]),
    commits_landed: toCount(normalized.match(/\|\s*Commits landed\s*\|\s*(\d+)\s*\|/iu)?.[1]),
  };
}

function extractMarkdownSection(markdown = "", heading = "") {
  const source = String(markdown || "");
  const title = String(heading || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)##\\s+${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n<!--\\s*comprehension-json:|$)`, "u");
  const match = source.match(re);
  return match ? trim(match[1]) : "";
}

function parseBulletList(section = "") {
  const lines = String(section || "").split("\n");
  return lines
    .map((line) => line.match(/^\s*-\s+(.*)$/u)?.[1] || "")
    .map((line) => asString(line).replace(/^`(.+)`$/u, "$1"))
    .filter((line) => line && !/^none\.?$/iu.test(line));
}

function parseComprehensionJsonComment(markdown = "") {
  const source = String(markdown || "");
  const match = source.match(/<!--\s*comprehension-json:\s*([\s\S]*?)\s*-->/u);
  if (!match?.[1]) return {};

  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStringArray(value) {
  return asArray(value)
    .map((entry) => asString(entry).replace(/^`(.+)`$/u, "$1"))
    .filter(Boolean);
}

function parseNarrativeSections(body = "") {
  const fromSections = {
    conceptual_shift: asString(extractMarkdownSection(body, "Conceptual Shift")),
    why_it_matters: asString(extractMarkdownSection(body, "Why It Matters")),
    entry_points: parseBulletList(extractMarkdownSection(body, "Entry Points")),
    watch_items: parseBulletList(extractMarkdownSection(body, "Watch Items")),
  };
  const fromComment = parseComprehensionJsonComment(body);

  return {
    conceptual_shift: fromSections.conceptual_shift || asString(fromComment.conceptual_shift) || null,
    why_it_matters: fromSections.why_it_matters || asString(fromComment.why_it_matters) || null,
    entry_points: fromSections.entry_points.length > 0
      ? fromSections.entry_points
      : normalizeStringArray(fromComment.entry_points),
    watch_items: fromSections.watch_items.length > 0
      ? fromSections.watch_items
      : normalizeStringArray(fromComment.watch_items),
  };
}

export function parseReleaseReportIssue(rawIssue = {}) {
  const body = String(rawIssue?.body || "");
  const metrics = parseMetricsFromBody(body);
  const sections = parseNarrativeSections(body);

  return {
    issue_number: toCount(rawIssue?.number),
    title: asString(rawIssue?.title),
    url: asString(rawIssue?.url),
    updated_at: toIsoOrEmpty(rawIssue?.updated_at || rawIssue?.updatedAt),
    metrics,
    conceptual_shift: sections.conceptual_shift,
    why_it_matters: sections.why_it_matters,
    entry_points: sections.entry_points,
    watch_items: sections.watch_items,
  };
}

export function scoreComprehensionEntry(entry = {}) {
  const metrics = entry?.metrics && typeof entry.metrics === "object" ? entry.metrics : {};
  return (
    (toCount(metrics.goals_closed) * 4)
    + (toCount(metrics.issues_closed) * 2)
    + toCount(metrics.commits_landed)
  );
}

export function rankComprehensionEntries(entries = [], limit = DEFAULT_LIMIT) {
  const normalizedLimit = parsePositiveInt(limit, DEFAULT_LIMIT);
  const ranked = asArray(entries)
    .map((entry) => ({
      ...entry,
      score: scoreComprehensionEntry(entry),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const aMs = Date.parse(asString(a.updated_at));
      const bMs = Date.parse(asString(b.updated_at));
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && bMs !== aMs) return bMs - aMs;
      if (Number.isFinite(bMs) && !Number.isFinite(aMs)) return -1;
      if (Number.isFinite(aMs) && !Number.isFinite(bMs)) return 1;

      return toCount(b.issue_number) - toCount(a.issue_number);
    });

  return ranked.slice(0, normalizedLimit);
}

export function buildTopEntryPoints(entries = []) {
  const byEntry = new Map();
  entries.forEach((entry, index) => {
    const rankWeight = Math.max(1, entries.length - index);
    for (const rawPoint of asArray(entry?.entry_points)) {
      const point = asString(rawPoint);
      if (!point) continue;

      const existing = byEntry.get(point) || {
        point,
        total_weight: 0,
        appearances: 0,
        first_seen_rank: Number.POSITIVE_INFINITY,
      };

      existing.total_weight += rankWeight;
      existing.appearances += 1;
      existing.first_seen_rank = Math.min(existing.first_seen_rank, index);
      byEntry.set(point, existing);
    }
  });

  return [...byEntry.values()]
    .sort((a, b) => {
      if (b.total_weight !== a.total_weight) return b.total_weight - a.total_weight;
      if (b.appearances !== a.appearances) return b.appearances - a.appearances;
      if (a.first_seen_rank !== b.first_seen_rank) return a.first_seen_rank - b.first_seen_rank;
      return a.point.localeCompare(b.point);
    })
    .map((entry) => entry.point);
}

function isoToFileStamp(iso = "") {
  return String(iso || "")
    .replace(/[:.]/g, "")
    .replace(/-/g, "")
    .replace(/\+00:00$/u, "Z")
    .replace(/\+0000$/u, "Z");
}

export function sanitizeRepoForFileName(repo = "") {
  return asString(repo)
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "repo";
}

export function buildCatchupFileBasename({ generatedAt = "", repo = "" } = {}) {
  const stamp = isoToFileStamp(generatedAt) || isoToFileStamp(new Date().toISOString());
  const repoSlug = sanitizeRepoForFileName(repo);
  return `catchup-${stamp}-${repoSlug}`;
}

export function renderComprehensionCatchupMarkdown(payload = {}) {
  const entries = asArray(payload.entries);
  const lines = [
    `# Release Comprehension Catch-up — ${asString(payload.repo) || "(unknown repo)"}`,
    "",
    `Generated at: ${asString(payload.generated_at) || "(unknown)"}`,
    `Window: ${asString(payload?.catchup_window?.since_iso) || "(unknown)"} → ${asString(payload?.catchup_window?.now_iso) || "(unknown)"}`,
    "",
    "## Top Entry Points",
  ];

  if (asArray(payload.top_entry_points).length === 0) {
    lines.push("- None");
  } else {
    for (const point of payload.top_entry_points) {
      lines.push(`- \`${asString(point)}\``);
    }
  }

  lines.push("", "## Ranked Conceptual Shifts");

  if (entries.length === 0) {
    lines.push("- No release-report issues were found in this catch-up window.");
    lines.push("");
    return lines.join("\n");
  }

  entries.forEach((entry, index) => {
    lines.push(
      `### ${index + 1}. #${toCount(entry.issue_number)} ${asString(entry.title) || "Untitled report"}`,
      `- URL: ${asString(entry.url) || "(missing)"}`,
      `- Updated: ${asString(entry.updated_at) || "(unknown)"}`,
      `- Score: ${toCount(entry.score)}`,
      `- Metrics: goals_closed=${toCount(entry?.metrics?.goals_closed)}, issues_closed=${toCount(entry?.metrics?.issues_closed)}, commits_landed=${toCount(entry?.metrics?.commits_landed)}`,
      `- Conceptual Shift: ${asString(entry.conceptual_shift) || "(missing)"}`,
      `- Why It Matters: ${asString(entry.why_it_matters) || "(missing)"}`,
      "- Entry Points:",
      ...(asArray(entry.entry_points).length > 0
        ? asArray(entry.entry_points).map((point) => `  - \`${asString(point)}\``)
        : ["  - None"]),
      "- Watch Items:",
      ...(asArray(entry.watch_items).length > 0
        ? asArray(entry.watch_items).map((item) => `  - ${asString(item)}`)
        : ["  - None"]),
      "",
    );
  });

  return lines.join("\n");
}

export async function collectReleaseReportIssues({ repo = "", sinceIso = "", ghJsonFn = ghJson } = {}) {
  const rows = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--label",
    RELEASE_REPORT_LABEL,
    "--since",
    sinceIso,
    "--limit",
    "200",
    "--json",
    "number,title,url,updatedAt,body",
  ], []);

  return asArray(rows).map((issue) => parseReleaseReportIssue(issue));
}

export async function runReleaseComprehensionCatchup(options = {}) {
  const lookbackDays = parsePositiveInt(options.lookbackDays, DEFAULT_LOOKBACK_DAYS);
  const limit = parsePositiveInt(options.limit, DEFAULT_LIMIT);
  const outDir = asString(options.outDir) || DEFAULT_OUT_DIR;
  const nowDate = typeof options.clock === "function" ? options.clock() : new Date();
  const nowIso = new Date(nowDate).toISOString();
  const sinceIso = new Date(Date.parse(nowIso) - (lookbackDays * 24 * 60 * 60 * 1000)).toISOString();

  const repo = resolveGhRepo(options.repo, {
    env: options.env,
    cwd: options.cwd,
    factoryRoot: options.factoryRoot,
    factoryConfigPath: options.factoryConfigPath,
    configPath: options.configPath,
    factoryId: options.factoryId,
    targetRepo: options.targetRepo,
    controlPlaneRepo: options.controlPlaneRepo,
    kindId: options.kindId,
    instanceId: options.instanceId,
    destinationsJson: options.destinationsJson,
    runsDir: options.runsDir,
    scenariosRoot: options.scenariosRoot,
  });

  const issues = await collectReleaseReportIssues({
    repo,
    sinceIso,
    ghJsonFn: options.ghJsonFn || ghJson,
  });

  const ranked = rankComprehensionEntries(issues, limit);
  const payload = {
    generated_at: nowIso,
    repo,
    catchup_window: {
      since_iso: sinceIso,
      now_iso: nowIso,
      lookback_days: lookbackDays,
    },
    entries: ranked,
    top_entry_points: buildTopEntryPoints(ranked),
  };

  const baseName = buildCatchupFileBasename({ generatedAt: nowIso, repo });
  const jsonPath = join(outDir, `${baseName}.json`);
  const markdownPath = join(outDir, `${baseName}.md`);

  const runtimeFs = options.fs || fsPromises;
  await runtimeFs.mkdir(outDir, { recursive: true });
  await runtimeFs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await runtimeFs.writeFile(markdownPath, `${renderComprehensionCatchupMarkdown(payload)}\n`, "utf8");

  return {
    ok: true,
    repo,
    generated_at: nowIso,
    lookback_days: lookbackDays,
    limit,
    issues_scanned: issues.length,
    entries_ranked: ranked.length,
    json_path: jsonPath,
    markdown_path: markdownPath,
    top_entry_points: payload.top_entry_points,
    no_release_reports: issues.length === 0,
  };
}
