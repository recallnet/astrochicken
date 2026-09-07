import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureBodyFitsGitHubLimit,
  resetAnalysisPublishLensRuntimeForTest,
  runAnalysisPublishLens,
  setAnalysisPublishLensRuntimeForTest,
} from "../../src/commands/analysis/publish-lens.ts";

async function writeLensArtifacts(outputDir, lensJsonOverrides = {}) {
  const markdownPath = join(outputDir, "2026-03-15.md");
  const jsonPath = join(outputDir, "2026-03-15.json");
  await fsPromises.mkdir(outputDir, { recursive: true });
  await fsPromises.writeFile(markdownPath, "# Daily Lens Report — 2026-03-15\n\n## Findings\n- test\n", "utf8");
  await fsPromises.writeFile(jsonPath, `${JSON.stringify({
    findings: [
      { title: "Top finding", recommendation: "Do the thing", confidence: "high", elevation: "factory_instance" },
    ],
    meta_reflection: {
      suggested_experiments: ["Try a tighter prompt version compare"],
    },
    ...lensJsonOverrides,
  }, null, 2)}\n`, "utf8");
  return { markdownPath, jsonPath };
}

function createLensRuntime({
  outputDir,
  ghJsonFn,
  ghFn,
  postLensToSlack,
  publishLensCandidates,
  addSubIssueFn,
  lensJsonOverrides,
} = {}) {
  return {
    runAnalysisLens: async () => {
      const artifacts = await writeLensArtifacts(outputDir, lensJsonOverrides);
      return {
        ok: true,
        artifacts: {
          markdown_path: artifacts.markdownPath,
          json_path: artifacts.jsonPath,
        },
      };
    },
    ghJsonFn,
    ghFn,
    ...(postLensToSlack ? { postLensToSlack } : {}),
    ...(publishLensCandidates ? { publishLensCandidates } : {}),
    ...(addSubIssueFn ? { addSubIssueFn } : {}),
  };
}

async function runPublishLens(outputDir, options = {}) {
  return runAnalysisPublishLens({
    date: "2026-03-15",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    outputDir,
    windowStart: "2026-03-14T14:30:00.000Z",
    windowEnd: "2026-03-15T14:30:00.000Z",
    ...options,
  });
}

test("analysis publish-lens creates a dated issue when none exists and includes deterministic issue metadata", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-create-"));
  const ghCalls = [];
  const slackCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "create") {
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2097\n",
          stderr: "",
        };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    postLensToSlack: async (options) => {
      slackCalls.push(options);
      return { ok: true, delivered: true, status: "delivered" };
    },
  }));

  const payload = await runPublishLens(outputDir, { notifySlack: true });

  assert.equal(payload.issue.action, "created");
  assert.equal(payload.issue.created, true);
  assert.equal(payload.issue.number, 2097);
  assert.equal(payload.issue.url, "https://github.com/recallnet/astrochicken/issues/2097");
  assert.equal(typeof payload.narrative_document?.json_path, "string");
  assert.equal(typeof payload.narrative_document?.markdown_path, "string");
  assert.equal(payload.artifacts.narrative_json_path, payload.narrative_document.json_path);
  assert.equal(payload.artifacts.narrative_markdown_path, payload.narrative_document.markdown_path);
  assert.deepEqual(payload.candidates, { created: [], updated: [], skipped: [] });
  assert.equal(slackCalls.length, 1);

  const createCall = ghCalls.find((args) => args[0] === "issue" && args[1] === "create");
  assert.ok(createCall, "expected gh issue create call");
  assert.ok(createCall.includes("--label"));
  assert.ok(createCall.includes("daily-lens"));
  assert.equal(createCall.includes("report"), false, "report label should not be present");
});

test("analysis publish-lens updates existing open dated issue and preserves required labels", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-update-"));
  const ghCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") {
        return [{
          number: 2098,
          title: "Daily Lens Report — 2026-03-15",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2098",
          labels: [{ name: "daily-lens" }],
        }];
      }
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "edit") {
        return { ok: true, status: 0, stdout: "", stderr: "" };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
  }));

  const payload = await runPublishLens(outputDir);

  assert.equal(payload.issue.action, "updated");
  assert.equal(payload.issue.created, false);
  assert.equal(payload.issue.number, 2098);
  assert.equal(payload.issue.url, "https://github.com/recallnet/astrochicken/issues/2098");
  assert.match(payload.narrative_document?.json_path || "", /2026-03-15\.narrative\.json$/);
  assert.match(payload.narrative_document?.markdown_path || "", /2026-03-15\.narrative\.md$/);
  assert.deepEqual(payload.candidates, { created: [], updated: [], skipped: [] });

  assert.equal(ghCalls.some((args) => args[0] === "issue" && args[1] === "create"), false);
  const editCall = ghCalls.find((args) => args[0] === "issue" && args[1] === "edit");
  assert.ok(editCall, "expected gh issue edit call");
  assert.ok(editCall.includes("--add-label"));
  assert.ok(editCall.includes("daily-lens"));
  assert.equal(editCall.includes("report"), false, "report label should not be present");
});

test("analysis publish-lens resolves slack webhook from factoryConfigWebhookUrl when env flag is absent", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-slack-cfg-"));
  const slackCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    ghJsonFn: (args, fallback) => {
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return { ok: true, status: 0, stdout: "https://github.com/recallnet/astrochicken/issues/9999\n", stderr: "" };
      }
      return { ok: false, status: 1, stdout: "", stderr: "" };
    },
    postLensToSlack: async (options) => {
      slackCalls.push(options);
      // Verify the factoryConfigWebhookUrl is passed through
      assert.equal(typeof options.factoryConfigWebhookUrl, "string");
      assert.ok(options.factoryConfigWebhookUrl.length > 0, "factoryConfigWebhookUrl should be non-empty");
      return { ok: true, delivered: true, status: "delivered", webhook_source: "factory_config" };
    },
  }));

  const payload = await runPublishLens(outputDir, {
    notifySlack: true,
    factoryConfigWebhookUrl: "${MOTHERSHIP_SLACK_WEBHOOK_URL}",
  });

  assert.equal(payload.slack.ok, true);
  assert.equal(payload.slack.delivered, true);
  assert.equal(slackCalls.length, 1);
});

test("analysis publish-lens reopens then updates existing closed dated issue", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-reopen-"));
  const ghCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") {
        return [{
          number: 2099,
          title: "Daily Lens Report — 2026-03-15",
          state: "CLOSED",
          url: "https://github.com/recallnet/astrochicken/issues/2099",
          labels: [{ name: "daily-lens" }, { name: "report" }],
        }];
      }
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && (args[1] === "reopen" || args[1] === "edit")) {
        return { ok: true, status: 0, stdout: "", stderr: "" };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
  }));

  const payload = await runPublishLens(outputDir);

  assert.equal(payload.issue.action, "reopened");
  assert.equal(payload.issue.created, false);
  assert.equal(payload.issue.number, 2099);
  assert.equal(payload.issue.url, "https://github.com/recallnet/astrochicken/issues/2099");
  assert.ok(payload.narrative_document?.json_path);
  assert.ok(payload.narrative_document?.markdown_path);
  assert.deepEqual(payload.candidates, { created: [], updated: [], skipped: [] });

  const reopenIndex = ghCalls.findIndex((args) => args[0] === "issue" && args[1] === "reopen");
  const editIndex = ghCalls.findIndex((args) => args[0] === "issue" && args[1] === "edit");
  assert.ok(reopenIndex >= 0, "expected gh issue reopen call");
  assert.ok(editIndex >= 0, "expected gh issue edit call");
  assert.ok(reopenIndex < editIndex, "expected reopen to happen before update");
});

test("analysis publish-lens materializes candidate issues and links them to the report", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-candidates-create-"));
  const ghCalls = [];
  const linkCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    lensJsonOverrides: {
      date: "2026-03-15",
      meta: { run_id: "run-123" },
      suggestions: [
        {
          id: "lens-2026-03-15-001",
          summary: "Add deterministic gate for flaky retries",
          recommendation: "Capture flaky retry signature and fail closed.",
          evidence_refs: [{ ref: "langfuse.trace:123" }],
        },
        {
          id: "lens-2026-03-15-002",
          summary: "Improve routing telemetry",
          evidence: ["factory status logs"],
        },
      ],
    },
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list" && args.includes("Daily Lens Report — 2026-03-15")) {
        return [];
      }
      if (args[0] === "issue" && args[1] === "list" && args.includes("Add deterministic gate for flaky retries")) {
        return [];
      }
      if (args[0] === "issue" && args[1] === "list" && args.includes("Improve routing telemetry")) {
        return [];
      }
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "create" && args.includes("Daily Lens Report — 2026-03-15")) {
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2100\n",
          stderr: "",
        };
      }
      if (args[0] === "issue" && args[1] === "create" && args.includes("Add deterministic gate for flaky retries")) {
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2101\n",
          stderr: "",
        };
      }
      if (args[0] === "issue" && args[1] === "create" && args.includes("Improve routing telemetry")) {
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2102\n",
          stderr: "",
        };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    addSubIssueFn: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
  }));

  const payload = await runPublishLens(outputDir);

  assert.equal(payload.issue.number, 2100);
  assert.equal(payload.candidates.created.length, 2);
  assert.equal(payload.candidates.updated.length, 0);
  assert.equal(payload.candidates.skipped.length, 0);
  assert.deepEqual(linkCalls.map((entry) => entry.childNumber), [2101, 2102]);
  assert.deepEqual(linkCalls.map((entry) => entry.parentNumber), [2100, 2100]);

  const candidateCreateCalls = ghCalls.filter((args) => (
    args[0] === "issue"
    && args[1] === "create"
    && !args.join(" ").includes("Daily Lens Report")
  ));
  assert.equal(candidateCreateCalls.length, 2);
  for (const call of candidateCreateCalls) {
    assert.ok(call.includes("--label"));
    assert.ok(call.includes("daily-lens"));
    assert.ok(call.includes("daily-lens-candidate"));
    assert.ok(call.includes("--body"));
    const bodyIndex = call.indexOf("--body");
    const body = bodyIndex >= 0 ? String(call[bodyIndex + 1] || "") : "";
    assert.match(body, /origin_report_number/);
    assert.match(body, /lens_run_id/);
    assert.match(body, /Do not add `goal` or `ready` labels/);
  }
});

test("analysis publish-lens updates existing candidate issues and skips malformed suggestions", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-candidates-update-"));
  const ghCalls = [];
  const linkCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    lensJsonOverrides: {
      date: "2026-03-15",
      suggestions: [
        {
          id: "lens-2026-03-15-001",
          summary: "Add deterministic gate for flaky retries",
          recommendation: "Updated recommendation",
          evidence_refs: ["langfuse.trace:999"],
        },
        {
          id: "lens-2026-03-15-002",
          summary: "",
        },
      ],
    },
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list" && args.includes("Daily Lens Report — 2026-03-15")) {
        return [{
          number: 2100,
          title: "Daily Lens Report — 2026-03-15",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2100",
          labels: [{ name: "daily-lens" }, { name: "report" }],
        }];
      }
      if (args[0] === "issue" && args[1] === "list" && args.includes("lens-2026-03-15-001")) {
        return [{
          number: 2101,
          title: "Add deterministic gate for flaky retries",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2101",
        }];
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2101") {
        return {
          number: 2101,
          title: "Add deterministic gate for flaky retries",
          state: "OPEN",
          url: "https://github.com/recallnet/astrochicken/issues/2101",
          body: "old body",
          labels: [{ name: "daily-lens" }],
        };
      }
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "edit") {
        return { ok: true, status: 0, stdout: "", stderr: "" };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
    addSubIssueFn: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
  }));

  const payload = await runPublishLens(outputDir);

  assert.equal(payload.issue.number, 2100);
  assert.equal(payload.candidates.created.length, 0);
  assert.equal(payload.candidates.updated.length, 1);
  assert.equal(payload.candidates.skipped.length, 1);
  assert.equal(payload.candidates.skipped[0].reason, "missing_summary");
  assert.deepEqual(linkCalls.map((entry) => entry.childNumber), [2101]);

  const candidateEditCall = ghCalls.find((args) => args[0] === "issue" && args[1] === "edit" && String(args[2]) === "2101");
  assert.ok(candidateEditCall, "expected candidate issue update call");
  assert.ok(candidateEditCall.includes("--add-label"));
  assert.ok(candidateEditCall.includes("daily-lens"));
  assert.ok(candidateEditCall.includes("daily-lens-candidate"));
});

test("ensureBodyFitsGitHubLimit returns original path when body is under limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lens-body-small-"));
  const mdPath = join(dir, "small.md");
  await fsPromises.writeFile(mdPath, "# Short report\n\nAll good.\n", "utf8");
  const result = ensureBodyFitsGitHubLimit(mdPath, { repo: "recallnet/astrochicken" });
  assert.equal(result, mdPath);
});

test("ensureBodyFitsGitHubLimit truncates body exceeding 65536 chars and adds note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lens-body-large-"));
  const mdPath = join(dir, "large.md");
  const bigBody = "# Report\n\n" + "x".repeat(70000);
  await fsPromises.writeFile(mdPath, bigBody, "utf8");
  const result = ensureBodyFitsGitHubLimit(mdPath, { repo: "recallnet/astrochicken" });
  assert.notEqual(result, mdPath, "should return a different (truncated) path");
  const truncated = await fsPromises.readFile(result, "utf8");
  assert.ok(truncated.length <= 65536, `truncated body should be <= 65536 chars, got ${truncated.length}`);
  assert.ok(truncated.includes("truncated"), "should contain truncation note");
  assert.ok(truncated.includes("large.md"), "should reference the full report file");
});

test("analysis publish-lens truncates oversized markdown when creating issue", async (t) => {
  t.after(() => {
    resetAnalysisPublishLensRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-publish-lens-oversize-"));
  const ghCalls = [];

  setAnalysisPublishLensRuntimeForTest(createLensRuntime({
    outputDir,
    ghJsonFn: (args, fallback) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "list") return [];
      return fallback;
    },
    ghFn: (args) => {
      ghCalls.push(args);
      if (args[0] === "issue" && args[1] === "create") {
        const bodyFileIndex = args.indexOf("--body-file");
        if (bodyFileIndex >= 0) {
          const bodyPath = args[bodyFileIndex + 1];
          const body = readFileSync(bodyPath, "utf8");
          assert.ok(body.length <= 65536, `issue body should be <= 65536 chars, got ${body.length}`);
        }
        return {
          ok: true,
          status: 0,
          stdout: "https://github.com/recallnet/astrochicken/issues/2300\n",
          stderr: "",
        };
      }
      return { ok: false, status: 1, stdout: "", stderr: `unexpected gh args: ${args.join(" ")}` };
    },
  }));

  // Override the markdown to be oversized
  const markdownPath = join(outputDir, "2026-03-15.md");
  await fsPromises.writeFile(markdownPath, "# Report\n\n" + "x".repeat(70000), "utf8");

  const payload = await runPublishLens(outputDir);
  assert.equal(payload.issue.action, "created");
  assert.equal(payload.issue.number, 2300);
});
