import { readFileSync } from "node:fs";
import path, { dirname } from "node:path";

import { loadFactoryConfig } from "../../packages/factory-ops/src/commands/factory-config-loader.ts";
import { resolveFactoryContext } from "../../packages/factory-ops/src/lib/factory-context-resolver.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function normalizePath(value = "", { baseDir = process.cwd() } = {}) {
  const raw = trim(value);
  if (!raw) return "";
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readScenarioRootFromConfig(config = {}) {
  return trim(config?.scenarios_root)
    || trim(config?.scenario_root)
    || trim(config?.scenarios?.root);
}

function readSupervisorSkillPathFromConfig(config = {}) {
  return trim(config?.skills?.supervisor)
    || trim(config?.supervisor_skill)
    || trim(config?.skills_root);
}

function resolveConfigRelativeBase({ config = {}, configPath = "", factoryRoot = "", cwd = process.cwd() } = {}) {
  const configDir = dirname(configPath);
  const declaredFactoryRoot = trim(config?.factory_root);

  if (!declaredFactoryRoot || path.isAbsolute(declaredFactoryRoot)) {
    return configDir;
  }

  const candidateWorkspaceRoot = path.resolve(configDir, path.relative(declaredFactoryRoot, "."));
  const rebuiltFactoryRoot = normalizePath(path.resolve(candidateWorkspaceRoot, declaredFactoryRoot));
  const normalizedFactoryRoot = normalizePath(factoryRoot, { baseDir: cwd });

  if (!normalizedFactoryRoot || rebuiltFactoryRoot === normalizedFactoryRoot) {
    return candidateWorkspaceRoot;
  }

  return configDir;
}

function resolveConfiguredPath(value = "", { baseDir = process.cwd() } = {}) {
  const raw = trim(value);
  if (!raw) return "";
  return normalizePath(raw, { baseDir });
}

function splitRepo(value = "") {
  const repo = trim(value);
  const [owner = "", name = ""] = repo.split("/");
  return { repo, owner, name };
}

export const PORTABILITY_CONTEXTS = Object.freeze([
  Object.freeze({
    id: "mothership",
    factoryConfigPath: "factories/mothership/factory.config.json",
    scenarioSelector: "astrochicken/post-merge",
  }),
  Object.freeze({
    id: "example-trading",
    factoryConfigPath: "factories/example-trading/factory.config.json",
    scenarioSelector: "post-merge",
  }),
  Object.freeze({
    id: "external_fixture",
    factoryConfigPath: "scripts/test/fixtures/factory-portability/external/factory.config.json",
    scenarioSelector: "post-merge",
  }),
]);

export function buildTelemetryIdentityContract({ factoryId = "", targetRepo = "", controlPlaneRepo = "" } = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedTargetRepo = trim(targetRepo);
  const normalizedControlPlaneRepo = trim(controlPlaneRepo) || normalizedTargetRepo;
  return {
    factory_id: normalizedFactoryId,
    factory_tags: [
      `factory:${normalizedFactoryId || "unknown"}`,
      `target_repo:${normalizedTargetRepo || "unknown"}`,
      `control_plane_repo:${normalizedControlPlaneRepo || "unknown"}`,
    ],
    benchmark_identity: `${normalizedFactoryId}::${normalizedTargetRepo}::${normalizedControlPlaneRepo}`,
  };
}

export function resolvePortabilityContext(entry, { cwd = process.cwd() } = {}) {
  const factoryConfigPath = normalizePath(entry?.factoryConfigPath, { baseDir: cwd });
  const loaded = loadFactoryConfig({ configPath: factoryConfigPath, requiredKeys: [] });
  const config = loaded?.config || readJson(factoryConfigPath);
  const context = resolveFactoryContext({
    cwd,
    factoryConfigPath,
    requireTargetRepo: true,
  });

  const configRelativeBase = resolveConfigRelativeBase({
    config,
    configPath: factoryConfigPath,
    factoryRoot: context.factory_root,
    cwd,
  });

  const skillSupervisorPath = resolveConfiguredPath(readSupervisorSkillPathFromConfig(config), {
    baseDir: configRelativeBase,
  });

  const configuredScenarioRoot = resolveConfiguredPath(readScenarioRootFromConfig(config), {
    baseDir: configRelativeBase,
  });

  const scenarioSelector = trim(entry?.scenarioSelector || "post-merge");
  const runsDirExpected = path.resolve(cwd, ".hatch", context.factory_id, "runs");
  const target = splitRepo(context.target_repo);
  const controlPlane = splitRepo(context.control_plane_repo);

  return {
    id: trim(entry?.id),
    factoryConfigPath,
    factoryRoot: context.factory_root,
    factoryId: context.factory_id,
    targetRepo: context.target_repo,
    targetOwner: target.owner,
    targetName: target.name,
    controlPlaneRepo: context.control_plane_repo,
    controlPlaneOwner: controlPlane.owner,
    controlPlaneName: controlPlane.name,
    runsDir: context.runs_dir,
    runsDirExpected,
    scenariosRoot: context.scenarios_root,
    configuredScenarioRoot,
    scenarioSelector,
    scenarioSelectorRootPath: path.resolve(context.scenarios_root, scenarioSelector),
    skillSupervisorPath,
    telemetry: buildTelemetryIdentityContract({
      factoryId: context.factory_id,
      targetRepo: context.target_repo,
      controlPlaneRepo: context.control_plane_repo,
    }),
  };
}

export function resolvePortabilityMatrix({ cwd = process.cwd() } = {}) {
  return PORTABILITY_CONTEXTS.map((entry) => resolvePortabilityContext(entry, { cwd }));
}
