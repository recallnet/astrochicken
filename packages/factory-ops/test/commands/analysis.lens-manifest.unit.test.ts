import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLensManifest } from "../../src/lib/analysis/lens-manifest.ts";

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "analysis-lens-manifest-"));
}

test("buildLensManifest includes dataset path references, bundle paths, and collector health map", async () => {
  const root = makeRoot();
  const runtimeDir = path.join(root, "reports", "lens", "runtime", "run-manifest");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisOutputPath = path.join(runtimeDir, "analysis-output.json");
  const windowStart = "2026-03-15T14:45:00.000Z";
  const windowEnd = "2026-03-16T14:45:00.000Z";

  try {
    const manifest = await buildLensManifest({
      collected: {
        base: {
          langfuse: {
            source: "langfuse",
            window: { start: windowStart, end: windowEnd },
            trace_count: 3,
            traces: [{ trace_id: "t-1" }, { trace_id: "t-2" }, { trace_id: "t-3" }],
            totals: { trace_count: 3, tokens_total: 99, cost_total_usd: 1.25 },
            missing_data: [{ reason: "source_missing", detail: "langfuse unavailable" }],
            meta: { error: "langfuse_gap" },
          },
          github: {
            source: "github_state",
            window: { start: windowStart, end: windowEnd },
            issues: [{ number: 1 }],
            pull_requests: [{ number: 2 }, { number: 3 }],
            issue_counts: { created: 1, closed: 0 },
            pull_request_counts: { merged: 1, updated: 2 },
            bug_gate: { open_bug_count: 0 },
            missing_data: [],
            meta: {},
          },
          git: {
            source: "git_history",
            window: { start: windowStart, end: windowEnd },
            commits: [{ sha: "a" }, { sha: "b" }],
            commit_count: 2,
            stray_branches_count: 1,
            missing_data: [],
            meta: {},
          },
          hatch_runs: {
            source: "runs_artifacts",
            window: { start: windowStart, end: windowEnd },
            runs: [{ run_id: "r-1" }],
            counts: { total_runs: 3, runs_in_window: 1, guarded_runs: 1 },
            guard_incidents: [{ run_id: "r-1" }],
            missing_data: [],
            meta: {},
          },
          supervisor: {
            source: "supervisor_status",
            window: { start: windowStart, end: windowEnd },
            runs: [{ run_id: "s-1" }],
            ticks: [{ run_id: "tick-1" }],
            counts: { active_runs: 1, active_ticks: 1, guard_activations: 1 },
            missing_data: [],
            meta: {},
          },
        },
        agent_learnings: {
          path: "/tmp/AGENT-LEARNINGS.md",
          entries: [{ heading: "2026-03-16", body: "learning" }],
        },
        past_lens_outputs: [{ date: "2026-03-15", path: "/tmp/reports/lens/2026-03-15.json" }],
        pending_suggestions: [{ id: "s-1", status: "pending" }],
        llm_inventory: { path: "/tmp/inventory/llm-role-session-baseline.json", generated_at: "2026-03-16T01:00:00.000Z" },
        goal_decomposition_timeouts: { path: "/tmp/inventory/goal-decomposition-timeouts.json", defaults: { soft_ms: 1000 } },
      },
      runtimeDir,
      date: "2026-03-16",
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      window: { start: windowStart, end: windowEnd },
      bundlePath,
      analysisOutputPath,
      repoPath: "/path/to/astrochicken",
      runsDir: "/tmp/hatch-runs",
      issueLabels: ["daily-lens"],
      collectorVersion: "2",
      generatedAt: "2026-03-16T20:11:12.000Z",
    });

    assert.equal(manifest.bundle_path, bundlePath);
    assert.equal(manifest.analysis_output_path, analysisOutputPath);
    assert.equal(manifest.provenance.collector_version, "2");
    assert.equal(manifest.provenance.generated_at, "2026-03-16T20:11:12.000Z");
    assert.equal(manifest.provenance.runs_dir, "/tmp/hatch-runs");
    assert.equal(manifest.summary.pending_suggestion_count, 1);
    assert.equal(manifest.summary.prior_report_count, 1);

    const datasetsById = new Map((manifest.datasets || []).map((entry) => [entry.id, entry]));
    assert.equal(datasetsById.get("langfuse").path_in_bundle, "$.base.langfuse");
    assert.equal(datasetsById.get("langfuse").collector_health.meta_error, "langfuse_gap");
    assert.equal(datasetsById.get("langfuse").collector_health.health_flags.includes("collector_error"), true);
    assert.equal(datasetsById.get("langfuse").summary.totals.tokens_total, 99);

    assert.equal(datasetsById.get("agent_learnings").file_path, "/tmp/AGENT-LEARNINGS.md");
    assert.equal(datasetsById.get("agent_learnings").path_in_bundle, "$.agent_learnings");
    assert.equal(datasetsById.get("agent_learnings").summary.entries_count, 1);

    assert.equal(datasetsById.get("past_lens_outputs").file_path, bundlePath);
    assert.equal(datasetsById.get("past_lens_outputs").summary.report_count, 1);
    assert.deepEqual(datasetsById.get("past_lens_outputs").summary.dates, ["2026-03-15"]);

    assert.equal(datasetsById.get("pending_suggestions").summary.pending_count, 1);
    assert.equal(manifest.collector_health.pending_suggestions.pending_suggestions_count, 1);

    assert.ok(String(datasetsById.get("github").file_path).endsWith(`${path.sep}datasets${path.sep}github.json`));
    assert.ok(String(datasetsById.get("git").file_path).endsWith(`${path.sep}datasets${path.sep}git.json`));
    assert.ok(String(datasetsById.get("hatch_runs").file_path).endsWith(`${path.sep}datasets${path.sep}hatch_runs.json`));
    assert.ok(String(datasetsById.get("supervisor").file_path).endsWith(`${path.sep}datasets${path.sep}supervisor.json`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
