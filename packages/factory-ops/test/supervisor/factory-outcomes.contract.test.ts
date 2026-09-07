import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  collectFactoryOutcomes,
  parseCommitLog,
  parseCommitBodies,
  parseCombinedCommitLog,
  extractCommitReferences,
  extractBodyReferences,
} from "../../src/commands/factory-outcomes.ts";
import { buildGoalScopedMergeMessage } from "../../src/commands/merge-item-ops.ts";

test("collectFactoryOutcomes fails closed when repo is missing", () => {
  const out = collectFactoryOutcomes({ repo: "" });
  assert.equal(out.error, "missing_repo");
});

test("collectFactoryOutcomes extracts goals and issues from commit log without gh lookups", () => {
  const spawnSyncFn = (command, args) => {
    if (command === "git") {
      const argStr = args.join(" ");
      if (argStr.includes("rev-list")) {
        return { status: 0, stdout: "1\n", stderr: "" };
      }
      // Combined format: SHA\tsubject\tdate\0body\0
      return {
        status: 0,
        stdout: [
          "aaa111\tMerge branch 'wave/goal-100-wave-1'\t2026-03-08T23:00:00+00:00\0\0",
          "bbb222\tfeat: add Y (Closes #200)\t2026-03-08T22:00:00+00:00\0\0",
          "ccc333\tfix: bug Z (Closes #300)\t2026-03-08T21:00:00+00:00\0\0",
        ].join("\n"),
        stderr: "",
      };
    }
    // No gh calls should happen
    throw new Error("unexpected gh call");
  };

  const out = collectFactoryOutcomes({
    repo: "acme/test",
    repoPath: ".",
    lookbackHours: 24,
    nowMs: Date.parse("2026-03-09T00:00:00.000Z"),
    spawnSyncFn,
  });

  assert.equal(out.outcomes_degraded, false);
  assert.equal(out.gh_failures.length, 0);
  assert.equal(out.closed_goals, 1);
  assert.equal(out.goals[0].number, 100);
  assert.equal(out.goals[0].wave_key, "goal-100-wave-1");
  assert.equal(out.goals[0].url, "https://github.com/acme/test/issues/100");
  assert.equal(out.closed_features, 2);
  assert.equal(out.issues.length, 2);
  assert.equal(out.issues[0].number, 200);
  assert.equal(out.commits.length, 3);
  assert.ok(out.commit_log.includes("Merge branch"));
  assert.ok(out.commit_log.includes("Closes #200"));
});

test("collectFactoryOutcomes returns empty outcomes when no commits in window", () => {
  const spawnSyncFn = (command) => {
    if (command === "git") return { status: 0, stdout: "", stderr: "" };
    throw new Error("unexpected gh call");
  };

  const out = collectFactoryOutcomes({
    repo: "acme/test",
    repoPath: ".",
    lookbackHours: 1,
    nowMs: Date.parse("2026-03-09T00:00:00.000Z"),
    spawnSyncFn,
  });

  assert.equal(out.outcomes_degraded, false);
  assert.equal(out.closed_goals, 0);
  assert.equal(out.commits.length, 0);
  assert.equal(out.commit_log, "");
});

test("parseCommitLog handles tab-separated format with tabs in subject", () => {
  const raw = "abc123\tfeat: do\tthing\t2026-03-09T00:00:00+00:00\ndef456\tsimple\t2026-03-09T01:00:00+00:00";
  const commits = parseCommitLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, "abc123");
  assert.equal(commits[0].subject, "feat: do\tthing");
  assert.equal(commits[0].authored_at, "2026-03-09T00:00:00+00:00");
  assert.equal(commits[1].sha, "def456");
  assert.equal(commits[1].subject, "simple");
});

test("parseCommitBodies parses NUL-delimited SHA/body pairs", () => {
  const raw = "abc123\x00Fix the thing\nCloses #100\x00def456\x00\x00";
  const bodies = parseCommitBodies(raw);
  assert.equal(bodies.size, 2);
  assert.equal(bodies.get("abc123"), "Fix the thing\nCloses #100");
  assert.equal(bodies.get("def456"), "");
});

test("parseCombinedCommitLog extracts commits, bodies, and oneline text from combined format", () => {
  const raw = [
    "abc123\tMerge branch 'wave/goal-100-wave-1'\t2026-03-08T23:00:00+00:00\0\0",
    "def456\tfeat: add Y (Closes #200)\t2026-03-08T22:00:00+00:00\0Closes #301, #302\0",
  ].join("\n");
  const { commits, commitBodies, commitLogText } = parseCombinedCommitLog(raw);

  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, "abc123");
  assert.equal(commits[0].subject, "Merge branch 'wave/goal-100-wave-1'");
  assert.equal(commits[0].authored_at, "2026-03-08T23:00:00+00:00");
  assert.equal(commits[1].sha, "def456");

  assert.equal(commitBodies.size, 1, "only commits with non-empty body");
  assert.equal(commitBodies.get("def456"), "Closes #301, #302");

  assert.ok(commitLogText.includes("abc123"));
  assert.ok(commitLogText.includes("Merge branch"));
  assert.ok(commitLogText.includes("Closes #200"));
});

test("parseCombinedCommitLog returns empty results for empty input", () => {
  const { commits, commitBodies, commitLogText } = parseCombinedCommitLog("");
  assert.equal(commits.length, 0);
  assert.equal(commitBodies.size, 0);
  assert.equal(commitLogText, "");
});

test("extractBodyReferences finds Closes/Fixes/Resolves in commit bodies", () => {
  const bodies = new Map([
    ["abc", "Closes #100, #200"],
    ["def", "Fixes #300\nsome other text"],
    ["ghi", "no references here"],
  ]);
  const { issueNumbers } = extractBodyReferences(bodies);
  assert.deepEqual([...issueNumbers].sort(), [100, 200, 300]);
});

test("extractCommitReferences identifies goals from merge branches and issues from Closes", () => {
  const commits = [
    { sha: "a", subject: "Merge branch 'wave/goal-1731-wave-1'", authored_at: "" },
    { sha: "b", subject: "feat: add thing (Closes #1804)", authored_at: "" },
    { sha: "c", subject: "fix: stuff (Fixes #1805)", authored_at: "" },
    { sha: "d", subject: "Merge branch 'wave/goal-1731-wave-2'", authored_at: "" },
    { sha: "e", subject: "plain commit no refs", authored_at: "" },
  ];
  const { goalNumbers, goalWaveKeys, issueNumbers } = extractCommitReferences(commits);
  assert.deepEqual([...goalNumbers], [1731]);
  assert.deepEqual([...goalWaveKeys].sort(), ["goal-1731-wave-1", "goal-1731-wave-2"]);
  assert.deepEqual([...issueNumbers].sort(), [1804, 1805]);
});

test("extractCommitReferences identifies goals from feat(goal-NNN) merge subjects", () => {
  const commits = [
    { sha: "a", subject: "feat(goal-2321): goal-2321 (#2321)", authored_at: "" },
    { sha: "b", subject: "feat(goal-2238): goal-2238 (#2238)", authored_at: "" },
    { sha: "c", subject: "feat(goal-2322): goal-2322 (#2322)", authored_at: "" },
    { sha: "d", subject: "fix: bug (Closes #500)", authored_at: "" },
    { sha: "e", subject: "plain commit no refs", authored_at: "" },
  ];
  const { goalNumbers, issueNumbers } = extractCommitReferences(commits);
  assert.deepEqual([...goalNumbers].sort(), [2238, 2321, 2322]);
  assert.deepEqual([...issueNumbers].sort(), [500]);
});

test("extractCommitReferences detects goals from both old and new merge formats", () => {
  const commits = [
    { sha: "a", subject: "Merge branch 'wave/goal-100-wave-1'", authored_at: "" },
    { sha: "b", subject: "feat(goal-200): some goal (#200)", authored_at: "" },
    { sha: "c", subject: "fix(goal-300): fix something (#300)", authored_at: "" },
  ];
  const { goalNumbers } = extractCommitReferences(commits);
  assert.deepEqual([...goalNumbers].sort(), [100, 200, 300]);
});

test("collectFactoryOutcomes detects goals from feat(goal-NNN) merge commits", () => {
  const spawnSyncFn = (command, args) => {
    if (command === "git") {
      const argStr = args.join(" ");
      if (argStr.includes("rev-list")) {
        return { status: 0, stdout: "1\n", stderr: "" };
      }
      // Combined format: SHA\tsubject\tdate\0body\0
      return {
        status: 0,
        stdout: [
          "aaa111\tfeat(goal-2321): goal-2321 (#2321)\t2026-03-08T23:00:00+00:00\0\0",
          "bbb222\tfeat: add Y (Closes #200)\t2026-03-08T22:00:00+00:00\0\0",
        ].join("\n"),
        stderr: "",
      };
    }
    throw new Error("unexpected gh call");
  };

  const out = collectFactoryOutcomes({
    repo: "acme/test",
    repoPath: ".",
    lookbackHours: 24,
    nowMs: Date.parse("2026-03-09T00:00:00.000Z"),
    spawnSyncFn,
  });

  assert.equal(out.closed_goals, 1);
  assert.equal(out.goals[0].number, 2321);
  assert.equal(out.goals[0].url, "https://github.com/acme/test/issues/2321");
  assert.equal(out.closed_features, 1);
  assert.equal(out.issues[0].number, 200);
});

test("extractCommitReferences round-trips buildGoalScopedMergeMessage — contract", () => {
  const { merge_commit_message } = buildGoalScopedMergeMessage({
    goalIssueNumber: "2321",
    goalIssueTitle: "Build queryable factory insights",
    mergeCandidatesRaw: JSON.stringify([{ issue_number: "2393" }, { issue_number: "2394" }]),
  });
  assert.ok(merge_commit_message, "should produce a commit message");

  const subject = merge_commit_message.split("\n")[0];
  const commits = [{ sha: "abc123", subject, authored_at: "2026-03-19T00:00:00Z" }];
  const { goalNumbers } = extractCommitReferences(commits);
  assert.ok(goalNumbers.has(2321), `parser must detect goal 2321 from subject: ${subject}`);
});

test("extractCommitReferences round-trips buildGoalScopedMergeMessage with milestone fallback — contract", () => {
  const { merge_commit_message } = buildGoalScopedMergeMessage({
    milestoneTitle: "goal-500",
    goalIssueTitle: "Some milestone goal",
    mergeCandidatesRaw: "[]",
  });
  const subject = merge_commit_message.split("\n")[0];
  const commits = [{ sha: "def456", subject, authored_at: "" }];
  const { goalNumbers } = extractCommitReferences(commits);
  assert.ok(goalNumbers.has(500), `parser must detect goal 500 from milestone-derived subject: ${subject}`);
});

test("collectFactoryOutcomes extracts issues from Closes in commit bodies — contract", () => {
  // buildGoalScopedMergeMessage puts "Closes #NNN, #MMM" in the commit body.
  // collectFactoryOutcomes must parse bodies, not just subjects, to find these references.
  const { merge_commit_message } = buildGoalScopedMergeMessage({
    goalIssueNumber: "2321",
    goalIssueTitle: "Build queryable factory insights",
    mergeCandidatesRaw: JSON.stringify([{ issue_number: "2393" }, { issue_number: "2394" }]),
  });
  const subject = merge_commit_message.split("\n")[0];
  const body = merge_commit_message.split("\n").slice(2).join("\n"); // skip subject + blank line

  const spawnSyncFn = (command, args) => {
    if (command === "git") {
      const argStr = args.join(" ");
      if (argStr.includes("rev-list")) {
        return { status: 0, stdout: "1\n", stderr: "" };
      }
      // Combined format: SHA\tsubject\tdate\0body\0
      return {
        status: 0,
        stdout: `aaa111\t${subject}\t2026-03-08T23:00:00+00:00\x00${body}\x00`,
        stderr: "",
      };
    }
    throw new Error("unexpected gh call");
  };

  const out = collectFactoryOutcomes({
    repo: "acme/test",
    repoPath: ".",
    lookbackHours: 24,
    nowMs: Date.parse("2026-03-09T00:00:00.000Z"),
    spawnSyncFn,
  });

  assert.equal(out.closed_goals, 1, "goal from subject should be detected");
  assert.equal(out.goals[0].number, 2321);
  // The key assertion: issues from commit body's "Closes #2393, #2394" must appear
  assert.ok(out.issues.length >= 2, `should find at least 2 issues from body, got ${out.issues.length}: ${JSON.stringify(out.issues)}`);
  const issueNumbers = out.issues.map((i) => i.number).sort();
  assert.ok(issueNumbers.includes(2393), "issue 2393 from body Closes line must be detected");
  assert.ok(issueNumbers.includes(2394), "issue 2394 from body Closes line must be detected");
});

test("cli wires factory outcomes command", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(cmd, /static paths = \[\["factory", "outcomes"\]\]/);
  assert.match(cmd, /collectFactoryOutcomes/);
});
