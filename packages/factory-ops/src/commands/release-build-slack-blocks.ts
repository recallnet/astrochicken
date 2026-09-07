import { trim } from "../lib/cli-helpers.ts";

const HEADER_TEXT_MAX = 150;
const SECTION_TEXT_MAX = 3000;
const FALLBACK_TEXT_MAX = 4000;
const CONTEXT_TEXT_MAX = 300;

export const SLACK_NARRATIVE_HEADLINE_FALLBACK = "Comprehension detail pending.";
export const SLACK_NARRATIVE_SUMMARY_FALLBACK = "Comprehension detail pending.";
export const SLACK_CONCEPTUAL_SHIFT_FALLBACK = "Conceptual shift was not described by the narrator.";
export const SLACK_WATCH_ITEMS_FALLBACK = "No watch items were provided.";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function fallbackString(value, fallback) {
  const normalized = trim(value);
  return normalized || String(fallback || "").trim();
}

function toTextList(value) {
  return Array.isArray(value)
    ? value.map((entry) => trim(entry)).filter(Boolean)
    : [];
}

function truncateHeaderText(value) {
  const normalized = trim(value);
  if (!normalized) return ":rocket:";
  if (normalized.length <= HEADER_TEXT_MAX) return normalized;
  return `${normalized.slice(0, HEADER_TEXT_MAX - 1)}…`;
}

function truncateText(value, maxLength) {
  const normalized = trim(value);
  if (!normalized) return "";
  if (!Number.isFinite(maxLength) || maxLength < 1) return normalized;
  if (normalized.length <= maxLength) return normalized;
  if (maxLength === 1) return "…";
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeAvgWave(value) {
  const parsed = toFiniteNumber(value);
  if (!Number.isFinite(parsed)) return "";
  const rounded = Math.round(parsed * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}m`;
}

function normalizeDiffText(context = {}, metrics = {}) {
  const direct = trim(metrics.diff_text || metrics.diff || metrics.diffStats);
  if (direct) return direct;

  const topLevel = trim(context?.diff_stats?.text);
  if (topLevel) return topLevel;

  const added = toFiniteNumber(context?.diff_stats?.added);
  const deleted = toFiniteNumber(context?.diff_stats?.deleted);
  if (Number.isFinite(added) && Number.isFinite(deleted)) {
    return `+${Math.trunc(added)} -${Math.trunc(deleted)}`;
  }

  return "";
}

function normalizeMetrics(context = {}) {
  const metrics = context?.metrics;
  if (!isRecord(metrics)) {
    throw new Error("context.metrics is required");
  }

  const issuesClosed = toFiniteNumber(metrics.issues_closed ?? metrics.issuesClosed);
  if (!Number.isFinite(issuesClosed)) {
    throw new Error("context.metrics.issues_closed must be a finite number");
  }

  const commitsLanded = toFiniteNumber(metrics.commits_landed ?? metrics.commitsLanded);
  if (!Number.isFinite(commitsLanded)) {
    throw new Error("context.metrics.commits_landed must be a finite number");
  }

  const avgWaveValue = metrics.avg_wave_minutes
    ?? metrics.avgWaveMinutes
    ?? context?.timing?.avg_wave_minutes
    ?? context?.timing?.avgWaveMinutes;
  const avgWave = normalizeAvgWave(avgWaveValue);
  if (!avgWave) {
    throw new Error("context.metrics.avg_wave_minutes is required");
  }

  const diffText = normalizeDiffText(context, metrics);
  if (!diffText) {
    throw new Error("context.metrics.diff_text is required");
  }

  return {
    issuesClosed: Math.trunc(issuesClosed),
    commitsLanded: Math.trunc(commitsLanded),
    avgWave,
    diffText,
  };
}

function resolveGoalUrl(goal = {}, repo = "") {
  const fromGoal = trim(goal?.url);
  if (fromGoal) return fromGoal;

  const number = Number(goal?.number);
  if (Number.isFinite(number) && number > 0 && repo) {
    return `https://github.com/${repo}/issues/${Math.trunc(number)}`;
  }

  return "";
}

function buildGoalsText(context = {}) {
  if (!Array.isArray(context?.goals)) {
    throw new Error("context.goals must be an array");
  }

  if (context.goals.length === 0) {
    return "- None";
  }

  const heading = "*Goals Shipped*\n";
  const repo = trim(context?.repo);
  const goalLines = context.goals.map((goal) => {
    const number = Number(goal?.number);
    const title = trim(goal?.title) || "Untitled goal";
    const url = resolveGoalUrl(goal, repo);
    if (!Number.isFinite(number) || number <= 0 || !url) {
      throw new Error("context.goals entries must include number and url");
    }
    return `- <${url}|#${Math.trunc(number)} ${title}>`;
  });

  let selectedLines = [];
  for (let index = 0; index < goalLines.length; index += 1) {
    const line = goalLines[index];
    const remaining = goalLines.length - index - 1;
    const overflowLine = remaining > 0 ? `\n- ... and ${remaining} more goals` : "";
    const candidateText = `${heading}${selectedLines.concat(line).join("\n")}${overflowLine}`;
    if (candidateText.length > SECTION_TEXT_MAX) {
      break;
    }
    selectedLines.push(line);
  }

  if (selectedLines.length === 0) {
    const firstLine = goalLines[0];
    const overflowLine = goalLines.length > 1 ? `\n- ... and ${goalLines.length - 1} more goals` : "";
    const allowedLength = Math.max(1, SECTION_TEXT_MAX - heading.length - overflowLine.length);
    selectedLines = [truncateText(firstLine, allowedLength)];
  }

  const hiddenCount = goalLines.length - selectedLines.length;
  return `${selectedLines.join("\n")}${hiddenCount > 0 ? `\n- ... and ${hiddenCount} more goals` : ""}`;
}

function buildComprehensionContextText(narrative = {}) {
  const conceptualShift = fallbackString(narrative?.conceptual_shift, SLACK_CONCEPTUAL_SHIFT_FALLBACK);
  const entryPoints = toTextList(narrative?.entry_points).slice(0, 2).map((entry) => `entry \`${entry}\``);
  const watchItems = toTextList(narrative?.watch_items).slice(0, 2).map((item) => `watch ${item}`);

  const teaserItems = [...entryPoints, ...watchItems].slice(0, 2);
  const teaserText = teaserItems.length > 0 ? teaserItems.join(" · ") : `watch ${SLACK_WATCH_ITEMS_FALLBACK}`;

  return truncateText(`Comprehension: ${conceptualShift} · ${teaserText}`, CONTEXT_TEXT_MAX);
}

export function buildReleaseSlackBlocksPayload(options = {}) {
  const {
    context,
    narrative,
    reportIssueUrl: reportIssueUrlOverride = "",
  } = options;

  if (!isRecord(context)) {
    throw new Error("context must be a JSON object");
  }
  if (!isRecord(narrative)) {
    throw new Error("narrative must be a JSON object");
  }

  const headline = fallbackString(narrative.headline, SLACK_NARRATIVE_HEADLINE_FALLBACK);
  const story = fallbackString(narrative.summary || narrative.narrative, SLACK_NARRATIVE_SUMMARY_FALLBACK);
  const metrics = normalizeMetrics(context);
  const goalsText = buildGoalsText(context);
  const factoryId = trim(context?.factory_id) || "unknown-factory";
  const reportIssueUrl = trim(reportIssueUrlOverride) || trim(narrative?.report_issue_url);
  const fallbackText = truncateText(`${headline} — ${story}`, FALLBACK_TEXT_MAX);
  const comprehensionContextText = buildComprehensionContextText(narrative);

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateHeaderText(`:rocket: ${headline}`),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: story,
      },
      ...(reportIssueUrl ? {
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Open report",
            emoji: true,
          },
          url: reportIssueUrl,
          action_id: "open_release_report",
        },
      } : {}),
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: comprehensionContextText },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Goals Shipped*\n${goalsText}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: truncateText(`${metrics.issuesClosed} issues · ${metrics.commitsLanded} commits · avg wave ${metrics.avgWave} · ${metrics.diffText} · ${factoryId}`, CONTEXT_TEXT_MAX) },
        ...(reportIssueUrl ? [{ type: "mrkdwn", text: truncateText(`<${reportIssueUrl}|Full report issue>`, CONTEXT_TEXT_MAX) }] : []),
      ],
    },
  ];

  return {
    blocks,
    text: fallbackText,
  };
}
