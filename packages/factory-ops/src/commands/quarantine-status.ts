import { ghJson } from "../lib/cli-helpers.ts";

// Parse the plain-text format that wave-handle-review-failures.mjs actually writes:
// "WAVE-QUARANTINE: until=1774073865 reason=repeat_review_failure count=5"
function parseQuarantinePlainText(body = "") {
  const m = String(body || "").match(/WAVE-QUARANTINE:\s*until=(\d+)\s.*?count=(\d+)/i);
  if (!m) return null;
  return { until: Number.parseInt(m[1], 10) || 0, count: Number.parseInt(m[2], 10) || 0 };
}

// Parse WAVE-REVIEW-FAILURE markers written by wave-handle-review-failures.mjs:
// "WAVE-REVIEW-FAILURE: count=3 note_hash=abc123"
function parseReviewFailureMarker(body = "") {
  const m = String(body || "").match(/WAVE-REVIEW-FAILURE:\s*count=(\d+)\s+note_hash=([a-f0-9]+)/i);
  if (!m) return null;
  return { count: Number.parseInt(m[1], 10) || 0, note_hash: String(m[2] || "") };
}

// Extract review notes from the WAVE-REVIEW-FAILURE comment body.
// Format: "Review failed after attempts:\n\n<notes>\n\nResume policy: ...\n\nWAVE-REVIEW-FAILURE: ..."
function extractReviewNotes(body = "") {
  const s = String(body || "");
  const start = s.indexOf("\n\n");
  if (start < 0) return "";
  const afterHeader = s.slice(start + 2);
  const end = afterHeader.search(/\nResume policy:|\nWAVE-REVIEW-FAILURE:/i);
  if (end < 0) return afterHeader.trim();
  return afterHeader.slice(0, end).trim();
}

export function quarantineStatus({ repo, ghJsonFn = ghJson } = {}) {
  if (!repo) return { quarantined_count: 0, issues: [] };

  const quarantinedIssues = ghJsonFn([
    "issue", "list",
    "--repo", repo,
    "--state", "open",
    "--label", "quarantined",
    "--json", "number,title",
    "--limit", "100",
  ], []);

  if (!Array.isArray(quarantinedIssues) || quarantinedIssues.length === 0) {
    return { quarantined_count: 0, issues: [] };
  }

  const now = Date.now();
  const issues = [];

  for (const issue of quarantinedIssues) {
    const issueNumber = Number(issue.number);
    const title = String(issue.title || "");

    let comments = [];
    try {
      comments = ghJsonFn([
        "api",
        `repos/${repo}/issues/${issueNumber}/comments`,
        "--paginate",
      ], []);
    } catch {
      comments = [];
    }

    if (!Array.isArray(comments)) comments = [];

    let maxCount = 0;
    let cooldownUntilEpoch = 0;
    let reviewNotes = "";

    for (let i = comments.length - 1; i >= 0; i -= 1) {
      const body = String(comments[i]?.body || "");

      const qData = parseQuarantinePlainText(body);
      if (qData) {
        if (qData.count > maxCount) maxCount = qData.count;
        if (qData.until > cooldownUntilEpoch) cooldownUntilEpoch = qData.until;
      }

      const rfData = parseReviewFailureMarker(body);
      if (rfData) {
        if (rfData.count > maxCount) maxCount = rfData.count;
        if (!reviewNotes) reviewNotes = extractReviewNotes(body);
      }
    }

    let cooldownRemainingMinutes = 0;
    if (cooldownUntilEpoch > 0) {
      const cooldownMs = cooldownUntilEpoch * 1000;
      if (cooldownMs > now) {
        cooldownRemainingMinutes = Math.ceil((cooldownMs - now) / 60_000);
      }
    }

    issues.push({
      number: issueNumber,
      title,
      failure_count: maxCount,
      cooldown_remaining_minutes: cooldownRemainingMinutes,
      cooldown_until: cooldownUntilEpoch > 0 ? new Date(cooldownUntilEpoch * 1000).toISOString() : "",
      review_notes: reviewNotes,
    });
  }

  return {
    quarantined_count: issues.length,
    issues,
  };
}
