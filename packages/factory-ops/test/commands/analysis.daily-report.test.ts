import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { buildCli } from "../../src/cli/index.ts";
import {
  setAnalysisDailyReportRuntimeForTest,
  resetAnalysisDailyReportRuntimeForTest,
} from "../../src/commands/analysis/daily-report.ts";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalHeadingRegexesFromTemplate() {
  const template = readFileSync("docs/skills/daily-analysis/templates/report-sections.md", "utf8");
  const headingLines = template
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^H\d\|/.test(line));

  return headingLines.map((line) => {
    const [, heading] = line.match(/^H\d\|(.+?)\|label=.*$/) || [];
    const pattern = escapeRegExp(heading || "")
      .replace(/<YYYY-MM-DD>/g, "\\d{4}-\\d{2}-\\d{2}")
      .replace(/<domain-name>/g, ".+");
    return new RegExp(`^${pattern}$`, "m");
  });
}

async function runCli(args) {
  const cli = buildCli();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";

  stdout.on("data", (chunk) => { stdoutText += chunk.toString(); });
  stderr.on("data", (chunk) => { stderrText += chunk.toString(); });

  const exitCode = await cli.run(args, {
    stdin: process.stdin,
    stdout,
    stderr,
  });

  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
  };
}

test("analysis daily-report writes markdown/json artifacts with required sections", async (t) => {
  t.after(() => {
    resetAnalysisDailyReportRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-daily-report-"));
  const writeCalls = [];

  setAnalysisDailyReportRuntimeForTest({
    collectDailyInsightData: async () => ({
      langfuse: {
        traces: [
          { id: "trace-1", cost_usd: 0.42, duration_ms: 1200 },
          { id: "trace-2", cost_usd: 0.13, duration_ms: 600 },
        ],
        meta: { error: "" },
      },
      github: {
        issues: [{ number: 1324, title: "Implement report", state: "closed", url: "https://example.com/issues/1324" }],
        pull_requests: [{ number: 700, title: "Add command", merged_at: "2026-03-05T05:00:00.000Z", url: "https://example.com/pr/700" }],
        meta: { error: "" },
      },
      git: {
        commits: [{ sha: "abc123", subject: "feat: report", author: "dev", committed_at: "2026-03-05T06:00:00.000Z" }],
        meta: { error: "" },
      },
      hatch_runs: {
        runs: [{ run_id: "run-1", status: "completed", node: "done", updated_at: "2026-03-05T07:00:00.000Z" }],
        meta: { error: "" },
      },
      supervisor: {
        ticks: [{ run_id: "tick-1", status: "completed", node: "execute_wave", updated_at: "2026-03-05T07:01:00.000Z" }],
        meta: { error: "" },
      },
    }),
    fs: {
      mkdir: async (dir, options) => fsPromises.mkdir(dir, options),
      writeFile: async (filePath, content, encoding) => {
        writeCalls.push({ filePath, content: String(content) });
        await fsPromises.writeFile(filePath, content, encoding);
      },
    },
  });

  const result = await runCli([
    "analysis",
    "daily-report",
    "--date",
    "2026-03-06",
    "--repo",
    "recallnet/astrochicken",
    "--output-dir",
    outputDir,
    "--langfuse-retries",
    "3",
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(writeCalls.length, 2);

  const markdownPath = join(outputDir, "2026-03-06.md");
  const jsonPath = join(outputDir, "2026-03-06.json");

  const markdown = readFileSync(markdownPath, "utf8");
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));

  for (const headingRegex of canonicalHeadingRegexesFromTemplate()) {
    assert.match(markdown, headingRegex);
  }

  assert.ok(json.domains);
  assert.ok(Array.isArray(json.anomalies));
  assert.ok(json.self_improvement);
  assert.ok(json.sources);
  assert.ok(json.missing_sources);
  assert.equal(json.missing_sources.missing_langfuse, false);
  assert.ok(Array.isArray(json.sources.langfuse_traces));
  assert.ok(Array.isArray(json.sources.issues));
  assert.ok(Array.isArray(json.sources.runs));
  assert.ok(Array.isArray(json.sources.git_commits));
});

test("analysis daily-report emits missing_langfuse metadata instead of failing", async (t) => {
  t.after(() => {
    resetAnalysisDailyReportRuntimeForTest();
  });

  const outputDir = mkdtempSync(join(tmpdir(), "analysis-daily-report-missing-"));

  setAnalysisDailyReportRuntimeForTest({
    collectDailyInsightData: async () => ({
      langfuse: { traces: [], meta: { error: "langfuse_unavailable" } },
      github: {
        issues: [{ number: 1324, title: "Implement report", state: "open", url: "https://example.com/issues/1324" }],
        pull_requests: [],
        meta: { error: "" },
      },
      git: { commits: [], meta: { error: "" } },
      hatch_runs: { runs: [], meta: { error: "" } },
      supervisor: { ticks: [], meta: { error: "" } },
    }),
    fs: {
      mkdir: async (dir, options) => fsPromises.mkdir(dir, options),
      writeFile: async (filePath, content, encoding) => fsPromises.writeFile(filePath, content, encoding),
    },
  });

  const result = await runCli([
    "analysis",
    "daily-report",
    "--date",
    "2026-03-06",
    "--repo",
    "recallnet/astrochicken",
    "--output-dir",
    outputDir,
  ]);

  assert.equal(result.exitCode, 0, result.stderr);

  const markdown = readFileSync(join(outputDir, "2026-03-06.md"), "utf8");
  const json = JSON.parse(readFileSync(join(outputDir, "2026-03-06.json"), "utf8"));

  assert.equal(json.missing_sources.missing_langfuse, true);
  assert.match(markdown, /missing_langfuse=true/);
});

test("analysis daily-report help is wired through CLI registry", async () => {
  const result = await runCli(["analysis", "daily-report", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--date/);
  assert.match(result.stdout, /--repo/);
  assert.match(result.stdout, /--output-dir/);
  assert.match(result.stdout, /--langfuse-retries/);
});
