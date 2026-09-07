function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function topN(items, limit = 3) {
  return asArray(items).slice(0, limit);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCost(value) {
  const amount = toNumber(value, 0);
  return `$${amount.toFixed(4)}`;
}

function formatEvidenceItem(evidence) {
  if (!evidence || typeof evidence !== "object") return "(unknown evidence)";
  const type = String(evidence.type || "evidence");
  const id = String(evidence.id || evidence.trace_id || evidence.run_id || evidence.issue_number || evidence.sha || "unknown");
  const cost = evidence.cost_usd !== undefined ? ` cost=${formatCost(evidence.cost_usd)}` : "";
  const duration = evidence.duration_ms !== undefined ? ` duration_ms=${toNumber(evidence.duration_ms)}` : "";
  return `${type}:${id}${cost}${duration}`.trim();
}

function formatEvidenceList(evidence) {
  const items = asArray(evidence).map(formatEvidenceItem);
  return items.length > 0 ? items.join(", ") : "none";
}

function sectionHeading(title) {
  return `## ${title}`;
}

function renderDomainsMarkdown(domains = {}) {
  const lines = [sectionHeading("Detailed findings by domain")];
  const entries = Object.entries(domains);

  if (entries.length === 0) {
    lines.push("No domain findings were produced.");
    return lines;
  }

  for (const [domainName, findings] of entries) {
    lines.push(`### ${domainName}`);
    const limited = topN(findings, 3);
    if (limited.length === 0) {
      lines.push("- No findings for this domain.");
      continue;
    }

    for (const finding of limited) {
      lines.push(`- **${String(finding?.title || "Untitled finding")}** — ${String(finding?.summary || "")}`.trim());
      lines.push(`  - Evidence: ${formatEvidenceList(finding?.evidence)}`);
    }
  }

  return lines;
}

function renderSimpleListMarkdown({ title, items, emptyMessage }) {
  const lines = [sectionHeading(title)];
  const limited = topN(items, 3);
  if (limited.length === 0) {
    lines.push(emptyMessage);
    return lines;
  }

  for (const item of limited) {
    lines.push(`- **${String(item?.title || "Untitled")}** — ${String(item?.summary || "")}`.trim());
    lines.push(`  - Evidence: ${formatEvidenceList(item?.evidence)}`);
  }

  return lines;
}

function renderSelfImprovementMarkdown(selfImprovement = {}) {
  const lines = [sectionHeading("Self-improvement")];

  const renderSubsection = (name, items) => {
    lines.push(`### ${name}`);
    const limited = topN(items, 3);
    if (limited.length === 0) {
      lines.push("- none");
      return;
    }
    for (const item of limited) {
      lines.push(`- ${String(item)}`);
    }
  };

  renderSubsection("Learnings", selfImprovement?.learnings);
  renderSubsection("Questions", selfImprovement?.questions);
  renderSubsection("Improvement suggestions", selfImprovement?.improvement_suggestions);
  renderSubsection("Predictions", selfImprovement?.predictions);

  return lines;
}

function renderMetaMarkdown(reportJson) {
  const lines = [sectionHeading("Meta")];
  const meta = reportJson.meta || {};
  const missing = reportJson.missing_sources || {};
  const sources = reportJson.sources || {};

  lines.push(`- repo: ${String(meta.repo || "")}`);
  lines.push(`- report_date: ${String(meta.report_date || "")}`);
  lines.push(`- generated_at: ${String(meta.generated_at || "")}`);
  lines.push(`- analysis_window: ${String(meta.analysis_start || "")} → ${String(meta.analysis_end || "")}`);
  lines.push(`- trace_cost_total: ${formatCost(meta.trace_cost_total_usd || 0)}`);
  lines.push(`- trace_duration_total_ms: ${toNumber(meta.trace_duration_total_ms || 0)}`);
  lines.push("- data_coverage:");
  lines.push(`  - missing_langfuse=${missing.missing_langfuse === true}`);
  lines.push(`  - missing_github=${missing.missing_github === true}`);
  lines.push(`  - missing_git=${missing.missing_git === true}`);
  lines.push(`  - missing_hatch_runs=${missing.missing_hatch_runs === true}`);
  lines.push(`  - missing_supervisor_state=${missing.missing_supervisor_state === true}`);
  lines.push("- sources map:");
  lines.push(`  - langfuse_traces: ${asArray(sources.langfuse_traces).map((item) => item?.id || item?.trace_id).filter(Boolean).join(", ") || "none"}`);
  lines.push(`  - issues: ${asArray(sources.issues).map((item) => item?.number || item?.id).filter(Boolean).join(", ") || "none"}`);
  lines.push(`  - runs: ${asArray(sources.runs).map((item) => item?.run_id || item?.id).filter(Boolean).join(", ") || "none"}`);
  lines.push(`  - git_commits: ${asArray(sources.git_commits).map((item) => item?.sha || item?.id).filter(Boolean).join(", ") || "none"}`);

  return lines;
}

export function renderDailyInsight(payload = {}) {
  const domains = payload?.domains && typeof payload.domains === "object" ? payload.domains : {};
  const reportJson = {
    executive_summary: topN(payload.executive_summary, 3),
    metrics_snapshot: payload.metrics_snapshot || {},
    domains: Object.fromEntries(
      Object.entries(domains).map(([domainName, findings]) => [domainName, topN(findings, 3)]),
    ),
    anomalies: topN(payload.anomalies, 3),
    opportunities: topN(payload.opportunities, 3),
    self_improvement: {
      learnings: topN(payload?.self_improvement?.learnings, 3),
      questions: topN(payload?.self_improvement?.questions, 3),
      improvement_suggestions: topN(payload?.self_improvement?.improvement_suggestions, 3),
      predictions: topN(payload?.self_improvement?.predictions, 3),
    },
    sources: {
      langfuse_traces: asArray(payload?.sources?.langfuse_traces),
      issues: asArray(payload?.sources?.issues),
      runs: asArray(payload?.sources?.runs),
      git_commits: asArray(payload?.sources?.git_commits),
      pull_requests: asArray(payload?.sources?.pull_requests),
      supervisor_ticks: asArray(payload?.sources?.supervisor_ticks),
    },
    missing_sources: {
      missing_langfuse: payload?.missing_sources?.missing_langfuse === true,
      missing_github: payload?.missing_sources?.missing_github === true,
      missing_git: payload?.missing_sources?.missing_git === true,
      missing_hatch_runs: payload?.missing_sources?.missing_hatch_runs === true,
      missing_supervisor_state: payload?.missing_sources?.missing_supervisor_state === true,
    },
    meta: {
      repo: String(payload?.repo || ""),
      report_date: String(payload?.date || ""),
      generated_at: String(payload?.meta?.generated_at || new Date().toISOString()),
      analysis_start: String(payload?.analysis_window?.start || ""),
      analysis_end: String(payload?.analysis_window?.end || ""),
      trace_cost_total_usd: toNumber(payload?.meta?.trace_cost_total_usd || 0),
      trace_duration_total_ms: toNumber(payload?.meta?.trace_duration_total_ms || 0),
      source_counts: payload?.meta?.source_counts || {},
      collector_errors: payload?.meta?.collector_errors || [],
    },
  };

  const markdownLines = [
    `# Daily Analysis Report — ${reportJson.meta.report_date}`,
    "",
    sectionHeading("Executive summary"),
  ];

  if (reportJson.executive_summary.length === 0) {
    markdownLines.push("No executive findings were generated.");
  } else {
    for (const finding of reportJson.executive_summary) {
      markdownLines.push(`- ${String(finding)}`);
    }
  }

  markdownLines.push("", sectionHeading("Metrics snapshot"));
  const metrics = reportJson.metrics_snapshot || {};
  for (const [key, value] of Object.entries(metrics)) {
    markdownLines.push(`- ${key}: ${value}`);
  }
  if (Object.keys(metrics).length === 0) {
    markdownLines.push("- none");
  }

  markdownLines.push("", ...renderDomainsMarkdown(reportJson.domains));
  markdownLines.push("", ...renderSimpleListMarkdown({
    title: "Anomalies and alerts",
    items: reportJson.anomalies,
    emptyMessage: "No anomalies detected.",
  }));
  markdownLines.push("", ...renderSimpleListMarkdown({
    title: "Opportunities",
    items: reportJson.opportunities,
    emptyMessage: "No opportunities identified.",
  }));
  markdownLines.push("", ...renderSelfImprovementMarkdown(reportJson.self_improvement));
  markdownLines.push("", ...renderMetaMarkdown(reportJson), "");

  return {
    markdown: markdownLines.join("\n"),
    json: reportJson,
  };
}
