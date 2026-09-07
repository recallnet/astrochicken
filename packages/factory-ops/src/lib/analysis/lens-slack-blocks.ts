function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return String(value ?? "").trim();
}

export function buildLensSlackPayload({
  reportDate = "",
  repo = "",
  issueUrl = "",
  findings = [],
  metaReflection = {},
} = {}) {
  const topFindings = asArray(findings).slice(0, 2);
  const experiments = asArray(metaReflection?.suggested_experiments).slice(0, 1);
  const summaryLines = topFindings.map((finding, index) => `${index + 1}. ${asString(finding?.title || finding?.observation) || "Untitled finding"}`);
  const experimentLine = experiments[0] ? `Experiment: ${asString(experiments[0])}` : "";

  const text = [
    `Daily Lens report for ${reportDate || "unknown-date"}`,
    issueUrl ? issueUrl : "",
    ...summaryLines,
    experimentLine,
  ].filter(Boolean).join(" | ");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Daily Lens Report ${reportDate || ""}`.trim(),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          repo ? `*Repo:* ${repo}` : "",
          issueUrl ? `*Issue:* <${issueUrl}|Open report>` : "",
        ].filter(Boolean).join("\n"),
      },
    },
  ];

  if (summaryLines.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Top findings*\n${summaryLines.join("\n")}`,
      },
    });
  }

  if (experimentLine) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: experimentLine,
      },
    });
  }

  return {
    text,
    blocks,
  };
}
