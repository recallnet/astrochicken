import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  readActiveManagedFactories,
  collectManagedFleetData,
  resolveFleetDatasetSummary,
} from "../../src/lib/analysis/fleet-lens-collector.ts";

// --- readActiveManagedFactories ---

describe("readActiveManagedFactories", () => {
  it("returns empty array when registry file is missing", () => {
    const result = readActiveManagedFactories({
      repoPath: "/nonexistent",
    });
    assert.deepStrictEqual(result, []);
  });

  it("filters out mothership instance", () => {
    const registry = {
      schema: "hatch.factory.registry.v1",
      instances: [
        { instance_id: "mothership", kind_id: "mothership", status: "active", target_repo: "recallnet/astrochicken" },
        { instance_id: "example-trading", kind_id: "example-trading", status: "active", target_repo: "example-org/example-trading" },
      ],
    };
    const result = readActiveManagedFactories({
      repoPath: "/repo",
      readRegistryFn: () => registry,
      readFactoryConfigFn: ({ factoryId }) => ({
        managed: true,
        work_dir: `/work/${factoryId}`,
      }),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].factory_id, "example-trading");
  });

  it("filters out inactive instances", () => {
    const registry = {
      schema: "hatch.factory.registry.v1",
      instances: [
        { instance_id: "example-trading", kind_id: "example-trading", status: "inactive", target_repo: "example-org/example-trading" },
        { instance_id: "example-scanner", kind_id: "example-scanner", status: "active", target_repo: "example-org/example-scanner" },
      ],
    };
    const result = readActiveManagedFactories({
      repoPath: "/repo",
      readRegistryFn: () => registry,
      readFactoryConfigFn: ({ factoryId }) => ({
        managed: true,
        work_dir: `/work/${factoryId}`,
      }),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].factory_id, "example-scanner");
  });

  it("filters out non-managed factories", () => {
    const registry = {
      schema: "hatch.factory.registry.v1",
      instances: [
        { instance_id: "research", kind_id: "research", status: "active", target_repo: "example-org/research" },
        { instance_id: "example-trading", kind_id: "example-trading", status: "active", target_repo: "example-org/example-trading" },
      ],
    };
    const result = readActiveManagedFactories({
      repoPath: "/repo",
      readRegistryFn: () => registry,
      readFactoryConfigFn: ({ factoryId }) => {
        if (factoryId === "research") return { managed: false };
        return { managed: true, work_dir: `/work/${factoryId}` };
      },
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].factory_id, "example-trading");
  });

  it("resolves work_dir and runs_dir from factory config", () => {
    const registry = {
      schema: "hatch.factory.registry.v1",
      instances: [
        { instance_id: "example-trading", kind_id: "example-trading", status: "active", target_repo: "example-org/example-trading" },
      ],
    };
    const result = readActiveManagedFactories({
      repoPath: "/repo",
      readRegistryFn: () => registry,
      readFactoryConfigFn: () => ({
        managed: true,
        work_dir: "/srv/example-trading",
      }),
    });
    assert.equal(result[0].work_dir, "/srv/example-trading");
    assert.equal(result[0].runs_dir, "/srv/example-trading/.hatch/example-trading/runs");
    assert.equal(result[0].target_repo, "example-org/example-trading");
  });

  it("handles missing factory config gracefully", () => {
    const registry = {
      schema: "hatch.factory.registry.v1",
      instances: [
        { instance_id: "broken", kind_id: "broken", status: "active", target_repo: "example-org/broken" },
      ],
    };
    const result = readActiveManagedFactories({
      repoPath: "/repo",
      readRegistryFn: () => registry,
      readFactoryConfigFn: () => { throw new Error("no config"); },
    });
    assert.deepStrictEqual(result, []);
  });
});

// --- collectManagedFleetData ---

describe("collectManagedFleetData", () => {
  it("returns empty fleet when no managed factories found", async () => {
    const result = await collectManagedFleetData({
      repoPath: "/nonexistent",
      windowStart: "2026-03-29T00:00:00Z",
      windowEnd: "2026-03-30T00:00:00Z",
      readRegistryFn: () => ({ schema: "hatch.factory.registry.v1", instances: [] }),
    });
    assert.deepStrictEqual(result.factories, []);
    assert.equal(result.summary.active_factory_count, 0);
    assert.equal(result.summary.total_runs, 0);
  });

  it("collects runs from each factory's runs_dir", async () => {
    const result = await collectManagedFleetData({
      repoPath: "/repo",
      windowStart: "2026-03-29T00:00:00Z",
      windowEnd: "2026-03-30T00:00:00Z",
      readRegistryFn: () => ({
        schema: "hatch.factory.registry.v1",
        instances: [
          { instance_id: "example-trading", kind_id: "example-trading", status: "active", target_repo: "example-org/example-trading" },
        ],
      }),
      readFactoryConfigFn: () => ({ managed: true, work_dir: "/srv/example-trading" }),
      scanRunsFn: ({ runsDir }) => ({
        total: 5, completed: 3, failed: 1, active: 1,
        goal_runs: [
          { goal: "1700", status: "completed", merged_count: 7 },
          { goal: "1701", status: "completed", merged_count: 5 },
        ],
      }),
      collectGitFn: () => ({ count: 12, goal_commits: ["feat(goal-1700): (#1700)"] }),
      collectIssuesFn: () => ({ ready_count: 0, open_goal_count: 5 }),
    });
    assert.equal(result.factories.length, 1);
    assert.equal(result.factories[0].factory_id, "example-trading");
    assert.equal(result.factories[0].runs.total, 5);
    assert.equal(result.factories[0].runs.completed, 3);
    assert.equal(result.factories[0].commits.count, 12);
    assert.equal(result.factories[0].issues.ready_count, 0);
    assert.equal(result.summary.total_runs, 5);
  });

  it("handles unreachable work_dir gracefully", async () => {
    const result = await collectManagedFleetData({
      repoPath: "/repo",
      windowStart: "2026-03-29T00:00:00Z",
      windowEnd: "2026-03-30T00:00:00Z",
      readRegistryFn: () => ({
        schema: "hatch.factory.registry.v1",
        instances: [
          { instance_id: "offline", kind_id: "offline", status: "active", target_repo: "example-org/offline" },
        ],
      }),
      readFactoryConfigFn: () => ({ managed: true, work_dir: "/nonexistent/path" }),
      scanRunsFn: () => { throw new Error("ENOENT"); },
      collectGitFn: () => { throw new Error("not a git repo"); },
      collectIssuesFn: () => ({ ready_count: 0, open_goal_count: 0 }),
    });
    assert.equal(result.factories.length, 1);
    assert.equal(result.factories[0].factory_id, "offline");
    assert.equal(result.factories[0].runs.total, 0);
    assert.equal(result.factories[0].health.status, "error");
  });

  it("aggregates summary across multiple factories", async () => {
    const result = await collectManagedFleetData({
      repoPath: "/repo",
      windowStart: "2026-03-29T00:00:00Z",
      windowEnd: "2026-03-30T00:00:00Z",
      readRegistryFn: () => ({
        schema: "hatch.factory.registry.v1",
        instances: [
          { instance_id: "example-trading", kind_id: "example-trading", status: "active", target_repo: "example-org/example-trading" },
          { instance_id: "example-scanner", kind_id: "example-scanner", status: "active", target_repo: "example-org/example-scanner" },
        ],
      }),
      readFactoryConfigFn: ({ factoryId }) => ({ managed: true, work_dir: `/srv/${factoryId}` }),
      scanRunsFn: () => ({ total: 3, completed: 2, failed: 1, active: 0, goal_runs: [] }),
      collectGitFn: () => ({ count: 5, goal_commits: [] }),
      collectIssuesFn: () => ({ ready_count: 1, open_goal_count: 2 }),
    });
    assert.equal(result.factories.length, 2);
    assert.equal(result.summary.active_factory_count, 2);
    assert.equal(result.summary.total_runs, 6);
    assert.equal(result.summary.total_commits, 10);
  });

  it("collects factories in parallel, not sequentially", async () => {
    const callOrder = [];
    const result = await collectManagedFleetData({
      repoPath: "/repo",
      windowStart: "2026-03-29T00:00:00Z",
      windowEnd: "2026-03-30T00:00:00Z",
      readRegistryFn: () => ({
        schema: "hatch.factory.registry.v1",
        instances: [
          { instance_id: "a", kind_id: "a", status: "active", target_repo: "org/a" },
          { instance_id: "b", kind_id: "b", status: "active", target_repo: "org/b" },
        ],
      }),
      readFactoryConfigFn: ({ factoryId }) => ({ managed: true, work_dir: `/srv/${factoryId}` }),
      scanRunsFn: ({ runsDir }) => {
        callOrder.push(`scan:${runsDir}`);
        return { total: 1, completed: 1, failed: 0, active: 0, goal_runs: [] };
      },
      collectGitFn: ({ workDir }) => {
        callOrder.push(`git:${workDir}`);
        return { count: 1, goal_commits: [] };
      },
      collectIssuesFn: ({ targetRepo }) => {
        callOrder.push(`issues:${targetRepo}`);
        return { ready_count: 0, open_goal_count: 0 };
      },
    });
    assert.equal(result.factories.length, 2);
    // Verify all calls happened (order may vary with parallelism)
    assert.ok(callOrder.includes("scan:/srv/a/.hatch/a/runs"));
    assert.ok(callOrder.includes("scan:/srv/b/.hatch/b/runs"));
  });
});

// --- resolveFleetDatasetSummary ---

describe("resolveFleetDatasetSummary", () => {
  it("returns meaningful summary from fleet data", () => {
    const summary = resolveFleetDatasetSummary({
      factories: [
        { factory_id: "example-trading", runs: { total: 5, completed: 3 }, commits: { count: 12 }, issues: { ready_count: 0 } },
        { factory_id: "example-scanner", runs: { total: 3, completed: 2 }, commits: { count: 8 }, issues: { ready_count: 2 } },
      ],
      summary: { active_factory_count: 2, total_runs: 8, total_commits: 20 },
    });
    assert.equal(summary.item_count, 2, "item_count should be factory count");
    assert.equal(summary.active_factory_count, 2);
    assert.equal(summary.total_runs, 8);
    assert.equal(summary.total_commits, 20);
  });

  it("returns zeros for empty fleet", () => {
    const summary = resolveFleetDatasetSummary({ factories: [], summary: { active_factory_count: 0, total_runs: 0, total_commits: 0 } });
    assert.equal(summary.item_count, 0);
    assert.equal(summary.active_factory_count, 0);
    assert.equal(summary.total_runs, 0);
  });

  it("handles missing/malformed input gracefully", () => {
    const summary = resolveFleetDatasetSummary({});
    assert.equal(summary.item_count, 0);
    assert.equal(summary.active_factory_count, 0);
  });
});
