import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";

import { readZeroDeltaStatus } from "../../src/commands/wave-issue-zero-delta-status.ts";

function makeTempDir() {
  const dir = join(tmpdir(), `zero-delta-test-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeZeroDeltaState(worktreeDir, issueNumber, data = {}) {
  const dir = join(worktreeDir, ".hatch", "wave-issue", "zero-delta");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${issueNumber}.json`);
  writeFileSync(filePath, JSON.stringify(data), "utf8");
  return filePath;
}

function writeReviewEvidence(worktreeDir, issueNumber, evidence = {}) {
  const dir = join(worktreeDir, ".hatch", "wave-issue", "review-evidence");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${issueNumber}.json`);
  writeFileSync(filePath, JSON.stringify(evidence), "utf8");
  return filePath;
}

describe("readZeroDeltaStatus", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("when zero-delta state file does not exist", () => {
    it("returns error zero_delta_state_not_found for a valid issue number", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "42",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "zero_delta_state_not_found");
      assert.equal(result.issue_number, "42");
      assert.ok(result.message.includes("42"));
      assert.ok(result.message.includes("not found"));
    });

    it("returns error when issueNumber is empty (statePath is empty)", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "zero_delta_state_not_found");
      assert.equal(result.issue_number, "");
      assert.ok(result.message.includes("(unknown issue)"));
      assert.ok(result.message.includes("(missing path)"));
    });

    it("returns default values for zero_delta fields", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "99",
      });
      assert.equal(result.zero_delta_retry, "false");
      assert.equal(result.zero_delta_retry_count, "0");
      assert.equal(result.zero_delta_detected, "false");
      assert.equal(result.commits_ahead, "0");
      assert.equal(result.issue_commits, "0");
    });

    it("preserves branch in result", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "10",
        branch: "wave/goal-10",
      });
      assert.equal(result.branch, "wave/goal-10");
    });
  });

  describe("when zero-delta state exists but review evidence is missing", () => {
    it("returns error review_evidence_not_found", () => {
      writeZeroDeltaState(tempDir, "55", {
        issue_number: "55",
        zero_delta_retry: "true",
        zero_delta_retry_count: "2",
      });
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "55",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "review_evidence_not_found");
      assert.equal(result.issue_number, "55");
      assert.ok(result.message.includes("Review evidence not found"));
    });

    it("populates retry state from the state file", () => {
      writeZeroDeltaState(tempDir, "77", {
        zero_delta_retry: "true",
        zero_delta_retry_count: "3",
      });
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "77",
      });
      assert.equal(result.zero_delta_retry, "true");
      assert.equal(result.zero_delta_retry_count, "3");
    });
  });

  describe("when both state and review evidence exist", () => {
    it("returns ok=true with valid evidence that has delta", () => {
      writeZeroDeltaState(tempDir, "100", {
        issue_number: "100",
        zero_delta_retry: "false",
        zero_delta_retry_count: "0",
      });
      const evidencePath = writeReviewEvidence(tempDir, "100", {
        issue_number: "100",
        worktree_dir: tempDir,
        branch: "wave/goal-100",
        commits_ahead: "3",
        issue_commits: "2",
        changed_files: ["a.ts", "b.ts"],
        issue_changed_files: ["a.ts"],
        snapshot_sha: "abc123",
      });
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "100",
        reviewEvidencePath: evidencePath,
        branch: "wave/goal-100",
      });
      assert.equal(result.ok, true);
      assert.equal(result.error, "");
      assert.equal(result.message, "ok");
      assert.equal(result.issue_number, "100");
      assert.equal(result.zero_delta_detected, "false");
      assert.equal(result.evidence_present, "true");
    });

    it("detects zero delta when no commits", () => {
      writeZeroDeltaState(tempDir, "200", {
        zero_delta_retry: "false",
        zero_delta_retry_count: "0",
      });
      const evidencePath = writeReviewEvidence(tempDir, "200", {
        issue_number: "200",
        worktree_dir: tempDir,
        branch: "wave/goal-200",
        commits_ahead: "0",
        issue_commits: "0",
        changed_files: [],
        issue_changed_files: [],
        snapshot_sha: "def456",
      });
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "200",
        reviewEvidencePath: evidencePath,
        branch: "wave/goal-200",
      });
      assert.equal(result.ok, true);
      assert.equal(result.error, "");
      assert.equal(result.zero_delta_detected, "true");
      assert.ok(result.review_notes.length > 0, "review notes should describe zero-delta");
    });
  });

  describe("when review evidence file is invalid", () => {
    it("returns validation error when evidence file has bad JSON", () => {
      writeZeroDeltaState(tempDir, "300", {});
      const dir = join(tempDir, ".hatch", "wave-issue", "review-evidence");
      mkdirSync(dir, { recursive: true });
      const evidencePath = join(dir, "300.json");
      writeFileSync(evidencePath, "NOT VALID JSON", "utf8");
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "300",
        reviewEvidencePath: evidencePath,
        branch: "wave/goal-300",
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.length > 0, "should have an error code");
    });

    it("returns validation error when evidence file is empty object", () => {
      writeZeroDeltaState(tempDir, "301", {});
      const evidencePath = writeReviewEvidence(tempDir, "301", {});
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "301",
        reviewEvidencePath: evidencePath,
      });
      // With empty evidence, commits_ahead/issue_commits default to 0 -> zero delta detected
      assert.equal(result.ok, true);
      assert.equal(result.zero_delta_detected, "true");
    });
  });

  describe("result structure", () => {
    it("has all expected keys in every result", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "999",
      });
      const expectedKeys = [
        "ok", "error", "message", "issue_number",
        "zero_delta_retry", "zero_delta_retry_count",
        "zero_delta_detected", "review_notes",
        "commits_ahead", "issue_commits",
        "evidence_path", "evidence_present", "evidence_source",
        "branch",
      ];
      for (const key of expectedKeys) {
        assert.ok(key in result, `result should have key "${key}"`);
      }
    });

    it("all string fields are strings, ok is boolean", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "999",
      });
      assert.equal(typeof result.ok, "boolean");
      assert.equal(typeof result.error, "string");
      assert.equal(typeof result.message, "string");
      assert.equal(typeof result.issue_number, "string");
      assert.equal(typeof result.zero_delta_retry, "string");
      assert.equal(typeof result.zero_delta_retry_count, "string");
      assert.equal(typeof result.zero_delta_detected, "string");
      assert.equal(typeof result.review_notes, "string");
      assert.equal(typeof result.commits_ahead, "string");
      assert.equal(typeof result.issue_commits, "string");
      assert.equal(typeof result.evidence_present, "string");
      assert.equal(typeof result.branch, "string");
    });
  });

  describe("called with no arguments", () => {
    it("returns error without throwing", () => {
      const result = readZeroDeltaStatus();
      assert.equal(result.ok, false);
      assert.equal(result.error, "zero_delta_state_not_found");
    });

    it("uses default empty values", () => {
      const result = readZeroDeltaStatus({});
      assert.equal(result.ok, false);
      assert.equal(result.issue_number, "");
      assert.equal(result.branch, "");
    });
  });

  describe("whitespace handling", () => {
    it("trims issueNumber", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "  42  ",
      });
      assert.equal(result.issue_number, "42");
    });

    it("trims branch", () => {
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "1",
        branch: "  wave/goal-1  ",
      });
      assert.equal(result.branch, "wave/goal-1");
    });
  });

  describe("reviewEvidencePath override", () => {
    it("uses explicit reviewEvidencePath over state-stored path", () => {
      writeZeroDeltaState(tempDir, "400", {
        review_evidence_path: "/some/old/path.json",
      });
      const evidencePath = writeReviewEvidence(tempDir, "400", {
        issue_number: "400",
        commits_ahead: "1",
        issue_commits: "1",
      });
      const result = readZeroDeltaStatus({
        worktreeDir: tempDir,
        issueNumber: "400",
        reviewEvidencePath: evidencePath,
      });
      assert.equal(result.evidence_present, "true");
      assert.equal(result.evidence_path, evidencePath);
    });
  });
});
