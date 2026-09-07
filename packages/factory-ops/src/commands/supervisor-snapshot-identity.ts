import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveSupervisorGhJsonFn } from "./supervisor-backend-query-seams.ts";
import { resolveManagedRecoverySweepScope } from "./supervisor-ownership-routing.ts";
import {
  resolveFactoryControlPlaneRepo,
  loadFactoryConfig,
} from "./supervisor-state-collector.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";
import { resolvePrimaryOpsRepo } from "../lib/factory-repo-identity.ts";
import { resolveRunsDir } from "../lib/runs-dir-resolver.ts";

export function resolveSnapshotIdentity({
  repo,
  factoryId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  factoryRoot = "",
  factoryConfigPath = "",
  factoryConfig = null,
  ghJsonFn,
  backendAdapter,
  runsDir = ".hatch/runs",
  snapshotErrors = [],
} = {}) {
  let config = factoryConfig && typeof factoryConfig === "object" ? factoryConfig : null;
  if (!config) {
    try {
      config = loadFactoryConfig({
        factoryRoot,
        configPath: factoryConfigPath,
        requiredKeys: ["factory_id", "control_plane_repo"],
      }).config;
    } catch (error) {
      const configError = String(error?.message || error || "factory_config_load_failed").replace(/\s+/g, " ").trim();
      if (!trim(repo) || !trim(factoryId) || !trim(targetRepo) || !trim(controlPlaneRepo)) {
        snapshotErrors.push(`factory_config_unavailable:${configError}`);
      }
      config = null;
    }
  }

  let configFactoryId = "";
  let configTargetRepo = "";
  let configControlPlaneRepo = "";
  if (config) {
    configFactoryId = trim(config?.factory_id || "");
    configTargetRepo = trim(config?.target_repo || "");
    try { configControlPlaneRepo = resolveFactoryControlPlaneRepo(config); } catch {}
  }

  const normalizedFactoryId = trim(factoryId) || configFactoryId || "factory_supervisor";
  let repoIdentity;
  try {
    repoIdentity = resolvePrimaryOpsRepo({
      context: {
        factory_id: normalizedFactoryId,
        target_repo: trim(targetRepo) || configTargetRepo || trim(repo),
      },
      factoryId: normalizedFactoryId,
      requireResolved: false,
    });
  } catch {
    repoIdentity = {
      target_repo: trim(targetRepo) || configTargetRepo || trim(repo),
    };
  }

  const normalizedTargetRepo = trim(repoIdentity.target_repo || trim(repo) || configTargetRepo);
  if (!normalizedTargetRepo) return { error: "missing_repo" };
  const normalizedRepo = trim(repo) || normalizedTargetRepo;
  const normalizedControlPlaneRepo = trim(controlPlaneRepo) || configControlPlaneRepo || normalizedTargetRepo;
  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId: normalizedFactoryId });
  const resolvedGhJsonFn = resolveSupervisorGhJsonFn({ ghJsonFn, backendAdapter, repo: normalizedRepo });
  const recoverySweepScope = resolveManagedRecoverySweepScope({ config });
  const judgeContextScopeIdentity = `${normalizedFactoryId}::${normalizedTargetRepo}::${normalizedControlPlaneRepo}`;

  return {
    normalizedFactoryId,
    normalizedTargetRepo,
    normalizedRepo,
    normalizedControlPlaneRepo,
    resolvedRunsDir,
    ghJsonFn: resolvedGhJsonFn,
    recoverySweepScope,
    judgeContextScopeIdentity,
    config,
  };
}

export function collectStaleTelemetry({ resolvedRunsDir } = {}) {
  const staleTelemetry = [];
  try {
    const runIds = readdirSync(resolvedRunsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const runId of runIds) {
      const statePath = join(resolvedRunsDir, runId, "state.json");
      let state;
      try {
        state = parseJson(readFileSync(statePath, "utf8"), null);
      } catch {
        continue;
      }
      const ctx = state?.context || {};
      const raw = ctx.stalled_wave_telemetry || ctx.stalledWaveTelemetry || "";
      if (!raw) continue;
      const parsed = typeof raw === "string" ? parseJson(raw, null) : raw;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const waveIssue = Number(item?.wave_issue_number || 0);
        if (!Number.isFinite(waveIssue) || waveIssue <= 0) continue;
        staleTelemetry.push(item);
      }
    }
  } catch {
    // ignore missing runs dir
  }
  return staleTelemetry;
}
