import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classifyPathWithManifestEntries, loadActiveSurfaceManifest } from "./active-surface-manifest.ts";
import { loadSurface, readText as readCapabilityText } from "./capability-contract.ts";
import {
  renderFactoryCompositionRegistryMarkdown,
  stringifyFactoryCompositionManifestDocument,
} from "../../packages/factory-core/src/factory-composition-registry.ts";

export const FACTORY_COMPOSITION_REGISTRY_JSON_PATH = "docs/contracts/factory-composition-registry.json";
export const FACTORY_COMPOSITION_REGISTRY_MARKDOWN_PATH = "docs/contracts/factory-composition-registry.md";

function stableOrder(value) {
  if (Array.isArray(value)) return value.map((entry) => stableOrder(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableOrder(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableOrder(value), null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readJson(repoRoot, relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function listFactoryConfigPaths(repoRoot) {
  const factoriesRoot = path.join(repoRoot, "factories");
  return sortStrings(
    readdirSync(factoriesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => `factories/${entry.name}/factory.config.json`)
      .filter((relativePath) => existsSync(path.join(repoRoot, relativePath))),
  );
}

function flattenKeys(prefix, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const keys = [];
  for (const [key, nested] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedKeys = flattenKeys(current, nested);
      if (nestedKeys.length === 0) keys.push(current);
      else keys.push(...nestedKeys);
    } else {
      keys.push(current);
    }
  }
  return keys;
}

function capabilityPackageForGraphPath(graphPath) {
  const match = /^packages\/([^/]+)\//.exec(graphPath);
  return match ? `@hatch/${match[1]}` : null;
}

function classifyGraphRole(graphPath, config, graphId, governedCapabilityGraphs = new Map()) {
  if (graphPath === config.dispatch?.graph) return "dispatch";
  if (graphPath === config.pipeline?.supervisor_tick) return "supervisor";
  if ((config.schedules?.jobs || []).some((job) => job.graph === graphPath)) return "schedule";
  if (governedCapabilityGraphs.has(graphPath)) return "capability_binding";
  if (graphId && graphId.startsWith("domain_")) return "domain_policy";
  return "domain_policy";
}

function manifestPathFor(factoryId) {
  return `factories/${factoryId}/inventory/factory-composition-manifest.v1.json`;
}

function listCapabilityPackageRoots(repoRoot) {
  const packagesRoot = path.join(repoRoot, "packages");
  if (!existsSync(packagesRoot)) return [];
  return sortStrings(
    readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("capability-"))
      .map((entry) => `packages/${entry.name}`)
      .filter((relativePath) => existsSync(path.join(repoRoot, relativePath, "package.json"))),
  );
}

async function loadGovernedCapabilityGraphs(repoRoot) {
  const governedCapabilityGraphs = new Map();
  const activeSurfaceManifest = loadActiveSurfaceManifest({ repoRoot });

  for (const packageRoot of listCapabilityPackageRoots(repoRoot)) {
    const packageJsonPath = path.join(repoRoot, packageRoot, "package.json");
    const packageJson = JSON.parse(readCapabilityText(packageJsonPath) || "{}");
    const manifestPath = path.join(repoRoot, packageRoot, "capability-manifest.v1.json");
    const contractPath = path.join(repoRoot, packageRoot, "capability-contract.v1.json");
    if (!existsSync(manifestPath) || !existsSync(contractPath)) {
      continue;
    }
    if (packageJson.exports?.["./manifest"] !== "./capability-manifest.v1.json") {
      continue;
    }
    if (packageJson.exports?.["./contract"] !== "./capability-contract.v1.json") {
      continue;
    }

    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface || surface.privateGlueRequired || surface.reusableAcrossFactories !== true) {
      continue;
    }

    for (const entrypoint of surface.entrypoints || []) {
      if (entrypoint.kind !== "graph" || !entrypoint.path) continue;
      governedCapabilityGraphs.set(`${packageRoot}/${entrypoint.path}`, {
        packageName: surface.packageName,
        packageRoot,
      });
    }
  }

  const graphFamilies = Array.isArray(activeSurfaceManifest?.graph_families)
    ? activeSurfaceManifest.graph_families
    : [];
  for (const entry of graphFamilies) {
    if (String(entry?.classification || "").trim() !== "active_runtime") continue;
    for (const graphPath of Array.isArray(entry?.include) ? entry.include : []) {
      if (!String(graphPath).startsWith("packages/") || String(graphPath).includes("*")) continue;
      if (!governedCapabilityGraphs.has(graphPath)) {
        governedCapabilityGraphs.set(graphPath, {
          packageName: capabilityPackageForGraphPath(graphPath),
          packageRoot: graphPath.split("/").slice(0, 2).join("/"),
          ownerType: "active_runtime_manifest",
        });
      }
    }
  }

  return governedCapabilityGraphs;
}

function inferPrivateExecutionGluePaths({ factoryRoot, graphBindings, config }) {
  return graphBindings
    .filter((entry) =>
      entry.owner === "factory"
      && entry.path.startsWith(`${factoryRoot}/graphs/`)
      && entry.path !== config.dispatch?.graph
      && entry.path !== config.pipeline?.supervisor_tick
      && !(config.schedules?.jobs || []).some((job) => job.graph === entry.path)
      && !String(entry.id || "").startsWith("domain_"),
    )
    .map((entry) => entry.path);
}

function createFactoryManifest({
  repoRoot,
  config,
  registryEntry,
  governedCapabilityGraphs,
  registryPath = "factory-registry.json",
}) {
  const factoryId = config.factory_id;
  const factoryRoot = `factories/${factoryId}`;
  const manifestPath = manifestPathFor(factoryId);
  const graphBindings = sortStrings((registryEntry?.graphs || []).map((graph) => `${graph.id}:${graph.path}`)).map((entry) => {
    const [id, graphPath] = entry.split(":");
    const owner = graphPath.startsWith(`${factoryRoot}/graphs/`) ? "factory" : "shared";
    const governedBinding = owner === "shared" ? governedCapabilityGraphs.get(graphPath) : null;
    return {
      id,
      path: graphPath,
      owner,
      role: classifyGraphRole(graphPath, config, id, governedCapabilityGraphs),
      capabilityPackage: owner === "shared" ? governedBinding?.packageName || capabilityPackageForGraphPath(graphPath) : null,
    };
  });
  const privateExecutionGluePaths = inferPrivateExecutionGluePaths({ factoryRoot, graphBindings, config });

  return {
    schemaVersion: "factory_composition_manifest/v1",
    factoryId,
    compositionModel: factoryId === "mothership" ? "control_plane" : "thin_composition",
    manifestPath,
    configPath: `${factoryRoot}/factory.config.json`,
    registryPath,
    dispatchGraphPath: config.dispatch.graph,
    supervisorGraphPath: config.pipeline.supervisor_tick,
    graphBindings,
    bootstrap: {
      readmePath: existsSync(path.join(repoRoot, factoryRoot, "README.md")) ? `${factoryRoot}/README.md` : null,
      intentPath: existsSync(path.join(repoRoot, factoryRoot, "INTENT.md")) ? `${factoryRoot}/INTENT.md` : null,
      createEvolveDocPath: existsSync(path.join(repoRoot, factoryRoot, "docs", "factory-create-evolve.md")) ? `${factoryRoot}/docs/factory-create-evolve.md` : null,
      conformanceReadmePath: existsSync(path.join(repoRoot, factoryRoot, "conformance", "README.md")) ? `${factoryRoot}/conformance/README.md` : null,
      initCommand: `hatch factory init --id ${factoryId} --repo ${config.target_repo || config.target_repo} --control-plane ${config.control_plane_repo}`,
    },
    policy: {
      configPath: `${factoryRoot}/factory.config.json`,
      policyPackDir: config.policyPack ? `${factoryRoot}/policy-pack/v1` : null,
      policyPackVersion: config.policyPack?.version || null,
      overrideKeys: flattenKeys("", config.policyPack?.overrides || {}),
      policyFiles: config.policyPack ? sortStrings(readdirSync(path.join(repoRoot, factoryRoot, "policy-pack", "v1"))) : [],
    },
    artifactDefaults: {
      runsDir: config.runs_dir,
      trustDomain: config.trust.domain,
      trustRoles: config.trust.roles,
      canonicalCheckoutPath: config.canonical_checkout_path || null,
      scheduledGraphs: sortStrings((config.schedules?.jobs || []).map((job) => job.graph).filter(Boolean)),
    },
    telemetryDefaults: {
      dispatchLatencySloSeconds: Number.isInteger(config.dispatch?.latency_slo_seconds) ? config.dispatch.latency_slo_seconds : null,
      maintenanceIntervalSeconds: Number.isInteger(config.pipeline?.maintenance_interval_seconds) ? config.pipeline.maintenance_interval_seconds : null,
      conformanceEntrypoint: config.conformance?.entrypoint || null,
      conformanceRunsDir: config.conformance?.runs_dir || null,
      benchmarkTelemetryWarnOnly: Boolean(config.conformance?.benchmark_telemetry_warn_only),
      benchmarkTelemetryExemptions: sortStrings(config.conformance?.benchmark_telemetry_exemptions || []),
    },
    privateExecutionGluePaths,
  };
}

function isConfigOnlyManagedFactory({ config = {}, manifest = {} } = {}) {
  if (config.managed !== true) return false;
  if (manifest.dispatchGraphPath.startsWith("factories/")) return false;
  if (manifest.supervisorGraphPath.startsWith("factories/")) return false;
  return manifest.graphBindings.every((entry) => entry.owner === "shared");
}

export async function analyzeFactoryCompositionContract({ repoRoot = process.cwd() } = {}) {
  const diagnostics = [];
  const entries = [];
  const configPaths = listFactoryConfigPaths(repoRoot);
  const registry = readJson(repoRoot, "factory-registry.json");
  const governedCapabilityGraphs = await loadGovernedCapabilityGraphs(repoRoot);
  const activeSurfaceManifest = loadActiveSurfaceManifest({ repoRoot });

  for (const configPath of configPaths) {
    const config = readJson(repoRoot, configPath);
    const factoryRoot = path.dirname(configPath).replaceAll("\\", "/");
    const registryEntry = (registry.instances || []).find((entry) => entry.instance_id === config.instance_id || entry.instance_id === config.factory_id)
      || (registry.factories || []).find((entry) => entry.id === config.factory_id);

    if (!registryEntry) {
      diagnostics.push(`factory_composition_missing_registry_entry factory=${JSON.stringify(config.factory_id)}`);
      continue;
    }

    const manifest = createFactoryManifest({
      repoRoot,
      config,
      registryEntry,
      governedCapabilityGraphs,
    });
    const currentOutputPath = manifestPathFor(config.factory_id);
    const currentOutputFullPath = path.join(repoRoot, currentOutputPath);
    const rendered = stringifyFactoryCompositionManifestDocument(manifest);

    if (!existsSync(currentOutputFullPath)) {
      diagnostics.push(`factory_composition_missing_manifest output=${JSON.stringify(currentOutputPath)}`);
    } else if (readText(repoRoot, currentOutputPath) !== rendered) {
      diagnostics.push(`factory_composition_output_drift output=${JSON.stringify(currentOutputPath)}`);
    }

    if (!isConfigOnlyManagedFactory({ config, manifest }) && (!config.policyPack || !manifest.policy.policyPackDir || !manifest.policy.policyPackVersion)) {
      diagnostics.push(`factory_composition_missing_policy_surface factory=${JSON.stringify(config.factory_id)}`);
    }

    if (!manifest.bootstrap.readmePath) {
      diagnostics.push(`factory_composition_missing_bootstrap_readme factory=${JSON.stringify(config.factory_id)}`);
    }

    if (!manifest.artifactDefaults.runsDir || !manifest.artifactDefaults.trustDomain || manifest.artifactDefaults.trustRoles.length === 0) {
      diagnostics.push(`factory_composition_missing_artifact_defaults factory=${JSON.stringify(config.factory_id)}`);
    }

    if (!Object.hasOwn(manifest, "telemetryDefaults")) {
      diagnostics.push(`factory_composition_missing_telemetry_defaults factory=${JSON.stringify(config.factory_id)}`);
    }

    for (const graphBinding of manifest.graphBindings) {
      if (graphBinding.owner !== "shared" || !graphBinding.path.startsWith("packages/")) continue;
      const governedBinding = governedCapabilityGraphs.get(graphBinding.path);
      const manifestClassification = classifyPathWithManifestEntries({
        path: graphBinding.path,
        entries: activeSurfaceManifest.graph_families,
      });
      const isActiveRuntimeGraph = manifestClassification.matches.some((entry) => entry.classification === "active_runtime");
      if (!governedBinding && !isActiveRuntimeGraph) {
        diagnostics.push(`factory_composition_ungoverned_shared_graph factory=${JSON.stringify(config.factory_id)} graph=${JSON.stringify(graphBinding.path)}`);
      }
    }

    if (manifest.compositionModel === "thin_composition" && manifest.privateExecutionGluePaths.length > 0) {
      diagnostics.push(`factory_composition_private_execution_glue factory=${JSON.stringify(config.factory_id)} paths=${JSON.stringify(manifest.privateExecutionGluePaths)}`);
    }

    entries.push({
      factory_id: manifest.factoryId,
      composition_model: manifest.compositionModel,
      manifest_path: manifest.manifestPath,
      shared_graph_bindings: manifest.graphBindings.filter((entry) => entry.owner === "shared").length,
      local_graph_bindings: manifest.graphBindings.filter((entry) => entry.owner === "factory").length,
      private_execution_glue_paths: manifest.privateExecutionGluePaths.length,
    });
  }

  const report = {
    schema_version: "factory_composition_registry/v1",
    summary: {
      registered_factories: entries.length,
      diagnostics: diagnostics.length,
    },
    factories: entries.sort((left, right) => left.factory_id.localeCompare(right.factory_id)),
    diagnostics,
  };

  return {
    ok: diagnostics.length === 0,
    report,
    renderedJson: stableJson(report),
    renderedMarkdown: renderFactoryCompositionRegistryMarkdown(report.factories, diagnostics),
    manifests: configPaths.map((configPath) => {
      const config = readJson(repoRoot, configPath);
      const registryEntry = (registry.instances || []).find((entry) => entry.instance_id === config.instance_id || entry.instance_id === config.factory_id)
        || (registry.factories || []).find((entry) => entry.id === config.factory_id);
      return registryEntry ? createFactoryManifest({
        repoRoot,
        config,
        registryEntry,
        governedCapabilityGraphs,
      }) : null;
    }).filter(Boolean),
  };
}

export async function writeFactoryCompositionOutputs({ repoRoot = process.cwd() } = {}) {
  const analysis = await analyzeFactoryCompositionContract({ repoRoot });
  for (const manifest of analysis.manifests) {
    const outputPath = path.join(repoRoot, manifest.manifestPath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, stringifyFactoryCompositionManifestDocument(manifest), "utf8");
  }
  const finalResult = await analyzeFactoryCompositionContract({ repoRoot });
  writeFileSync(path.join(repoRoot, FACTORY_COMPOSITION_REGISTRY_JSON_PATH), finalResult.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, FACTORY_COMPOSITION_REGISTRY_MARKDOWN_PATH), finalResult.renderedMarkdown, "utf8");
  return finalResult;
}
