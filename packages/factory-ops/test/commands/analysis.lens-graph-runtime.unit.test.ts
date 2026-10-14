import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import { reconcileNoLensCandidates } from "../helpers/ops-domain-fixtures.ts";
import { makeEmptyLensCollection } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { promises as fsPromises } from "node:fs";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { resetAnalysisLensGraphRuntimeForTest, runAnalysisLensFinalize, runAnalysisLensPrepare, setAnalysisLensGraphRuntimeForTest } from "../../src/commands/analysis/lens-graph-runtime.ts";
import { createDailyLensCollectedFixture, DAILY_LENS_REQUIRED_DATASET_IDS } from "../shared/helpers/daily-lens-manifest.ts";

const tempDirs = [];

function makeTmpDir(prefix = "analysis-lens-graph-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

afterEach(() => {
  resetAnalysisLensGraphRuntimeForTest();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test("analysis lens-prepare writes manifest datasets and materialized dataset files", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const windowStart = "2026-03-15T14:45:00.000Z";
  const windowEnd = "2026-03-16T14:45:00.000Z";

  const collected = createDailyLensCollectedFixture({ windowStart, windowEnd });

  setAnalysisLensGraphRuntimeForTest({
    collectLensData: async () => collected,
  });

  const result = await runAnalysisLensPrepare({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    runId: "run-123",
    windowStart,
    windowEnd,
    runsDir: "/tmp/mothership-runs",
    repoPath: "/path/to/astrochicken",
  });

  assert.equal(result.date, "2026-03-16");
  assert.equal(result.repo, "recallnet/astrochicken");
  assert.equal(result.factory_id, "mothership");
  assert.equal(result.window_start, windowStart);
  assert.equal(result.window_end, windowEnd);
  assert.equal(result.issue_labels_json, "[\"daily-lens\"]");
  assert.equal(existsSync(result.bundle_path), true);
  assert.equal(existsSync(result.bundle_manifest_path), true);
  assert.equal(existsSync(result.analysis_output_path), true);

  const manifest = readJson(result.bundle_manifest_path);
  assert.equal(manifest.bundle_path, result.bundle_path);
  assert.equal(manifest.analysis_output_path, result.analysis_output_path);
  assert.equal(manifest.date, "2026-03-16");
  assert.equal(manifest.window.start, windowStart);
  assert.equal(manifest.window.end, windowEnd);
  assert.deepEqual(manifest.issue_labels, ["daily-lens"]);
  assert.equal(manifest.provenance.runs_dir, "/tmp/mothership-runs");
  assert.equal(manifest.summary.collector_error_count, 1);
  assert.equal(manifest.summary.pending_suggestion_count, 2);
  assert.equal(manifest.summary.prior_report_count, 1);

  const datasetsById = new Map((manifest.datasets || []).map((entry) => [entry.id, entry]));
  assert.deepEqual([...datasetsById.keys()], DAILY_LENS_REQUIRED_DATASET_IDS);

  for (const [datasetId, datasetPayload] of Object.entries(collected.base)) {
    const entry = datasetsById.get(datasetId);
    assert.ok(entry, `missing manifest dataset entry for ${datasetId}`);
    const expectedPath = path.join(outputDir, "runtime", "run-123", "datasets", `${datasetId}.json`);
    assert.equal(entry.file_path, expectedPath);
    assert.equal(entry.path_in_bundle, `$.base.${datasetId}`);
    assert.equal(existsSync(entry.file_path), true);
    assert.deepEqual(readJson(entry.file_path), datasetPayload);
    assert.equal(entry.window.start, windowStart);
    assert.equal(entry.window.end, windowEnd);
  }

  assert.equal(datasetsById.get("langfuse").summary.trace_count, 2);
  assert.equal(datasetsById.get("langfuse").summary.item_count, 2);
  assert.equal(datasetsById.get("langfuse").collector_health.status, "degraded");
  assert.equal(datasetsById.get("langfuse").collector_health.collector_error_count, 2);

  assert.equal(datasetsById.get("github").summary.issues_count, 2);
  assert.equal(datasetsById.get("github").summary.pull_requests_count, 1);
  assert.equal(datasetsById.get("github").collector_health.collector_error_count, 0);

  assert.equal(datasetsById.get("agent_learnings").file_path, result.bundle_path);
  assert.equal(datasetsById.get("agent_learnings").path_in_bundle, "$.agent_learnings");
  assert.equal(datasetsById.get("pending_suggestions").summary.pending_count, 2);
  assert.equal(manifest.collector_health.langfuse.meta_error, "langfuse_gap");
  assert.equal(manifest.collector_health.pending_suggestions.pending_suggestions_count, 2);
});

test("analysis lens-prepare manifest dataset paths are readable through runtime fs", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const windowStart = "2026-03-15T14:45:00.000Z";
  const windowEnd = "2026-03-16T14:45:00.000Z";

  setAnalysisLensGraphRuntimeForTest({
    collectLensData: async () => createDailyLensCollectedFixture({ windowStart, windowEnd }),
  });

  const result = await runAnalysisLensPrepare({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    runId: "run-readability",
    windowStart,
    windowEnd,
  });

  const manifest = readJson(result.bundle_manifest_path);
  for (const entry of manifest.datasets || []) {
    const raw = await fsPromises.readFile(entry.file_path, "utf8");
    assert.ok(raw.length > 0, `dataset file should be readable: ${entry.id}`);
  }
});

test("analysis lens-prepare fails closed when dataset file materialization fails", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");

  setAnalysisLensGraphRuntimeForTest({
    collectLensData: async () => createDailyLensCollectedFixture({
      windowStart: "2026-03-15T14:45:00.000Z",
      windowEnd: "2026-03-16T14:45:00.000Z",
    }),
    fs: {
      writeFile: async (filePath, ...args) => {
        if (String(filePath).endsWith(`${path.sep}datasets${path.sep}langfuse.json`)) {
          throw new Error("disk-full");
        }
        return fsPromises.writeFile(filePath, ...args);
      },
    },
  });

  await assert.rejects(
    () => runAnalysisLensPrepare({
      date: "2026-03-16",
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      outputDir,
      runId: "run-err",
      windowStart: "2026-03-15T14:45:00.000Z",
      windowEnd: "2026-03-16T14:45:00.000Z",
    }),
    /lens_dataset_materialize_failed: dataset_id=langfuse .*message=disk-full/,
  );
});

test("analysis lens-prepare records pending agent-analysis contract with manifest path", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const windowStart = "2026-03-15T14:45:00.000Z";
  const windowEnd = "2026-03-16T14:45:00.000Z";

  setAnalysisLensGraphRuntimeForTest({
    collectLensData: async () => createDailyLensCollectedFixture({ windowStart, windowEnd }),
  });

  const result = await runAnalysisLensPrepare({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    runId: "run-analysis-pending",
    windowStart,
    windowEnd,
  });

  const pendingOutput = readJson(result.analysis_output_path);
  assert.equal(pendingOutput.status, "pending_agent_analysis");
  assert.equal(pendingOutput.bundle_manifest_path, result.bundle_manifest_path);
});

test("analysis lens-finalize renders artifacts, publishes the report issue, and returns scheduled issue metadata", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const runtimeDir = path.join(outputDir, "runtime", "run-456");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisPath = path.join(runtimeDir, "analysis-output.json");
  const ghCalls = [];
  const slackCalls = [];
  const learningAppends = [];
  const followupCalls = [];

  setAnalysisLensGraphRuntimeForTest({
    appendLearningItem: async (entry) => {
      learningAppends.push(entry);
    },
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "create") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2188\n");
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    postLensToSlack: async (options) => {
      slackCalls.push(options);
      return { ok: true, delivered: true, status: "delivered" };
    },
    runAnalysisLensFollowupCandidates: async (options) => {
      followupCalls.push(options);
      return {
        ok: true,
        created_count: 1,
        updated_count: 0,
        action_count: 1,
        candidates: [{ action_id: "lens-2026-03-16-001", issue_number: 2190, status: "created" }],
      };
    },
  });

  const bundleDir = path.dirname(bundlePath);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify({
    base: {
      langfuse: { meta: { error: "langfuse_gap" } },
      github: { meta: {} },
      git: { meta: {} },
      hatch_runs: { meta: { error: "hatch_gap" } },
      supervisor: { meta: {} },
    },
  }, null, 2)}\n`, "utf8");
  writeFileSync(analysisPath, `${JSON.stringify({
    report_body: "# Daily Lens — 2026-03-16\n\nLease churn still appears in run evidence.\n",
    focus_choices: {
      prioritized_elevations: ["factory_instance"],
      deprioritized_elevations: [],
      reasoning: "Most evidence points at the running factory instance.",
    },
    findings: [{
      finding_id: "finding_lease_churn",
      observation: "Lease churn still appears in run evidence",
      inference: "Repeated run lease updates indicate instability.",
      action: "Add an explicit lease-chaos regression.",
      candidate_type: "task",
      impact: "factory_instance",
      priority: "high",
      confidence: "high",
      evidence_links: [{ ref: "langfuse.trace:123" }],
    }],
    trends: { improving: [], degrading: ["lease churn"], stable: [] },
    suggestions: [{
      id: "lens-2026-03-16-001",
      summary: "Add lease-chaos regression coverage",
      type: "suggestion",
      status: "pending",
      evidence_refs: [{ ref: "langfuse.trace:123" }],
      impact_notes: "Reduces repeated daemon pause incidents.",
    }],
    shaping_insights: [],
    meta_reflection: {
      data_quality_notes: "Collector health is degraded but usable.",
      blind_spots: "Cost attribution remains absent.",
      prompt_effectiveness: "Good enough for now.",
      missing_data: ["cost attribution"],
      suggested_experiments: ["compare lease chaos prompts"],
      questions_for_next_time: ["did the lease chaos test hold?"],
    },
  }, null, 2)}\n`, "utf8");

  const result = await runAnalysisLensFinalize({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    windowStart: "2026-03-15T14:45:00.000Z",
    windowEnd: "2026-03-16T14:45:00.000Z",
    bundlePath,
    analysisPath,
    notifySlack: true,
    issueLabels: ["daily-lens"],
    runId: "run-456",
    publicationSha: "abc123",
  });

  assert.equal(result.issue.url, "https://github.com/recallnet/astrochicken/issues/2188");
  assert.equal(result.scheduled_job_issue_url, "https://github.com/recallnet/astrochicken/issues/2188");
  assert.equal(result.scheduled_job_issue_number, 2188);
  assert.match(result.artifacts.narrative_json_path || "", /2026-03-16\.narrative\.json$/);
  assert.match(result.artifacts.narrative_markdown_path || "", /2026-03-16\.narrative\.md$/);
  assert.equal(result.narrative_document.json_path, result.artifacts.narrative_json_path);
  assert.equal(result.narrative_document.markdown_path, result.artifacts.narrative_markdown_path);
  assert.equal(result.slack.status, "delivered");
  assert.equal(slackCalls.length, 1);
  assert.equal(learningAppends.length, 1);
  assert.equal(result.followup_candidates.created_count, 1);
  assert.equal(followupCalls.length, 1);
  assert.equal(followupCalls[0].reportIssueNumber, 2188);
  assert.equal(followupCalls[0].analysisPath, path.join(outputDir, "2026-03-16.json"));
  assert.equal(followupCalls[0].runId, "run-456");
  assert.equal(followupCalls[0].publicationSha, "abc123");
  assert.equal(followupCalls[0].factoryId, "mothership");
  assert.equal(followupCalls[0].learningLogPath, "reports/analysis-learnings.json");
  assert.equal(existsSync(path.join(outputDir, "2026-03-16.json")), true);
  assert.equal(existsSync(path.join(outputDir, "2026-03-16.normalized.json")), false,
    "normalized.json should not exist — normalizer is removed");
  assert.equal(existsSync(path.join(outputDir, "2026-03-16.md")), true);
  assert.equal(readJson(path.join(outputDir, "2026-03-16.json")).meta.analysis_mode, "graph_agent");
  // Markdown should be from report_body
  const md = readFileSync(path.join(outputDir, "2026-03-16.md"), "utf8");
  assert.ok(md.includes("Lease churn still appears"), "markdown should come from report_body");
});

test("analysis lens-finalize rejects pending_agent_analysis stub instead of publishing fallback report", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const runtimeDir = path.join(outputDir, "runtime", "run-stub");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisPath = path.join(runtimeDir, "analysis-output.json");

  setAnalysisLensGraphRuntimeForTest({});

  const bundleDir = path.dirname(bundlePath);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify(makeEmptyLensCollection(), null, 2)}\n`, "utf8");
  writeFileSync(analysisPath, `${JSON.stringify({
    status: "pending_agent_analysis",
    bundle_manifest_path: path.join(runtimeDir, "bundle-manifest.json"),
  }, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => runAnalysisLensFinalize({
      date: "2026-03-16",
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      outputDir,
      windowStart: "2026-03-15T14:45:00.000Z",
      windowEnd: "2026-03-16T14:45:00.000Z",
      bundlePath,
      analysisPath,
    }),
    /lens_analysis_not_written/,
  );
});

test("analysis lens-finalize materializes agent result into analysis file before publishing", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const runtimeDir = path.join(outputDir, "runtime", "run-agent-result");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisPath = path.join(runtimeDir, "analysis-output.json");
  const slackCalls = [];

  setAnalysisLensGraphRuntimeForTest({
    ghJsonFn: (args, fallback) => {
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback ?? [];
    },
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2192\n");
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    postLensToSlack: async (payload) => {
      slackCalls.push(payload);
      return { ok: true, delivered: true, status: "delivered" };
    },
    runAnalysisLensFollowupCandidates: reconcileNoLensCandidates,
  });

  mkdirSync(path.dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify(makeEmptyLensCollection(), null, 2)}\n`, "utf8");
  writeFileSync(analysisPath, `${JSON.stringify({
    status: "pending_agent_analysis",
    bundle_manifest_path: path.join(runtimeDir, "bundle-manifest.json"),
  }, null, 2)}\n`, "utf8");

  const agentResult = {
    report_body: "# Daily Lens Report — 2026-03-16\n\n## Findings\n- report recovered\n",
    focus_choices: {
      prioritized_elevations: ["factory_instance"],
      deprioritized_elevations: [],
      reasoning: "test",
    },
    findings: [],
    trends: { improving: [], degrading: [], stable: [] },
    suggestions: [],
    shaping_insights: [],
    meta_reflection: {
      data_quality_notes: "test",
      blind_spots: "test",
      missing_data: [],
    },
  };

  const result = await runAnalysisLensFinalize({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    windowStart: "2026-03-15T14:45:00.000Z",
    windowEnd: "2026-03-16T14:45:00.000Z",
    bundlePath,
    analysisPath,
    agentResultJson: JSON.stringify(agentResult),
    notifySlack: true,
    issueLabels: ["daily-lens"],
  });

  assert.equal(result.issue.number, 2192);
  assert.equal(slackCalls.length, 1);
  assert.equal(readJson(analysisPath).report_body, agentResult.report_body);
});

test("analysis lens-finalize fails closed when follow-up candidate generation fails", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const runtimeDir = path.join(outputDir, "runtime", "run-789");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisPath = path.join(runtimeDir, "analysis-output.json");

  setAnalysisLensGraphRuntimeForTest({
    ghJsonFn: (args, fallback) => {
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2191\n");
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    runAnalysisLensFollowupCandidates: async () => {
      throw new Error("lens_followup_candidates_missing_action_registry: expected action registry");
    },
  });

  const bundleDir = path.dirname(bundlePath);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify(makeEmptyLensCollection(), null, 2)}\n`, "utf8");
  writeFileSync(analysisPath, `${JSON.stringify({
    focus_choices: {
      prioritized_elevations: ["factory_instance"],
      deprioritized_elevations: [],
      reasoning: "test",
    },
    findings: [],
    trends: { improving: [], degrading: [], stable: [] },
    suggestions: [],
    shaping_insights: [],
    meta_reflection: {
      data_quality_notes: "ok",
      blind_spots: "none",
      prompt_effectiveness: "ok",
      missing_data: [],
      suggested_experiments: [],
      questions_for_next_time: [],
    },
  }, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => runAnalysisLensFinalize({
      date: "2026-03-16",
      repo: "recallnet/astrochicken",
      factoryId: "mothership",
      outputDir,
      windowStart: "2026-03-15T14:45:00.000Z",
      windowEnd: "2026-03-16T14:45:00.000Z",
      bundlePath,
      analysisPath,
    }),
    /lens_followup_candidates_missing_action_registry/,
  );
});

test("analysis lens-finalize publishes actual findings when report_body is missing but findings exist", async () => {
  const root = makeTmpDir();
  const outputDir = path.join(root, "reports", "lens");
  const runtimeDir = path.join(outputDir, "runtime", "run-no-report-body");
  const bundlePath = path.join(runtimeDir, "bundle.json");
  const analysisPath = path.join(runtimeDir, "analysis-output.json");

  setAnalysisLensGraphRuntimeForTest({
    ghJsonFn: (args, fallback) => {
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return successfulCommandResult("https://github.com/recallnet/astrochicken/issues/2300\n");
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    runAnalysisLensFollowupCandidates: reconcileNoLensCandidates,
  });

  mkdirSync(path.dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, `${JSON.stringify({
    base: {
      langfuse: { meta: { error: "langfuse_dark_telemetry_unavailable" } },
      github: { meta: {} },
      git: { meta: {} },
      hatch_runs: { meta: {} },
      supervisor: { meta: {} },
    },
  }, null, 2)}\n`, "utf8");
  // Analysis has real findings but no report_body (e.g. old agent that didn't produce it)
  writeFileSync(analysisPath, `${JSON.stringify({
    focus_choices: {
      prioritized_elevations: ["factory_instance"],
      deprioritized_elevations: [],
      reasoning: "Most evidence points at the running factory instance.",
    },
    findings: [
      {
        finding_id: "finding_goal_throughput",
        observation: "Goal throughput improved by 3x this window.",
        inference: "The toposort execution plan is working.",
        action: "Monitor for sustained improvement.",
        candidate_type: "task",
        impact: "high",
        priority: "low",
        confidence: "high",
        evidence_links: ["#2181"],
      },
    ],
    trends: { improving: ["goal throughput"], degrading: [], stable: [] },
    suggestions: [],
    shaping_insights: [],
    meta_reflection: {
      data_quality_notes: "Langfuse telemetry unavailable; git and GitHub data used.",
      blind_spots: "Cost attribution completely dark.",
      missing_data: ["langfuse telemetry"],
    },
  }, null, 2)}\n`, "utf8");

  const result = await runAnalysisLensFinalize({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    windowStart: "2026-03-15T14:45:00.000Z",
    windowEnd: "2026-03-16T14:45:00.000Z",
    bundlePath,
    analysisPath,
    skipFollowupCandidates: true,
  });

  const md = readFileSync(path.join(outputDir, "2026-03-16.md"), "utf8");
  // Must NOT contain the "Analysis failed" stub
  assert.ok(
    !md.includes("Analysis failed. See JSON artifacts for collector data."),
    "markdown should not contain the failure stub when findings exist",
  );
  // Must include the actual finding content
  assert.ok(
    md.includes("Goal throughput improved") || md.includes("finding_goal_throughput") || md.includes("goal throughput"),
    "markdown should include actual finding content",
  );
  // Must include a telemetry caveat
  assert.ok(
    md.includes("telemetry") || md.includes("Langfuse") || md.includes("langfuse"),
    "markdown should include a note about missing telemetry",
  );
  assert.equal(result.ok, true);
});
