import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { triageQaInfrastructure } from "../../src/commands/milestone-qa-infra-triage.ts";

export const testDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(testDir, "../../..");
export const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
export const realNodePath = process.execPath;

export function makeEvidenceFixture(tempDir, payload = {}) {
  const evidencePath = join(tempDir, "review.json");
  const worktreeDir = payload.worktree_dir || join(tempDir, "worktree");
  const evidence = {
    issue_number: "630",
    branch: "wave/goal-611-wave-2",
    worktree_dir: worktreeDir,
    judge_context: {
      scenario: "qa/review-evidence",
    },
    review_qa_command: "npm run test",
    integration_command: "npm run test",
    qa: {
      status: "fail",
      command: "npm run test",
      exit_code: 2,
    },
    ...payload,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidencePath;
}

export function sh(args, cwd) {
  const run = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return String(run.stdout || "").trim();
}

export function registerMilestoneQaInfraTriageTests(registerTest) {
  registerTest("triageQaInfrastructure reruns QA, posts success comment, and returns exit_code=0", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-pass-"));
    const fixturePath = resolve(testDir, "fixtures/milestone-postmortem/qa-infra-missing-command.json");
    const evidencePath = join(temp, "review.json");
    writeFileSync(evidencePath, readFileSync(fixturePath, "utf8"), "utf8");
    const comments = [];
    const nodeCalls = [];

    const out = triageQaInfrastructure({
      repo: "recallnet/astrochicken",
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
      reviewEvidencePath: evidencePath,
    }, {
      runNode: (args) => {
        nodeCalls.push(args);
        return {
          ok: true,
          code: 0,
          stdout: JSON.stringify({
            qa_rerun_ok: "true",
            qa_rerun_count: "2",
            qa_status: "pass",
            qa_command: "",
            qa_command_source: "review_evidence.review_qa_command",
            qa_exit_code: "0",
            review_evidence_path: evidencePath,
            review_evidence_error: "",
            qa_stdout_excerpt: "all good",
            qa_stderr_excerpt: "stderr stayed quiet",
          }),
          stderr: "[wave-issue] qa_rerun ok=true count=2 status=pass exit=0",
        };
      },
      issueComment: ({ issueNumber, body }) => {
        comments.push({ issueNumber, body });
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    assert.equal(out.exit_code, 0);
    assert.equal(out.ok, true);
    assert.equal(out.judge_context_scenario, "qa/review-evidence");
    assert.equal(out.qa_rerun_count, "2");
    assert.equal(out.qa_command, "npm run test -- --grep qa-infra");
    assert.equal(out.qa_command_source, "review_evidence.review_qa_command");
    assert.equal(out.comment_posted, true);
    assert.equal(nodeCalls.length, 1);
    assert.deepEqual(nodeCalls[0].slice(0, 4), [
      "packages/factory-ops/src/cli.ts",
      "wave-issue",
      "rerun-review-qa",
      "--review-evidence-path",
    ]);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].issueNumber, "630");
    assert.match(comments[0].body, /QA infrastructure block cleared:/);
    assert.match(comments[0].body, /attempt 2/);
    assert.match(comments[0].body, /qa\/review-evidence/);
    assert.match(comments[0].body, /Fallback command: `npm run test -- --grep qa-infra`/);
    assert.match(comments[0].body, /Fallback source: `review_evidence\.review_qa_command`/);
    assert.match(comments[0].body, /Stdout excerpt:/);
    assert.match(comments[0].body, /all good/);
    assert.match(comments[0].body, /Stderr excerpt:/);
    assert.match(comments[0].body, /stderr stayed quiet/);
  });

  registerTest("triageQaInfrastructure posts failure details and bug pointer on rerun failure", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-fail-"));
    const fixturePath = resolve(testDir, "fixtures/milestone-postmortem/qa-infra-missing-command.json");
    const evidencePath = join(temp, "review.json");
    writeFileSync(evidencePath, readFileSync(fixturePath, "utf8"), "utf8");
    const comments = [];
    const analyzeCalls = [];

    const out = triageQaInfrastructure({
      repo: "recallnet/astrochicken",
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
      reviewEvidencePath: evidencePath,
    }, {
      runNode: () => ({
        ok: false,
        code: 2,
        stdout: JSON.stringify({
          qa_rerun_ok: "false",
          qa_rerun_count: "3",
          qa_status: "fail",
          qa_command: "",
          qa_command_source: "review_evidence.review_qa_command",
          qa_exit_code: "2",
          review_evidence_path: evidencePath,
          review_evidence_error: "",
          qa_stdout_excerpt: "stdout payload",
          qa_stderr_excerpt: "stderr payload",
        }),
        stderr: "[wave-issue] qa_rerun ok=false count=3 status=fail exit=2",
      }),
      issueComment: ({ body }) => {
        comments.push(body);
        return { ok: true, stdout: "", stderr: "" };
      },
      analyzeGiveUp: (args) => {
        analyzeCalls.push(args);
        return { classification: "qa_infrastructure", bug_filed: true, bug_url: "https://example.test/bug/123" };
      },
    });

    assert.equal(out.exit_code, 2);
    assert.equal(out.ok, false);
    assert.equal(out.bug_url, "https://example.test/bug/123");
    assert.equal(out.qa_rerun_exit_code, "2");
    assert.equal(out.qa_rerun_count, "3");
    assert.equal(out.qa_command, "npm run test -- --grep qa-infra");
    assert.equal(out.qa_command_source, "review_evidence.review_qa_command");
    assert.equal(analyzeCalls.length, 1);
    assert.match(comments[0], /QA infrastructure rerun still blocked:/);
    assert.match(comments[0], /Fast-tracked bug: https:\/\/example.test\/bug\/123/);
    assert.match(comments[0], /Scenario: qa\/review-evidence/);
    assert.match(comments[0], /Missing qa.command triggered persisted fallback rerun before resolving triage\./);
    assert.match(comments[0], /Fallback command: `npm run test -- --grep qa-infra`/);
    assert.match(comments[0], /Fallback source: `review_evidence\.review_qa_command`/);
    assert.match(comments[0], /Exit code: 2/);
    assert.match(comments[0], /stdout payload/);
    assert.match(comments[0], /stderr payload/);
  });

  registerTest("triageQaInfrastructure resolves default review evidence path when omitted", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-discovery-"));
    const worktreeDir = join(temp, "wave", "goal-611-wave-2");
    const reviewDir = join(worktreeDir, ".hatch", "review");
    const discoveredEvidencePath = join(reviewDir, "630.json");
    const evidencePath = makeEvidenceFixture(temp, {
      issue_number: "630",
      branch: "wave/goal-611-wave-2",
      worktree_dir: worktreeDir,
      judge_context: { scenario: "qa/discovered" },
    });
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(discoveredEvidencePath, readFileSync(evidencePath, "utf8"), "utf8");

    const seen = [];
    const out = triageQaInfrastructure({
      repo: "recallnet/astrochicken",
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
    }, {
      cwd: worktreeDir,
      runNode: (args) => {
        seen.push(args);
        return {
          ok: true,
          code: 0,
          stdout: JSON.stringify({
            qa_rerun_ok: "true",
            qa_rerun_count: "1",
            qa_status: "pass",
            qa_command: "npm run test",
            qa_exit_code: "0",
            review_evidence_path: discoveredEvidencePath,
          }),
          stderr: "",
        };
      },
      issueComment: () => ({ ok: true }),
    });

    assert.equal(out.exit_code, 0);
    assert.equal(out.judge_context_scenario, "qa/discovered");
    assert.equal(out.review_evidence_path, discoveredEvidencePath);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][4], discoveredEvidencePath);
  });

  registerTest("triageQaInfrastructure falls back to persisted commands for judge_context evidence missing qa.command", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-missing-command-"));
    const fixturePath = resolve(testDir, "fixtures/milestone-postmortem/qa-infra-missing-command.json");
    const evidencePath = join(temp, "review.json");
    writeFileSync(evidencePath, readFileSync(fixturePath, "utf8"), "utf8");
    const comments = [];
    const nodeCalls = [];

    const out = triageQaInfrastructure({
      repo: "recallnet/astrochicken",
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
      reviewEvidencePath: evidencePath,
    }, {
      runNode: (args) => {
        nodeCalls.push(args);
        return {
          ok: true,
          code: 0,
          stdout: JSON.stringify({
            qa_rerun_ok: "true",
            qa_rerun_count: "1",
            qa_status: "pass",
            qa_command: "",
            qa_command_source: "review_evidence.review_qa_command",
            qa_exit_code: "0",
            review_evidence_path: evidencePath,
            review_evidence_error: "",
            qa_stdout_excerpt: "all good",
            qa_stderr_excerpt: "",
          }),
          stderr: "",
        };
      },
      issueComment: ({ body }) => {
        comments.push(body);
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    const fixture = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(out.exit_code, 0);
    assert.equal(out.qa_command, "npm run test -- --grep qa-infra");
    assert.equal(out.qa_command_source, "review_evidence.review_qa_command");
    assert.equal(fixture.judge_context?.scenario, "qa/review-evidence");
    assert.equal(fixture.judge_context?.scenario_selector, "astrochicken/post-merge/core");
    assert.deepEqual(fixture.judge_context?.scenario_basis?.scenario_ids, ["qa-review-evidence"]);
    assert.equal(fixture.judge_context?.scenario_basis?.selected_scenarios?.[0]?.scenario_id, "qa-review-evidence");
    assert.deepEqual(nodeCalls[0].slice(0, 4), [
      "packages/factory-ops/src/cli.ts",
      "wave-issue",
      "rerun-review-qa",
      "--review-evidence-path",
    ]);
    assert.equal(comments.length, 1);
    assert.match(comments[0], /Fallback command: `npm run test -- --grep qa-infra`/);
  });

  registerTest("triageQaInfrastructure files infra bug when qa.command is empty and no persisted fallback command exists", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-no-fallback-"));
    const evidencePath = makeEvidenceFixture(temp, {
      judge_context: {
        scenario: "qa/no-fallback",
      },
      review_qa_command: "",
      integration_command: "",
      qa: {
        status: "",
        command: "",
        exit_code: "",
      },
    });
    const comments = [];
    const analyzeCalls = [];

    const out = triageQaInfrastructure({
      repo: "recallnet/astrochicken",
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
      reviewEvidencePath: evidencePath,
    }, {
      runNode: () => ({
        ok: false,
        code: 2,
        stdout: JSON.stringify({
          qa_rerun_ok: "false",
          qa_rerun_count: "1",
          qa_status: "fail",
          qa_command: "",
          qa_command_source: "",
          qa_exit_code: "2",
          review_evidence_path: evidencePath,
          review_evidence_error: "",
          qa_stdout_excerpt: "",
          qa_stderr_excerpt: "QA command missing: provide review_qa_command or integration_command.",
        }),
        stderr: "[wave-issue] qa_rerun ok=false count=1 status=fail exit=2",
      }),
      issueComment: ({ body }) => {
        comments.push(body);
        return { ok: true, stdout: "", stderr: "" };
      },
      analyzeGiveUp: (args) => {
        analyzeCalls.push(args);
        return { classification: "qa_infrastructure", bug_filed: true, bug_url: "https://example.test/bug/no-fallback" };
      },
    });

    assert.equal(out.exit_code, 2);
    assert.equal(out.ok, false);
    assert.equal(out.qa_command, "");
    assert.equal(out.qa_command_source, "");
    assert.equal(out.bug_url, "https://example.test/bug/no-fallback");
    assert.equal(analyzeCalls.length, 1);
    assert.match(comments[0], /Missing qa.command triggered persisted fallback rerun before resolving triage\./);
    assert.match(comments[0], /Fallback command: `\(missing\)`/);
    assert.match(comments[0], /Fallback source: `\(missing\)`/);
    assert.match(comments[0], /QA command missing: provide review_qa_command or integration_command\./);
  });

  registerTest("triageQaInfrastructure resolves absolute repo path to owner/repo for GH calls", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-abs-repo-"));
    const repoDir = join(temp, "repo");
    mkdirSync(repoDir, { recursive: true });
    sh(["git", "init", "-b", "main"], repoDir);
    sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
    sh(["git", "config", "user.name", "Hatch"], repoDir);
    sh(["git", "remote", "add", "origin", "git@github.com:recallnet/astrochicken.git"], repoDir);

    const evidencePath = makeEvidenceFixture(temp, {
      worktree_dir: repoDir,
      judge_context: { scenario: "qa/abs-repo" },
      qa: {
        status: "fail",
        command: "",
        exit_code: 2,
      },
      review_qa_command: "npm run lint",
      integration_command: "npm test",
    });
    const commentCalls = [];
    const analyzeCalls = [];

    const out = triageQaInfrastructure({
      repo: repoDir,
      issueNumber: "630",
      branch: "wave/goal-611-wave-2",
      reviewEvidencePath: evidencePath,
    }, {
      runNode: () => ({
        ok: false,
        code: 2,
        stdout: JSON.stringify({
          qa_rerun_ok: "false",
          qa_rerun_count: "5",
          qa_status: "fail",
          qa_command: "",
          qa_command_source: "review_evidence.review_qa_command",
          qa_exit_code: "2",
          review_evidence_path: evidencePath,
          review_evidence_error: "",
          qa_stdout_excerpt: "stdout payload",
          qa_stderr_excerpt: "stderr payload",
        }),
        stderr: "",
      }),
      issueComment: ({ repo, issueNumber, body }) => {
        commentCalls.push({ repo, issueNumber, body });
        return { ok: true, stdout: "", stderr: "" };
      },
      analyzeGiveUp: (args) => {
        analyzeCalls.push(args);
        return { classification: "qa_infrastructure", bug_filed: true, bug_url: "https://example.test/bug/abs-repo" };
      },
    });

    assert.equal(out.exit_code, 2);
    assert.equal(out.repo, "recallnet/astrochicken");
    assert.equal(out.qa_command, "npm run lint");
    assert.equal(out.qa_command_source, "review_evidence.review_qa_command");
    assert.equal(commentCalls.length, 1);
    assert.equal(commentCalls[0].repo, "recallnet/astrochicken");
    assert.equal(commentCalls[0].issueNumber, "630");
    assert.match(commentCalls[0].body, /Fallback command: `npm run lint`/);
    assert.equal(analyzeCalls.length, 1);
    assert.equal(analyzeCalls[0].repo, "recallnet/astrochicken");
  });

  registerTest("milestone qa-infra-triage CLI returns exit 2 on rerun failure", () => {
    const temp = mkdtempSync(join(tmpdir(), "milestone-qa-infra-cli-"));
    const ghLog = join(temp, "gh.log");
    const nodeLog = join(temp, "node.log");
    const ghPath = join(temp, "gh");
    const nodePath = join(temp, "node");
    const evidencePath = makeEvidenceFixture(temp, {
      judge_context: { scenario: "qa/cli" },
    });

    writeFileSync(ghPath, `#!/bin/sh
  printf '%s\n' "$*" >> "${ghLog}"
  exit 0
  `, "utf8");
    chmodSync(ghPath, 0o755);

    writeFileSync(nodePath, `#!/bin/sh
  printf '%s\n' "$*" >> "${nodeLog}"
  if [ "$1" = "${opsCliPath}" ] && [ "$2" = "milestone" ] && [ "$3" = "qa-infra-triage" ]; then
    exec "${realNodePath}" "$@"
  fi
  printf '%s' '{"qa_rerun_ok":"false","qa_rerun_count":"4","qa_status":"fail","qa_command":"npm run test","qa_exit_code":"2","review_evidence_path":"${evidencePath}","review_evidence_error":"","qa_stdout_excerpt":"stdout excerpt","qa_stderr_excerpt":"stderr excerpt"}'
  printf '%s\n' '[wave-issue] qa_rerun ok=false count=4 status=fail exit=2' >&2
  exit 2
  `, "utf8");
    chmodSync(nodePath, 0o755);

    const run = spawnSync("node", [
      opsCliPath,
      "milestone",
      "qa-infra-triage",
      "--repo",
      "recallnet/astrochicken",
      "--issue",
      "630",
      "--branch",
      "wave/goal-611-wave-2",
      "--review-evidence-path",
      evidencePath,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${temp}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 2, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "{}");
    assert.equal(out.exit_code, 2);
    assert.equal(out.qa_rerun_count, "4");
    assert.equal(out.judge_context_scenario, "qa/cli");
    assert.match(run.stderr, /\[milestone\] qa_infra_triage ok=false issue=630 scenario=qa\/cli rerun_count=4/);

    const ghCalls = readFileSync(ghLog, "utf8");
    assert.match(ghCalls, /issue comment 630 --repo recallnet\/astrochicken --body QA infrastructure rerun still blocked:/);
    assert.match(ghCalls, /Stdout excerpt:/);
    assert.match(ghCalls, /Stderr excerpt:/);
    // analyzeGiveUp no longer files bugs, so no "Fast-tracked bug:" in comment
    assert.doesNotMatch(ghCalls, /Fast-tracked bug:/);

    const nodeCalls = readFileSync(nodeLog, "utf8");
    assert.match(nodeCalls, /packages\/factory-ops\/src\/cli.mjs wave-issue rerun-review-qa --review-evidence-path/);
  });
}
