function trim(value = "") {
  return String(value || "").trim();
}

export function summarizeFleetWarning(value = "") {
  const warning = trim(value);
  if (!warning) return "";
  if (warning.includes("manifest_fetch_failed")) return "release targeting degraded";
  if (warning.includes("control_plane_manifest_unavailable")) return "release manifest unavailable";
  if (warning.includes("context_resolution_failed")) return "context resolution degraded";
  if (warning.includes("runs_dir_missing")) return "runs dir missing";
  const zeroDeltaBurn = warning.match(/^active_issue_zero_delta_burn:#?(\d+):?(.*)$/i);
  if (zeroDeltaBurn) {
    const issue = trim(zeroDeltaBurn[1]);
    const age = trim(zeroDeltaBurn[2]);
    return `issue #${issue} burning with no git delta${age ? ` (${age})` : ""}`;
  }
  return warning
    .replace(/^release_targeting:[^:]*:/, "")
    .replace(/_/g, " ")
    .trim();
}

export function summarizeFactoryAttention(row = {}) {
  const releaseTargetingConfigured = trim(row.rollout_status) !== "" && trim(row.rollout_status) !== "unknown";
  const gateAttention = releaseTargetingConfigured ? summarizeFleetWarning(row.gate_reason) : "";
  const candidates = [
    trim(row.blocked_reason),
    trim(row?.managed_state?.reason),
    trim(row.control_plane_blocker),
    gateAttention,
    ...(Array.isArray(row.warnings) ? row.warnings.map((entry) => summarizeFleetWarning(entry)) : []),
  ].map((entry) => trim(entry)).filter(Boolean);
  return candidates[0] || "";
}
