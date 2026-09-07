import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCli } from "../../src/cli/index.ts";
import {
  normalizeLensAnalysis,
  resetAnalysisLensRuntimeForTest,
  runAnalysisLens,
  setAnalysisLensRuntimeForTest,
} from "../../src/commands/analysis/lens.ts";
import { buildLensAnalysisPrompt } from "../../src/lib/analysis/lens-prompt-builder.ts";

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "analysis-lens-output-"));
}

test("runAnalysisLens uses report_body from LLM as markdown artifact", async (t) => {
  t.after(() => {
    resetAnalysisLensRuntimeForTest();
  });

  const root = fixtureRoot();
  const outputDir = join(root, "reports", "lens");
  const learningLogPath = join(root, "reports", "analysis-learnings.json");
  const attempted = [];

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const REPORT_BODY = "# Daily Lens — 2026-03-15\n\nAll systems nominal.\n";

  setAnalysisLensRuntimeForTest({
    collectLensData: async () => ({
      base: {
        langfuse: { traces: [], meta: { error: "" } },
        github: { issues: [], pull_requests: [], meta: { error: "" } },
        git: { commits: [], meta: { error: "" } },
        hatch_runs: { runs: [], meta: { error: "" } },
        supervisor: { ticks: [], meta: { error: "" } },
      },
      agent_learnings: { entries: [] },
      past_lens_outputs: [],
      pending_suggestions: [],
      llm_inventory: {},
      goal_decomposition_timeouts: {},
    }),
    runLensAnalysis: async () => ({
      report_body: REPORT_BODY,
      focus_choices: {
        prioritized_elevations: ["component"],
        deprioritized_elevations: ["meta_loop"],
        reasoning: "test",
      },
      findings: [],
      trends: { improving: [], degrading: [], stable: [] },
      suggestions: [
        {
          id: "lens-ok-1",
          summary: "valid suggestion",
          type: "suggestion",
          evidence_refs: [{ trace_id: "abc" }],
          impact_notes: "high",
        },
        {
          id: "lens-dup-1",
          summary: "dup suggestion",
          type: "suggestion",
          evidence_refs: [],
          impact_notes: "",
        },
        {
          id: "BAD ID",
          summary: "invalid suggestion",
          type: "suggestion",
          evidence_refs: [],
          impact_notes: "",
        },
      ],
      shaping_insights: [{ id: "insight-new" }],
      meta_reflection: {
        data_quality_notes: "",
        blind_spots: "",
        prompt_effectiveness: "",
        missing_data: [],
        suggested_experiments: [],
        questions_for_next_time: [],
      },
    }),
    runLensMetaReflection: async () => ({
      data_quality_notes: "ok",
      blind_spots: "none",
      prompt_effectiveness: "good",
      missing_data: [],
      suggested_experiments: [],
      questions_for_next_time: [],
    }),
    appendLearningItem: async (payload) => {
      attempted.push(payload.id);
      if (payload.id === "lens-dup-1") {
        throw new Error("learning_log_duplicate_id: lens-dup-1");
      }
      if (payload.id === "BAD ID") {
        throw new Error("learning_log_invalid_id: BAD ID");
      }
      return {
        id: payload.id,
      };
    },
  });

  const out = await runAnalysisLens({
    date: "2026-03-15",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    learningLogPath,
  });

  assert.equal(out.ok, true);
  assert.deepEqual(attempted, ["lens-ok-1", "lens-dup-1", "BAD ID"]);
  assert.deepEqual(out.suggestion_persistence.appended_ids, ["lens-ok-1"]);
  assert.deepEqual(out.suggestion_persistence.duplicate_ids, ["lens-dup-1"]);
  assert.deepEqual(out.suggestion_persistence.invalid_ids, ["BAD ID"]);

  // JSON artifact has raw lensJson
  const lensJson = JSON.parse(readFileSync(join(outputDir, "2026-03-15.json"), "utf8"));
  assert.deepEqual(lensJson.meta.suggestion_persistence.appended_ids, ["lens-ok-1"]);

  // Markdown artifact is the LLM's report_body directly — not renderer output
  const markdown = readFileSync(join(outputDir, "2026-03-15.md"), "utf8");
  assert.ok(markdown.includes("All systems nominal"), "markdown should be LLM report_body");

  // No separate normalized JSON artifact
  assert.equal(existsSync(join(outputDir, "2026-03-15.normalized.json")), false,
    "normalized.json should not exist — normalizer is removed");

  const insightsLatest = JSON.parse(readFileSync(join(outputDir, "insights-latest.json"), "utf8"));
  assert.deepEqual(insightsLatest, [{
    id: "insight-new",
    category: "patterns",
    recommendation: "",
    evidence: "",
    affectedGoals: [],
    actionLabel: "",
  }]);
});

test("runAnalysisLens fail-open path emits fallback markdown when no report_body", async (t) => {
  t.after(() => {
    resetAnalysisLensRuntimeForTest();
  });

  const root = fixtureRoot();
  const outputDir = join(root, "reports", "lens");

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  setAnalysisLensRuntimeForTest({
    collectLensData: async () => ({
      base: {
        langfuse: { traces: [], meta: { error: "langfuse_down" } },
        github: { issues: [], pull_requests: [], meta: { error: "" } },
        git: { commits: [], meta: { error: "" } },
        hatch_runs: { runs: [], meta: { error: "" } },
        supervisor: { ticks: [], meta: { error: "" } },
      },
      agent_learnings: { entries: [] },
      past_lens_outputs: [],
      pending_suggestions: [],
      llm_inventory: {},
      goal_decomposition_timeouts: {},
    }),
    runLensAnalysis: async () => {
      throw new Error("anthropic timeout");
    },
  });

  const out = await runAnalysisLens({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    outputDir,
  });

  assert.equal(out.ok, true);
  assert.equal(out.analysis_mode, "fail_open");
  assert.match(out.error_annotation?.message || "", /anthropic timeout/);

  const lensJson = JSON.parse(readFileSync(join(outputDir, "2026-03-16.json"), "utf8"));
  assert.equal(lensJson.meta.analysis_mode, "fail_open");
  assert.equal(lensJson.error_annotation.code, "lens_analysis_failed");

  // Markdown artifact should exist with fallback content
  const markdown = readFileSync(join(outputDir, "2026-03-16.md"), "utf8");
  assert.ok(markdown.includes("2026-03-16"), "fallback markdown should include date");
  assert.ok(markdown.length > 0, "fallback markdown should not be empty");

  // No normalized JSON
  assert.equal(existsSync(join(outputDir, "2026-03-16.normalized.json")), false);

  const insightsLatest = JSON.parse(readFileSync(join(outputDir, "insights-latest.json"), "utf8"));
  assert.deepEqual(insightsLatest, []);
});

test("runAnalysisLens uses report_body from callLlm when available", async (t) => {
  t.after(() => {
    resetAnalysisLensRuntimeForTest();
  });

  const root = fixtureRoot();
  const outputDir = join(root, "reports", "lens");

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const REPORT_BODY = "# Review retry churn tripled\n\nRetries remain elevated.\n";
  let llmCalls = 0;
  setAnalysisLensRuntimeForTest({
    collectLensData: async () => ({
      base: {
        langfuse: { traces: [{ id: "trace-1" }], meta: { error: "" } },
        github: { issues: [{ number: 2173 }], pull_requests: [], meta: { error: "" } },
        git: { commits: [{ sha: "abc" }], meta: { error: "" } },
        hatch_runs: { runs: [{ run_id: "run-1" }], meta: { error: "" } },
        supervisor: { ticks: [{ run_id: "tick-1" }], meta: { error: "" } },
      },
      agent_learnings: { entries: [{ heading: "2026-03-15", body: "learned" }] },
      past_lens_outputs: [],
      pending_suggestions: [],
      llm_inventory: {},
      goal_decomposition_timeouts: {},
    }),
    callLlm: async () => {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          report_body: REPORT_BODY,
          focus_choices: {
            prioritized_elevations: ["pipeline_stage"],
            deprioritized_elevations: ["meta_loop"],
            reasoning: "real analysis",
          },
          findings: [{
            finding_id: "finding_review_retries",
            observation: "Review retries cluster around one node",
            inference: "Review prompt misalignment",
            action: "Inspect the review node timeout budget.",
            candidate_type: "task",
            impact: "pipeline_stage",
            priority: "high",
            confidence: "high",
            evidence_links: [{ trace_id: "trace-1" }],
          }],
          trends: { improving: [], degrading: ["review_retry_spike"], stable: [] },
          suggestions: [],
          shaping_insights: [],
        };
      }
      return {
        data_quality_notes: "good enough",
        blind_spots: "cost data missing",
        prompt_effectiveness: "strong",
        missing_data: ["cost"],
        suggested_experiments: ["compare prompt versions"],
        questions_for_next_time: ["Did retries drop after timeout tuning?"],
      };
    },
  });

  const out = await runAnalysisLens({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    outputDir,
  });

  assert.equal(out.ok, true);
  assert.equal(llmCalls, 2);

  // LLM findings pass through directly — no re-inference
  const lensJson = JSON.parse(readFileSync(join(outputDir, "2026-03-16.json"), "utf8"));
  assert.equal(lensJson.findings[0].observation, "Review retries cluster around one node");
  assert.equal(lensJson.findings[0].priority, "high");
  assert.equal(lensJson.findings[0].confidence, "high");
  assert.equal(lensJson.meta_reflection.prompt_effectiveness, "strong");

  // Markdown is the LLM's report_body
  const markdown = readFileSync(join(outputDir, "2026-03-16.md"), "utf8");
  assert.ok(markdown.includes("Review retry churn tripled"), "markdown should be LLM report_body");
  assert.ok(markdown.includes("Retries remain elevated"), "markdown should be LLM report_body");
});

test("buildLensAnalysisPrompt includes v2 finding and trend schema requirements", () => {
  const prompt = buildLensAnalysisPrompt({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    analysisStart: "2026-03-15T14:45:00.000Z",
    analysisEnd: "2026-03-16T14:45:00.000Z",
    collected: {
      base: {
        langfuse: { traces: [], meta: {} },
        github: { issues: [] },
        git: { commits: [] },
        hatch_runs: { runs: [] },
        supervisor: { ticks: [] },
      },
      agent_learnings: { entries: [] },
      past_lens_outputs: [],
      pending_suggestions: [],
    },
  });

  assert.match(prompt, /finding_id, observation, inference, action, candidate_type, impact, priority, confidence/i);
  assert.match(prompt, /trend_type=first_observation/i);
  assert.match(prompt, /comparison_window\/window with start\/end\/comparison_start\/comparison_end/i);
  assert.match(prompt, /docs\/rationale\/YYYY-MM-DD-\*\.md/);
  assert.match(prompt, /supporting understanding context/i);
});

test("buildLensAnalysisPrompt excludes raw traces from langfuse data", () => {
  const bigTraces = Array.from({ length: 1000 }, (_, i) => ({
    id: `trace-${i}`,
    trace_id: `trace-${i}`,
    skill: "build",
    model: "gpt-5.3-codex",
    tokens_total: 5000,
  }));

  const prompt = buildLensAnalysisPrompt({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    analysisStart: "2026-03-15T14:45:00.000Z",
    analysisEnd: "2026-03-16T14:45:00.000Z",
    collected: {
      base: {
        langfuse: {
          traces: bigTraces,
          trace_count: 1000,
          dashboard_url: "https://us.cloud.langfuse.com/project/traces?filter=...",
          totals: { trace_count: 1000, tokens_total: 5000000, cost_total_usd: 10 },
          by_skill: [{ skill: "build", count: 1000 }],
          by_model: [{ model: "gpt-5.3-codex", count: 1000 }],
          sampled_traces: [{ trace_id: "trace-0", skill: "build" }],
        },
        github: { issues: [] },
        git: { commits: [] },
        hatch_runs: { runs: [] },
        supervisor: { ticks: [] },
      },
      agent_learnings: { entries: [] },
      past_lens_outputs: [],
      pending_suggestions: [],
    },
  });

  // Prompt must NOT contain raw trace objects
  assert.ok(!prompt.includes('"trace-999"'), "prompt should not contain raw trace IDs");
  // Prompt MUST contain aggregated data
  assert.ok(prompt.includes('"trace_count"'), "prompt should include trace_count");
  assert.ok(prompt.includes('"dashboard_url"'), "prompt should include dashboard_url");
  assert.ok(prompt.includes('"by_skill"'), "prompt should include by_skill aggregates");
  // Prompt should be small (under 10KB for this fixture)
  assert.ok(prompt.length < 10000, `prompt too large: ${prompt.length} chars`);
});

test("analysis lens help and command wiring are registered in CLI", async () => {
  const cli = buildCli();
  const output = [];
  const errors = [];

  const exitCode = await cli.run(["analysis", "lens", "--help"], {
    stdin: process.stdin,
    stdout: {
      write(chunk) {
        output.push(String(chunk));
      },
    },
    stderr: {
      write(chunk) {
        errors.push(String(chunk));
      },
    },
  });

  assert.equal(exitCode, 0, errors.join(""));
  const stdoutText = output.join("");
  assert.match(stdoutText, /--factory-id/);
  assert.match(stdoutText, /--output-dir/);
  assert.match(stdoutText, /--notify-slack/);
  assert.match(stdoutText, /--model/);
});

test("normalizeLensAnalysis passes through report_body, executive_summary, and key_metrics", () => {
  const out = normalizeLensAnalysis({
    report_body: "# Full Report\n\nDetails here.\n",
    executive_summary: {
      headline: "Factory ran at full throughput",
      summary: "24 goals closed.",
    },
    key_metrics: [
      { name: "Goals closed", value: "24" },
    ],
    findings: [{ title: "Test finding" }],
    suggestions: [],
  });

  assert.equal(out.report_body, "# Full Report\n\nDetails here.\n");
  assert.deepEqual(out.executive_summary, {
    headline: "Factory ran at full throughput",
    summary: "24 goals closed.",
  });
  assert.equal(out.key_metrics.length, 1);
  assert.equal(out.key_metrics[0].name, "Goals closed");
  assert.equal(out.findings.length, 1);
});

test("normalizeLensAnalysis returns undefined for missing report_body, executive_summary, key_metrics", () => {
  const out = normalizeLensAnalysis({
    findings: [],
    suggestions: [],
  });

  assert.equal(out.report_body, undefined);
  assert.equal(out.executive_summary, undefined);
  assert.equal(out.key_metrics, undefined);
});
