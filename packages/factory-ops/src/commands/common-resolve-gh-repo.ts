import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "../lib/error-catalog.ts";
import { resolveFactoryContext } from "../lib/factory-context-resolver.ts";
import { resolvePrimaryOpsRepo } from "../lib/factory-repo-identity.ts";

function resolveEnvRepo(env = process.env) {
  const targetKeys = [
    "HATCH_TARGET_REPO",
    "TARGET_REPO",
    "HATCH_GH_REPO",
    "GH_REPO",
    "MOTHERSHIP_REPO",
  ];
  for (const key of targetKeys) {
    const value = String(env?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function resolveGhRepo(raw = "", options = {}) {
  const explicit = String(raw || "").trim();
  if (explicit) return explicit;

  const env = options.env || process.env;
  const envRepo = resolveEnvRepo(env);
  if (envRepo) return envRepo;

  const context = resolveFactoryContext({
    factoryRoot: options.factoryRoot,
    factoryConfigPath: options.factoryConfigPath || options.configPath,
    factoryId: options.factoryId,
    targetRepo: options.targetRepo || options.repo,
    controlPlaneRepo: options.controlPlaneRepo,
    kindId: options.kindId,
    instanceId: options.instanceId,
    destinationsJson: options.destinationsJson,
    runsDir: options.runsDir,
    scenariosRoot: options.scenariosRoot,
    cwd: options.cwd,
    processEnv: env,
    requireTargetRepo: false,
  });

  const identity = resolvePrimaryOpsRepo({
    context,
    factoryId: context.factory_id,
    requireResolved: false,
  });

  const repo = String(identity.primary_repo || "").trim();
  if (repo) return repo;

  throw createFactoryOpsError(
    FACTORY_OPS_ERROR_CODES.gh_repo_required,
    "Unable to resolve GitHub repo: provide --repo, set HATCH_TARGET_REPO/MOTHERSHIP_REPO, set target_repo in .hatch/instance.json, or set target_repo in factory.config.json",
  );
}
