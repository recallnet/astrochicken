import { createHash } from "node:crypto";

import { trim, parseJson, gh } from "../lib/cli-helpers.ts";

const ROLE_NAMES = {
  red: "Red Strategist",
  blue: "Blue Strategist",
  force_wrap: "Blue Strategist (final wrap)",
  format_repair: "Blue Strategist (format repair)",
};

const SESSION_KEYS = {
  red: "red_strategist",
  blue: "blue_strategist",
  force_wrap: "blue_strategist",
  format_repair: "blue_strategist",
};

function roleName(source = "") {
  return ROLE_NAMES[source] || source;
}

function resolveLangfuseTraceId(runId, handlerType, sessionKey) {
  const seed = `${runId}:${handlerType}:${sessionKey}`;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `lf_trace_${hash}`;
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function toBulletList(items = []) {
  if (items.length === 0) return "_none_";
  return items.map((item) => `- ${item}`).join("\n");
}

function extractFinalReportJson(raw = "") {
  // Try pure JSON first — no preamble
  const direct = parseJson(raw, null);
  if (direct && direct.proposal) return { report: direct, preamble: "" };

  // Try extracting JSON from markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = parseJson(fenceMatch[1].trim(), null);
    if (inner && inner.proposal) {
      const preamble = trim(raw.slice(0, fenceMatch.index));
      return { report: inner, preamble };
    }
  }

  // Try finding a JSON object starting with { after prose
  const braceIdx = raw.indexOf("{");
  if (braceIdx >= 0) {
    const candidate = raw.slice(braceIdx);
    const inner = parseJson(candidate, null);
    if (inner && inner.proposal) {
      const preamble = trim(raw.slice(0, braceIdx));
      return { report: inner, preamble };
    }
  }

  return null;
}

function renderFinalReportMarkdown(report = {}) {
  const lines = [
    `### ${trim(report.proposal) || "Goal Proposal"}`,
    "",
    "**Success Criteria**",
    toBulletList(toArray(report.success_criteria)),
    "",
    "**Scope In**",
    toBulletList(toArray(report.scope_in)),
    "",
    "**Scope Out**",
    toBulletList(toArray(report.scope_out)),
  ];

  const risks = toArray(report.risks);
  if (risks.length > 0) {
    lines.push("", "**Risks**", toBulletList(risks));
  }

  return lines.join("\n");
}

function buildTraceLinks(runId, langfuseProjectUrl) {
  if (!trim(runId) || !trim(langfuseProjectUrl)) return "";

  const baseUrl = trim(langfuseProjectUrl);
  const redTraceId = resolveLangfuseTraceId(runId, "agent.kw", "red_strategist");
  const blueTraceId = resolveLangfuseTraceId(runId, "agent.kw", "blue_strategist");

  return [
    "",
    "---",
    `Red Strategist: [langfuse trace](${baseUrl}/traces/${redTraceId})`,
    `Blue Strategist: [langfuse trace](${baseUrl}/traces/${blueTraceId})`,
  ].join("\n");
}

export function postBrainstormTurnComment({
  repo = "",
  issueNumber = "",
  source = "",
  round = "",
  agentOutput = "",
  isFinal = "false",
  runId = "",
  langfuseProjectUrl = "",
  // @context:decision suppressRoundComment is a deterministic suppression signal from the
  // loop-guard or early-exit gate. When true, we skip posting even for non-empty output —
  // preventing round-comment churn after a terminate/stall exit condition trips.
  // This is distinct from the empty-output skip: that is a content guard; this is a
  // routing guard. Both return skipped="true" but have different semantic causes.
  suppressRoundComment = "false",
  ghExec = gh,
} = {}) {
  const output = trim(agentOutput);
  if (!output) {
    return { ok: true, skipped: "true" };
  }

  if (String(suppressRoundComment).trim() === "true") {
    return { ok: true, skipped: "true" };
  }

  const role = roleName(source);
  const final = isFinal === "true";
  let body;

  if (final) {
    const extracted = extractFinalReportJson(output);
    const traceLinks = buildTraceLinks(runId, langfuseProjectUrl);

    if (extracted) {
      const reportMd = renderFinalReportMarkdown(extracted.report);
      const preamble = extracted.preamble ? `${extracted.preamble}\n\n---\n\n` : "";
      body = `${preamble}## Final Report\n\n${reportMd}${traceLinks}`;
    } else {
      body = `## Final Report\n\n${output}${traceLinks}`;
    }
  } else {
    body = `**${role}** (round ${round}):\n\n${output}`;
  }

  const result = ghExec([
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    String(repo),
    "--body",
    body,
  ]);

  if (!result.ok) {
    throw new Error(`brainstorm_post_turn_comment:comment_failed:${trim(result.stderr || result.stdout || "unknown")}`);
  }

  return { ok: true, skipped: "false" };
}
