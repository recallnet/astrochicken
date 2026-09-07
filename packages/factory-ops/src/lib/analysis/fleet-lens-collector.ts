import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { createGhCliAdapter } from "@hatch/github-adapter";

const REGISTRY_FILENAME = "factory-registry.json";
const EXCLUDED_INSTANCE_IDS = new Set(["mothership"]);

function defaultReadRegistry(repoPath) {
  const registryPath = resolve(repoPath, REGISTRY_FILENAME);
  if (!existsSync(registryPath)) return null;
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

function defaultReadFactoryConfig({ repoPath, factoryId }) {
  const configPath = resolve(repoPath, "factories", factoryId, "factory.config.json");
  return JSON.parse(readFileSync(configPath, "utf8"));
}

/**
 * Enumerate active managed factory instances from the factory registry.
 * Returns resolved contexts with work_dir, runs_dir, and target_repo.
 */
export function readActiveManagedFactories({
  repoPath = "",
  readRegistryFn = defaultReadRegistry,
  readFactoryConfigFn = defaultReadFactoryConfig,
} = {}) {
  let registry;
  try {
    registry = readRegistryFn(repoPath);
  } catch {
    return [];
  }
  if (!registry || !Array.isArray(registry.instances)) return [];

  const results = [];
  for (const instance of registry.instances) {
    const id = String(instance.instance_id || "").trim();
    if (!id) continue;
    if (EXCLUDED_INSTANCE_IDS.has(id)) continue;
    if (String(instance.status || "").toLowerCase() !== "active") continue;

    let config;
    try {
      config = readFactoryConfigFn({ repoPath, factoryId: id });
    } catch {
      continue;
    }
    if (!config || config.managed !== true) continue;

    const workDir = String(config.work_dir || "").trim();
    if (!workDir) continue;

    results.push({
      factory_id: id,
      target_repo: String(instance.target_repo || "").trim(),
      work_dir: workDir,
      runs_dir: join(workDir, `.hatch/${id}/runs`),
    });
  }

  return results;
}

// --- Per-factory data collectors (with injectable fns for testing) ---

function defaultScanRuns({ runsDir, windowStart, windowEnd }) {
  if (!existsSync(runsDir)) return { total: 0, completed: 0, failed: 0, active: 0, goal_runs: [] };

  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  let total = 0, completed = 0, failed = 0, active = 0;
  const goalRuns = [];

  for (const entry of readdirSync(runsDir)) {
    const runDir = join(runsDir, entry);
    try {
      const stat = statSync(runDir);
      if (!stat.isDirectory()) continue;
      if (stat.mtimeMs < startMs || stat.mtimeMs > endMs) continue;
    } catch { continue; }

    total++;
    const checkpointPath = join(runDir, "run-checkpoint.json");
    try {
      const cp = JSON.parse(readFileSync(checkpointPath, "utf8"));
      const status = String(cp.status || "").toLowerCase();
      if (status === "completed") completed++;
      else if (status === "failed") failed++;
      else active++;

      // Check if this is a goal execution run
      const goalNumber = cp.context?.goal_issue_number || cp.context?.goal_issue || "";
      if (goalNumber && cp.pipelineFile?.includes("goal_execute")) {
        goalRuns.push({
          goal: String(goalNumber),
          status,
          merged_count: Number(cp.context?.merged_count || 0),
        });
      }
    } catch {
      active++;
    }
  }

  return { total, completed, failed, active, goal_runs: goalRuns };
}

function defaultCollectGit({ workDir, windowStart, windowEnd }) {
  try {
    const log = execFileSync("git", [
      "-C", workDir, "log", "--oneline",
      `--since=${windowStart}`, `--until=${windowEnd}`,
    ], { encoding: "utf8", timeout: 10_000 });
    const lines = log.trim().split("\n").filter(Boolean);
    const goalCommits = lines.filter((l) => /goal-\d+/.test(l));
    return { count: lines.length, goal_commits: goalCommits };
  } catch {
    return { count: 0, goal_commits: [] };
  }
}

function defaultCollectIssues({ targetRepo }) {
  try {
    // @context:integration Fleet lens reads issue state through github-adapter
    // ownership to avoid cli-helpers gh transport boundary violations.
    const adapter = createGhCliAdapter({ repo: targetRepo });
    const readyIssues = adapter.issueList({ state: "open", labels: ["ready"], limit: 100, fields: "number" });
    const goalIssues = adapter.issueList({ state: "open", labels: ["goal"], limit: 100, fields: "number" });
    return {
      ready_count: Array.isArray(readyIssues) ? readyIssues.length : 0,
      open_goal_count: Array.isArray(goalIssues) ? goalIssues.length : 0,
    };
  } catch {
    return { ready_count: 0, open_goal_count: 0 };
  }
}

/**
 * Collect fleet-wide data from all active managed factories.
 * Returns per-factory summaries and an aggregate summary.
 */
export async function collectManagedFleetData({
  repoPath = "",
  windowStart = "",
  windowEnd = "",
  readRegistryFn = defaultReadRegistry,
  readFactoryConfigFn = defaultReadFactoryConfig,
  scanRunsFn = defaultScanRuns,
  collectGitFn = defaultCollectGit,
  collectIssuesFn = defaultCollectIssues,
} = {}) {
  const managedFactories = readActiveManagedFactories({
    repoPath,
    readRegistryFn,
    readFactoryConfigFn,
  });

  const factories = await Promise.all(managedFactories.map(async (factory) => {
    let runs = { total: 0, completed: 0, failed: 0, active: 0, goal_runs: [] };
    let commits = { count: 0, goal_commits: [] };
    let healthStatus = "ok";

    try {
      runs = scanRunsFn({ runsDir: factory.runs_dir, windowStart, windowEnd });
    } catch {
      healthStatus = "error";
    }

    try {
      commits = collectGitFn({ workDir: factory.work_dir, windowStart, windowEnd });
    } catch {
      healthStatus = "error";
    }

    let issues = { ready_count: 0, open_goal_count: 0 };
    try {
      issues = collectIssuesFn({ targetRepo: factory.target_repo });
    } catch {
      // issues are non-critical
    }

    return {
      factory_id: factory.factory_id,
      target_repo: factory.target_repo,
      work_dir: factory.work_dir,
      runs,
      commits,
      issues,
      health: { status: healthStatus },
    };
  }));

  let totalRuns = 0;
  let totalCommits = 0;
  for (const f of factories) {
    totalRuns += f.runs.total;
    totalCommits += f.commits.count;
  }

  return {
    factories,
    summary: {
      active_factory_count: factories.length,
      total_runs: totalRuns,
      total_commits: totalCommits,
    },
  };
}

/**
 * Produce a manifest-compatible summary for the managed_fleet dataset.
 * Used by lens-manifest.mjs to generate meaningful metadata instead of
 * the generic default (which just counts object keys).
 */
export function resolveFleetDatasetSummary(payload = {}) {
  const factories = Array.isArray(payload?.factories) ? payload.factories : [];
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};
  return {
    item_count: factories.length,
    active_factory_count: Number(summary.active_factory_count || 0),
    total_runs: Number(summary.total_runs || 0),
    total_commits: Number(summary.total_commits || 0),
  };
}
