import { createMemoryFileReader } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { collectGitHistory } from "../../src/lib/analysis/collect-git-history.ts";
import { collectRunsArtifacts } from "../../src/lib/analysis/collect-runs-artifacts.ts";
import { collectSupervisorStatus } from "../../src/lib/analysis/collect-supervisor-status.ts";

const WINDOW_START = "2026-03-05T00:00:00.000Z";
const WINDOW_END = "2026-03-06T00:00:00.000Z";

test("collectGitHistory returns commits inside the analysis window", async () => {
  const gitLogFn = async ({ args }) => {
    if (args[0] === "log" && args.some((entry) => String(entry).startsWith("--since="))) {
      return [
        "abc123|2026-03-05T03:00:00.000Z|Dev One|feat: add collector",
        "def456|2026-03-04T03:00:00.000Z|Dev Two|chore: outside window",
      ].join("\n");
    }
    if (args[0] === "branch") {
      return ["main", "wave/stale", "wave/fresh"].join("\n");
    }
    if (args[0] === "log" && args[1] === "-1" && args[2] === "wave/stale") {
      return "2026-03-01T10:00:00.000Z";
    }
    if (args[0] === "log" && args[1] === "-1" && args[2] === "wave/fresh") {
      return "2026-03-05T12:00:00.000Z";
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };

  const payload = await collectGitHistory({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    repoPath: "/tmp/repo",
    gitLogFn,
  });

  assert.equal(payload.source, "git_history");
  assert.equal(payload.commits.length, 1);
  assert.equal(payload.commits[0].sha, "abc123");
  assert.equal(payload.stray_branches_count, 1);
  assert.equal(payload.stray_branches[0].branch, "wave/stale");
});

test("collectGitHistory ignores symbolic refs and default branches when counting stray branches", async () => {
  const queriedBranches = [];
  const gitLogFn = async ({ args }) => {
    if (args[0] === "log" && args.some((entry) => String(entry).startsWith("--since="))) {
      return "abc123|2026-03-05T03:00:00.000Z|Dev One|feat: add collector";
    }
    if (args[0] === "branch") {
      return [
        "* main",
        "  remotes/origin/HEAD -> origin/main",
        "  remotes/origin/main",
        "  remotes/upstream/master",
        "  wave/stale",
        "  remotes/origin/wave/remote-stale",
      ].join("\n");
    }
    if (args[0] === "log" && args[1] === "-1") {
      queriedBranches.push(args[2]);
      if (args[2] === "wave/stale") return "2026-03-01T10:00:00.000Z";
      if (args[2] === "remotes/origin/wave/remote-stale") return "2026-03-02T10:00:00.000Z";
      throw new Error(`unexpected branch query: ${args[2]}`);
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };

  const payload = await collectGitHistory({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    repoPath: "/tmp/repo",
    gitLogFn,
  });

  assert.equal(payload.missing_data.length, 0);
  assert.deepEqual(queriedBranches.sort(), ["remotes/origin/wave/remote-stale", "wave/stale"]);
  assert.equal(payload.stray_branches_count, 2);
  assert.deepEqual(payload.stray_branches.map((entry) => entry.branch).sort(), ["remotes/origin/wave/remote-stale", "wave/stale"]);
});

test("collectGitHistory strips linked-worktree branch markers before branch detail lookup", async () => {
  const queriedBranches = [];
  const gitLogFn = async ({ args }) => {
    if (args[0] === "log" && args.some((entry) => String(entry).startsWith("--since="))) {
      return "abc123|2026-03-05T03:00:00.000Z|Dev One|feat: add collector";
    }
    if (args[0] === "branch") {
      return [
        "+ codex/worktree-branch",
        "* main",
      ].join("\n");
    }
    if (args[0] === "log" && args[1] === "-1") {
      queriedBranches.push(args[2]);
      if (args[2] === "codex/worktree-branch") {
        return "2026-03-01T10:00:00.000Z";
      }
      throw new Error(`unexpected branch query: ${args[2]}`);
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };

  const payload = await collectGitHistory({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    repoPath: "/tmp/repo",
    gitLogFn,
  });

  assert.deepEqual(queriedBranches, ["codex/worktree-branch"]);
  assert.equal(payload.missing_data.length, 0);
  assert.equal(payload.stray_branches_count, 1);
  assert.equal(payload.stray_branches[0].branch, "codex/worktree-branch");
});

test("collectRunsArtifacts emits source_missing when runs directory is absent", async () => {
  const payload = await collectRunsArtifacts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runsDir: "/tmp/does-not-exist",
    readdirFn: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    readFileFn: async () => "",
  });

  assert.equal(payload.runs.length, 0);
  assert.equal(payload.missing_data.length, 1);
  assert.equal(payload.missing_data[0].reason, "source_missing");
  assert.match(payload.missing_data[0].detail, /\.hatch\/runs directory unavailable/);
});

test("collectRunsArtifacts reads run artifacts and reports guard incidents", async () => {
  const files = new Map([
    ["/runs/run-1/state.json", JSON.stringify({
      runId: "run-1",
      status: "running",
      pipelineFile: "graphs/factory_supervisor_tick.dot",
      currentNode: "execute_wave",
      startedAt: "2026-03-05T04:00:00.000Z",
      updatedAt: "2026-03-05T05:00:00.000Z",
      guard: { circuitState: "open", reasonCode: "guard_backoff_active" },
    })],
    ["/runs/run-1/alignment-summary.json", JSON.stringify({ status: "running" })],
    ["/runs/run-1/guard-events.jsonl", `${JSON.stringify({ kind: "guard.transition", data: { reason_code: "guard_backoff_active" } })}\n`],
  ]);

  const readdirFn = async (targetPath) => {
    if (targetPath === "/runs") return ["run-1"];
    if (targetPath === "/runs/run-1/guard") return ["decision-1.json"];
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  };

  const readFileFn = createMemoryFileReader(files);

  const payload = await collectRunsArtifacts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runsDir: "/runs",
    readdirFn,
    readFileFn,
  });

  assert.equal(payload.runs.length, 1);
  assert.equal(payload.runs[0].run_id, "run-1");
  assert.equal(payload.guard_incidents.length >= 1, true);
  assert.equal(payload.counts.guarded_runs, 1);
});

test("collectRunsArtifacts skips directories outside the analysis window using stat mtime pre-filter", async () => {
  const IN_WINDOW_MTIME = new Date("2026-03-05T04:00:00.000Z");
  const OLD_MTIME = new Date("2026-02-01T00:00:00.000Z");

  const files = new Map([
    ["/runs/recent-run/state.json", JSON.stringify({
      runId: "recent-run",
      status: "completed",
      pipelineFile: "graphs/test.dot",
      currentNode: "done",
      startedAt: "2026-03-05T04:00:00.000Z",
      updatedAt: "2026-03-05T05:00:00.000Z",
    })],
    ["/runs/old-run/state.json", JSON.stringify({
      runId: "old-run",
      status: "completed",
      startedAt: "2026-02-01T01:00:00.000Z",
      updatedAt: "2026-02-01T02:00:00.000Z",
    })],
  ]);

  const readCalls = [];

  const readdirFn = async (targetPath) => {
    if (targetPath === "/runs") return ["recent-run", "old-run", "detached-child"];
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  };

  const readFileFn = async (targetPath) => {
    readCalls.push(targetPath);
    if (!files.has(targetPath)) {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
    return files.get(targetPath);
  };

  const statFn = async (targetPath) => {
    if (targetPath === "/runs/recent-run") return { mtimeMs: IN_WINDOW_MTIME.getTime() };
    if (targetPath === "/runs/old-run") return { mtimeMs: OLD_MTIME.getTime() };
    if (targetPath === "/runs/detached-child") return { mtimeMs: OLD_MTIME.getTime() };
    throw new Error(`unexpected stat: ${targetPath}`);
  };

  const payload = await collectRunsArtifacts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runsDir: "/runs",
    readdirFn,
    readFileFn,
    statFn,
  });

  assert.equal(payload.runs.length, 1);
  assert.equal(payload.runs[0].run_id, "recent-run");

  // old-run and detached-child should have been skipped by mtime — no state.json read attempt
  const stateJsonReads = readCalls.filter((p) => p.includes("state.json"));
  assert.equal(stateJsonReads.length, 1, "should only read state.json for the recent run");
  assert.equal(stateJsonReads[0], "/runs/recent-run/state.json");

  // No missing_data noise from old runs or detached children
  const stateMissingEntries = (payload.missing_data || []).filter((entry) =>
    entry.detail === "run state file missing or invalid"
  );
  assert.equal(stateMissingEntries.length, 0, "should not report missing state for pre-filtered runs");
});

test("collectRunsArtifacts reports accurate total_runs scoped to mtime-eligible directories", async () => {
  const IN_WINDOW_MTIME = new Date("2026-03-05T04:00:00.000Z");
  const OLD_MTIME = new Date("2026-02-01T00:00:00.000Z");

  const files = new Map([
    ["/runs/run-a/state.json", JSON.stringify({
      runId: "run-a",
      status: "completed",
      startedAt: "2026-03-05T04:00:00.000Z",
      updatedAt: "2026-03-05T05:00:00.000Z",
    })],
    ["/runs/run-b/state.json", JSON.stringify({
      runId: "run-b",
      status: "completed",
      startedAt: "2026-03-05T06:00:00.000Z",
      updatedAt: "2026-03-05T07:00:00.000Z",
    })],
  ]);

  const readdirFn = async (targetPath) => {
    if (targetPath === "/runs") return ["run-a", "run-b", "ancient-1", "ancient-2", "ancient-3"];
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  };

  const readFileFn = createMemoryFileReader(files);

  const statFn = async (targetPath) => {
    if (targetPath.includes("run-a") || targetPath.includes("run-b")) return { mtimeMs: IN_WINDOW_MTIME.getTime() };
    return { mtimeMs: OLD_MTIME.getTime() };
  };

  const payload = await collectRunsArtifacts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runsDir: "/runs",
    readdirFn,
    readFileFn,
    statFn,
  });

  assert.equal(payload.counts.total_runs, 2, "total_runs should only count mtime-eligible dirs");
  assert.equal(payload.counts.runs_in_window, 2);
});

test("collectRunsArtifacts gracefully handles stat failures by including the directory", async () => {
  const files = new Map([
    ["/runs/run-x/state.json", JSON.stringify({
      runId: "run-x",
      status: "completed",
      startedAt: "2026-03-05T04:00:00.000Z",
      updatedAt: "2026-03-05T05:00:00.000Z",
    })],
  ]);

  const readdirFn = async (targetPath) => {
    if (targetPath === "/runs") return ["run-x"];
    const error = new Error("missing");
    error.code = "ENOENT";
    throw error;
  };

  const readFileFn = createMemoryFileReader(files);

  const statFn = async () => {
    throw new Error("permission denied");
  };

  const payload = await collectRunsArtifacts({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runsDir: "/runs",
    readdirFn,
    readFileFn,
    statFn,
  });

  // Should fall back to including the dir when stat fails
  assert.equal(payload.runs.length, 1);
  assert.equal(payload.runs[0].run_id, "run-x");
});

test("collectSupervisorStatus reports missing_data when CLI commands fail", async () => {
  const payload = await collectSupervisorStatus({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    execFileFn: async () => {
      throw new Error("command not found");
    },
  });

  assert.equal(payload.runs.length, 0);
  assert.equal(payload.ticks.length, 0);
  assert.equal(payload.missing_data.length, 2);
  assert.equal(payload.missing_data[0].reason, "source_missing");
  assert.equal(payload.missing_data[1].reason, "source_missing");
});

test("collectSupervisorStatus filters active runs and ticks to window using factory status/tick-status JSON shape", async () => {
  const seenCalls = [];
  const execFileFn = async (_command, args) => {
    seenCalls.push(args.join(" "));
    if (args[1] === "status") {
      return {
        stdout: JSON.stringify({
          active: [
            {
              id: "r1",
              status: "running",
              node: "n1",
              started_at: "2026-03-05T05:50:00.000Z",
              updated_at: "2026-03-05T06:00:00.000Z",
            },
            {
              id: "r2",
              status: "completed",
              node: "n2",
              updated_at: "2026-03-08T06:00:00.000Z",
            },
          ],
          completed: 12,
          failed: 3,
        }),
      };
    }
    return {
      stdout: JSON.stringify({
        ticks: [
          {
            id: "t1",
            status: "running",
            stage: "wave_execute",
            startedAt: "2026-03-05T06:10:00.000Z",
          },
          {
            id: "t2",
            status: "completed",
            stage: "done",
            startedAt: "2026-03-08T06:10:00.000Z",
          },
        ],
      }),
    };
  };

  const payload = await collectSupervisorStatus({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    execFileFn,
  });

  assert.equal(payload.runs.length, 1);
  assert.equal(payload.ticks.length, 1);
  assert.equal(payload.runs[0].run_id, "r1");
  assert.equal(payload.ticks[0].run_id, "t1");
  assert.deepEqual(seenCalls, [
    "factory status --json",
    "factory tick-status --json",
  ]);
});
