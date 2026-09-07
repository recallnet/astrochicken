import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkGoalAlreadyDecomposed,
  checkGoalAlreadyDecomposedFromGitHub,
  checkGoalAlreadyDecomposedWithPackets,
} from "../../src/commands/goal-check-decomposed.ts";
import { buildGoalDecompositionPacket, persistGoalDecompositionPacket } from "../../src/lib/goal-decomposition-packet.ts";

test("checkGoalAlreadyDecomposed returns true when open sub-issues exist", () => {
  const out = checkGoalAlreadyDecomposed({
    issueNumber: "1753",
    subIssues: [{ state: "open" }, { state: "closed" }],
  });
  assert.equal(out, "true");
});

test("checkGoalAlreadyDecomposed returns false with no sub-issues", () => {
  const out = checkGoalAlreadyDecomposed({
    issueNumber: "1753",
    subIssues: [],
  });
  assert.equal(out, "false");
});

test("checkGoalAlreadyDecomposed returns true when all sub-issues closed — prevents re-decomposition loop", () => {
  const out = checkGoalAlreadyDecomposed({
    issueNumber: "1753",
    subIssues: [{ state: "closed" }, { state: "closed" }],
  });
  assert.equal(out, "true",
    "goals with all-closed sub-issues must be treated as already decomposed to prevent unbounded re-decomposition");
});

test("checkGoalAlreadyDecomposedFromGitHub uses sub-issues via DI", () => {
  const out = checkGoalAlreadyDecomposedFromGitHub({
    repo: "o/r",
    issueNumber: "42",
    listSubIssuesFn: () => [{ state: "open" }],
  });
  assert.equal(out, "true");
});

test("checkGoalAlreadyDecomposedFromGitHub returns false when no sub-issues", () => {
  const out = checkGoalAlreadyDecomposedFromGitHub({
    repo: "o/r",
    issueNumber: "42",
    listSubIssuesFn: () => [],
  });
  assert.equal(out, "false");
});

test("checkGoalAlreadyDecomposedWithPackets prefers durable packet when present", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-check-decomposed-"));
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "1753",
    approvedFeaturesRaw: JSON.stringify([{ name: "Packet registry", summary: "Standardize packets" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/1754"]),
    factoryId: "mothership",
  });
  persistGoalDecompositionPacket({ repo, packet });
  const out = checkGoalAlreadyDecomposedWithPackets({
    repo: "",
    issueNumber: "1753",
    repoRoot: repo,
    factoryId: "mothership",
  });
  assert.equal(out, "true");
});

test("guardDuplicateGoalDecomposition throws when all sub-issues closed and no packet exists", async () => {
  const { guardDuplicateGoalDecomposition } = await import("../../src/commands/goal-duplicate-decompose-guard.ts");
  assert.throws(
    () => guardDuplicateGoalDecomposition({
      repo: "o/r",
      repoRoot: mkdtempSync(join(tmpdir(), "guard-dup-decompose-")),
      issueNumber: "1392",
      factoryId: "example-trading",
      listSubIssuesFn: () => [{ state: "closed" }, { state: "closed" }, { state: "closed" }],
    }),
    /goal_already_decomposed:1392/,
    "guard must throw for goals with all-closed sub-issues to prevent re-decomposition",
  );
});

test("guardDuplicateGoalDecomposition allows decomposition when no sub-issues and no packet", async () => {
  const { guardDuplicateGoalDecomposition } = await import("../../src/commands/goal-duplicate-decompose-guard.ts");
  const result = guardDuplicateGoalDecomposition({
    repo: "o/r",
    repoRoot: mkdtempSync(join(tmpdir(), "guard-dup-decompose-")),
    issueNumber: "9999",
    factoryId: "example-trading",
    listSubIssuesFn: () => [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.already_decomposed, "false");
});

test("checkGoalAlreadyDecomposedWithPackets stays true from packets when GitHub sub-issues are absent", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-check-decomposed-"));
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "2304",
    approvedFeaturesRaw: JSON.stringify([{ name: "Fail closed", summary: "Duplicate guard" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/2305"]),
    factoryId: "mothership",
  });
  persistGoalDecompositionPacket({ repo, packet });

  const out = checkGoalAlreadyDecomposedWithPackets({
    repo: "recallnet/astrochicken",
    issueNumber: "2304",
    repoRoot: repo,
    factoryId: "mothership",
    listSubIssuesFn: () => [],
  });
  assert.equal(out, "true");
});
