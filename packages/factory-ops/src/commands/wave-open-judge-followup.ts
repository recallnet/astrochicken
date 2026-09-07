import { emitBugIssue } from "./supervisor-artifact.ts";

export function openJudgeFollowupArtifact({ repo, milestoneTitle = "", judgeNotes = "", runId = "", pipeline = "wave_execute" } = {}) {
  const summary = `Judge failed for ${milestoneTitle || "wave"}.`;
  // Keep dedup stable across retries/runs: include milestone only.
  // Judge notes are high-variance and caused duplicate bug issues for the same wave.
  const evidence = JSON.stringify({
    milestone_title: milestoneTitle,
    observed_behavior: `Judge rejected wave milestone ${milestoneTitle || "wave"}.`,
    expected_behavior: "Wave judge should approve or provide bounded actionable feedback without repeated terminal failures.",
    remediation_attempts: "Supervisor retried wave execution and emitted this bug for fast-track resolution.",
    ownership_hint: "control_plane",
    next_step_hint: "Inspect judge/coder prompts and adjust routing so the wave can proceed.",
  });
  const out = emitBugIssue({
    repo,
    runId,
    pipeline,
    bugType: "wave-judge-failure",
    summary,
    evidence,
  });
  return { issue_url: out.issue_url, error: out.error };
}
