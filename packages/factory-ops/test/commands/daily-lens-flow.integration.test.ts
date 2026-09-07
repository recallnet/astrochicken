/**
 * daily-lens-flow.e2e.test.mjs
 *
 * End-to-end spec test for the daily_lens_publish pipeline.
 * Wires together real deterministic functions with mocked I/O (LLM, GH, Slack,
 * filesystem) to verify the full data flow:
 *
 * Mirrors the DOT graph:
 *   set_date → set_repo → ... → prepare_daily_lens
 *     → load_daily_lens_analysis_prompt → analyze_daily_lens (mocked LLM)
 *     → finalize_daily_lens → generate_followup_candidates
 *
 * Concretely tests:
 *   runAnalysisLens → publishLensArtifacts → runAnalysisLensFollowupCandidates
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runAnalysisLens,
  normalizeLensAnalysis,
  normalizeMetaReflection,
  setAnalysisLensRuntimeForTest,
  resetAnalysisLensRuntimeForTest,
} from "../../src/commands/analysis/lens.ts";
import {
  publishLensArtifacts,
  setAnalysisPublishLensRuntimeForTest,
  resetAnalysisPublishLensRuntimeForTest,
} from "../../src/commands/analysis/publish-lens.ts";
import { validateNarrativeDocument } from "../../src/lib/narrative-document-contract.ts";

// --- Fixtures ---

function makeLlmAnalysisOutput() {
  return {
    report_body: "# Goal throughput doubled\n\n3 goals closed this window, up from 1.5 avg.\n\n## Key findings\n\n### 1. Goal completion rate improved\n\n3 goals closed in 24h.\n",
    focus_choices: {
      primary_focus: "Factory throughput and goal completion rates",
      reasoning: "Goals closed and merge throughput are the strongest signals.",
    },
    findings: [
      {
        finding_id: "finding-001",
        observation: "Goal completion rate improved",
        inference: "Toposort execution plan is working.",
        action: "Monitor for sustainability.",
        candidate_type: "task",
        impact: "throughput",
        priority: "low",
        confidence: "high",
        evidence_links: [{ ref: "goals_closed: 3" }],
      },
    ],
    trends: {
      improving: ["Goal completion velocity"],
      stable: ["Merge success rate"],
      degrading: [],
    },
    suggestions: [
      {
        id: "sug-001",
        summary: "Consider batching small goals into compound waves",
        type: "efficiency",
        status: "pending",
        evidence_refs: [],
      },
    ],
    shaping_insights: [
      {
        id: "example-web-001",
        category: "process",
        observation: "Wave dispatch favors small goals over compound goals",
        implication: "Compound goals may see slower throughput",
        suggested_experiment: "Batch 2-3 small goals into a single wave",
      },
    ],
    meta_reflection: {
      data_quality_notes: "All data sources available. Langfuse traces complete.",
      blind_spots: "No visibility into external dependency latency.",
      prompt_effectiveness: "Findings are actionable and evidence-backed.",
      missing_data: [],
      suggested_experiments: ["Track external API call latency per wave."],
      questions_for_next_time: ["Are compound waves actually faster?"],
    },
  };
}

function makeCollectedData() {
  return {
    base: {
      langfuse: { traces: [], meta: { ok: true } },
      github: { issues: [], prs: [], meta: { ok: true } },
      git: { commits: [], meta: { ok: true } },
      hatch_runs: { runs: [], meta: { ok: true } },
      supervisor: { ticks: [], meta: { ok: true } },
    },
    agent_learnings: [],
    past_lens_outputs: [],
    pending_suggestions: [],
    llm_inventory: [],
    goal_decomposition_timeouts: [],
    langfuse_metrics: {},
  };
}

// --- E2E: Full happy-path pipeline ---

test("daily lens flow e2e: collect → analyze → artifacts → publish → candidates", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "daily-lens-e2e-"));
  const outputDir = join(tempRoot, "reports", "lens");
  const learningLogPath = join(tempRoot, "learning-log.json");
  writeFileSync(learningLogPath, "[]");

  const collectedData = makeCollectedData();
  const analysisOutput = makeLlmAnalysisOutput();

  // Mock runtime for runAnalysisLens
  setAnalysisLensRuntimeForTest({
    collectLensData: async () => collectedData,
    callLlm: async () => analysisOutput,
    runLensAnalysis: async () => analysisOutput,
    runLensMetaReflection: async () => analysisOutput.meta_reflection,
    appendLearningItem: async () => ({ ok: true }),
    fs: {
      mkdir: async (path, opts) => mkdirSync(path, opts),
      writeFile: async (path, data) => writeFileSync(path, data),
    },
  });

  t.after(() => resetAnalysisLensRuntimeForTest());

  // Step 1: Run analysis lens
  const lensResult = await runAnalysisLens({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    learningLogPath,
    model: "claude-sonnet-4-6",
    windowStart: "2026-03-18T08:45:00.000Z",
    windowEnd: "2026-03-19T08:45:00.000Z",
  });

  assert.equal(lensResult.ok, true);
  assert.equal(lensResult.date, "2026-03-19");
  assert.equal(lensResult.repo, "recallnet/astrochicken");
  assert.equal(lensResult.factory_id, "mothership");
  assert.equal(lensResult.analysis_mode, "normal");
  assert.equal(lensResult.error_annotation, null);

  // Verify artifacts were written
  assert.ok(lensResult.artifacts.json_path, "should have json artifact path");
  assert.ok(lensResult.artifacts.markdown_path, "should have markdown artifact path");

  // Read the JSON artifact and verify structure
  const lensJson = JSON.parse(readFileSync(lensResult.artifacts.json_path, "utf8"));
  assert.equal(lensJson.date, "2026-03-19");
  assert.equal(lensJson.repo, "recallnet/astrochicken");
  assert.ok(Array.isArray(lensJson.findings), "findings should be an array");
  assert.ok(lensJson.findings.length > 0, "should have at least one finding");
  assert.ok(lensJson.meta_reflection, "should have meta reflection");

  // Verify markdown artifact is the LLM's report_body
  const markdown = readFileSync(lensResult.artifacts.markdown_path, "utf8");
  assert.ok(markdown.includes("Goal throughput doubled"), "markdown should be LLM report_body");

  // Step 2: Publish lens artifacts (mocked GH)
  setAnalysisPublishLensRuntimeForTest({
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/recallnet/astrochicken/issues/2600" };
      }
      return { ok: true, stdout: "" };
    },
    ghJsonFn: (args, fallback) => fallback ?? [],
    postLensToSlack: async () => ({ ok: true, delivered: true, status: "delivered" }),
    publishLensCandidates: async () => ({ ok: true }),
  });

  t.after(() => resetAnalysisPublishLensRuntimeForTest());

  const publishResult = await publishLensArtifacts({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lensJson,
    artifacts: lensResult.artifacts,
    notifySlack: true,
    issueLabels: ["daily-lens"],
    slackWebhookUrl: "https://hooks.slack.test/lens",
  });

  assert.equal(publishResult.issue.action, "created");
  assert.equal(publishResult.issue.number, 2600);
  assert.ok(publishResult.issue.url.includes("2600"));

  const narrativeDoc = publishResult.narrative_document;
  assert.ok(narrativeDoc, "narrative_document should be returned");
  assert.ok(existsSync(narrativeDoc.json_path), "daily lens narrative json should exist");
  assert.ok(existsSync(narrativeDoc.markdown_path), "daily lens narrative markdown should exist");

  const narrativeJson = JSON.parse(readFileSync(narrativeDoc.json_path, "utf8"));
  const narrativeMetadata = narrativeDoc.metadata || narrativeJson?.metadata;
  const metadataValidation = validateNarrativeDocument(narrativeMetadata);
  assert.equal(metadataValidation.ok, true, JSON.stringify(metadataValidation, null, 2));
  assert.equal(
    narrativeMetadata?.astro?.canonical_issue_url,
    publishResult.issue.url,
    "narrative canonical issue backlink should match published issue URL",
  );
  assert.ok(
    String(narrativeMetadata?.astro?.canonical_issue_url || "").length > 0,
    "narrative canonical issue backlink must be non-empty",
  );

  assert.equal(publishResult.slack.ok, true);
  assert.equal(publishResult.slack.delivered, true);
  assert.equal(publishResult.factory_id, "mothership");
});

// --- E2E: Fail-open analysis mode ---

test("daily lens flow e2e: LLM failure produces fail-open artifacts", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "daily-lens-failopen-"));
  const outputDir = join(tempRoot, "reports", "lens");
  const learningLogPath = join(tempRoot, "learning-log.json");
  writeFileSync(learningLogPath, "[]");

  setAnalysisLensRuntimeForTest({
    collectLensData: async () => makeCollectedData(),
    callLlm: async () => { throw new Error("LLM unavailable"); },
    runLensAnalysis: async () => { throw new Error("LLM unavailable"); },
    runLensMetaReflection: async () => { throw new Error("LLM unavailable"); },
    appendLearningItem: async () => ({ ok: true }),
    fs: {
      mkdir: async (path, opts) => mkdirSync(path, opts),
      writeFile: async (path, data) => writeFileSync(path, data),
    },
  });

  t.after(() => resetAnalysisLensRuntimeForTest());

  const result = await runAnalysisLens({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    learningLogPath,
    windowStart: "2026-03-18T08:45:00.000Z",
    windowEnd: "2026-03-19T08:45:00.000Z",
  });

  assert.equal(result.ok, true, "fail-open should still return ok=true");
  assert.equal(result.analysis_mode, "fail_open");
  assert.ok(result.error_annotation, "should have error annotation");
  assert.equal(result.error_annotation.code, "lens_analysis_failed");
  assert.match(result.error_annotation.message, /LLM unavailable/);

  // Artifacts should still be written (fail-open contract)
  assert.ok(result.artifacts.json_path);
  const failOpenJson = JSON.parse(readFileSync(result.artifacts.json_path, "utf8"));
  assert.equal(failOpenJson.meta.analysis_mode, "fail_open");
});

// --- E2E: Collector failure degrades gracefully ---

test("daily lens flow e2e: collector failure degrades gracefully", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "daily-lens-collector-fail-"));
  const outputDir = join(tempRoot, "reports", "lens");
  const learningLogPath = join(tempRoot, "learning-log.json");
  writeFileSync(learningLogPath, "[]");

  setAnalysisLensRuntimeForTest({
    collectLensData: async () => { throw new Error("langfuse_timeout"); },
    callLlm: async () => makeLlmAnalysisOutput(),
    runLensAnalysis: async () => makeLlmAnalysisOutput(),
    runLensMetaReflection: async () => makeLlmAnalysisOutput().meta_reflection,
    appendLearningItem: async () => ({ ok: true }),
    fs: {
      mkdir: async (path, opts) => mkdirSync(path, opts),
      writeFile: async (path, data) => writeFileSync(path, data),
    },
  });

  t.after(() => resetAnalysisLensRuntimeForTest());

  const result = await runAnalysisLens({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    learningLogPath,
    windowStart: "2026-03-18T08:45:00.000Z",
    windowEnd: "2026-03-19T08:45:00.000Z",
  });

  assert.equal(result.ok, true);
  // Collector error should be recorded
  const lensJson = JSON.parse(readFileSync(result.artifacts.json_path, "utf8"));
  assert.ok(lensJson.meta.collector_errors.length > 0, "should record collector error");
  assert.ok(lensJson.meta.collector_errors.some((e) => e.includes("langfuse_timeout")));
});

// --- E2E: Publish without Slack notification ---

test("daily lens flow e2e: publish without Slack when notifySlack=false", async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), "daily-lens-noslack-"));
  const outputDir = join(tempRoot, "reports", "lens");
  const learningLogPath = join(tempRoot, "learning-log.json");
  writeFileSync(learningLogPath, "[]");

  setAnalysisLensRuntimeForTest({
    collectLensData: async () => makeCollectedData(),
    runLensAnalysis: async () => makeLlmAnalysisOutput(),
    runLensMetaReflection: async () => makeLlmAnalysisOutput().meta_reflection,
    appendLearningItem: async () => ({ ok: true }),
    fs: {
      mkdir: async (path, opts) => mkdirSync(path, opts),
      writeFile: async (path, data) => writeFileSync(path, data),
    },
  });
  t.after(() => resetAnalysisLensRuntimeForTest());

  const lensResult = await runAnalysisLens({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    learningLogPath,
    windowStart: "2026-03-18T08:45:00.000Z",
    windowEnd: "2026-03-19T08:45:00.000Z",
  });

  const lensJson = JSON.parse(readFileSync(lensResult.artifacts.json_path, "utf8"));

  let slackCalled = false;
  setAnalysisPublishLensRuntimeForTest({
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/recallnet/astrochicken/issues/2601" };
      }
      return { ok: true, stdout: "" };
    },
    ghJsonFn: (args, fallback) => fallback ?? [],
    postLensToSlack: async () => { slackCalled = true; return { ok: true }; },
  });
  t.after(() => resetAnalysisPublishLensRuntimeForTest());

  const publishResult = await publishLensArtifacts({
    date: "2026-03-19",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lensJson,
    artifacts: lensResult.artifacts,
    notifySlack: false,
  });

  assert.equal(publishResult.issue.action, "created");
  assert.equal(publishResult.issue.number, 2601);
  assert.equal(publishResult.slack.status, "not_requested");
  assert.equal(publishResult.slack.delivered, false);
  assert.equal(slackCalled, false, "Slack should not be called when notifySlack=false");
});

// --- E2E: Normalization preserves analysis output shape ---

test("daily lens flow e2e: normalization preserves all required fields", () => {
  const rawAnalysis = makeLlmAnalysisOutput();
  const normalized = normalizeLensAnalysis(rawAnalysis);

  assert.ok(normalized.focus_choices, "normalized should have focus_choices");
  assert.ok(Array.isArray(normalized.findings), "normalized should have findings array");
  assert.ok(normalized.trends, "normalized should have trends");
  assert.ok(Array.isArray(normalized.suggestions), "normalized should have suggestions array");

  // Each finding passes through from LLM output
  for (const finding of normalized.findings) {
    assert.ok(finding.finding_id, "finding should have finding_id");
    assert.ok(finding.observation, "finding should have observation");
  }

  // report_body passes through
  assert.ok(normalized.report_body, "normalized should have report_body");

  // Meta reflection normalization
  const normalizedMeta = normalizeMetaReflection(rawAnalysis.meta_reflection);
  assert.ok(normalizedMeta.data_quality_notes, "meta should have data_quality_notes");
  assert.ok(normalizedMeta.blind_spots, "meta should have blind_spots");
  assert.ok(normalizedMeta.prompt_effectiveness, "meta should have prompt_effectiveness");
});

// --- E2E: Missing date/repo throws deterministic error ---

test("daily lens flow e2e: missing date throws deterministic error", async () => {
  await assert.rejects(
    () => runAnalysisLens({ date: "", repo: "recallnet/astrochicken" }),
    /missing_date/,
  );
});

test("daily lens flow e2e: missing repo throws deterministic error", async () => {
  await assert.rejects(
    () => runAnalysisLens({ date: "2026-03-19", repo: "" }),
    /missing_repo/,
  );
});
