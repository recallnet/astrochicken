import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CAPABILITY_OUTPUT_REGISTRY_JSON_PATH = "docs/contracts/capability-output-registry.json";
export const CAPABILITY_OUTPUT_REGISTRY_MARKDOWN_PATH = "docs/contracts/capability-output-registry.md";
export const CAPABILITY_OUTPUT_GATE_MODES = Object.freeze({
  governed_output_path_only: "governed_output_path_only",
  capability_output_producer_discovery_fail_closed: "capability_output_producer_discovery_fail_closed",
  capability_output_contract_runtime_parity: "capability_output_contract_runtime_parity",
});

const CLOUD_EVENTS_REGISTRY_PATH = "docs/contracts/cloudevents-registry.json";
const OCI_ARTIFACT_TAXONOMY_PATH = "docs/contracts/oci-artifact-taxonomy.json";
const OTEL_TAXONOMY_SOURCE_JSON_PATH = "packages/factory-telemetry/src/otel-contract.json";

const GRAPH_RUNTIME_TELEMETRY_REF = "hatch.workflow.lifecycle";
const FACTORY_OPS_COMMAND_IMPORT_PATTERN = /(?:\.\.\/)+(?:\.\.\/)?packages\/factory-ops\/src\/(?:commands|lib\/command-owners)\/[^"]+\.mjs|packages\/factory-ops\/src\/(?:commands|lib\/command-owners)\/[^"]+\.mjs/g;
const LOCAL_OUTPUT_WRITE_PATTERN = /\b(writeFile(?:Sync|Fn)?|appendFile(?:Sync|Fn)?|createWriteStream)\s*\(/;
const GOVERNED_OUTPUT_HELPER_IMPORT_PATTERN = /(?:from\s+|import\s*\()["']([^"']*(?:cloudevents-registry|oci-artifact-registry|openlineage-registry)[^"']*)["']/g;
const GOVERNED_OUTPUT_DIRECT_API_PATTERN = /\b(?:buildCloudEvent|publishOciArtifact|buildOciArtifactPublicationPlan|buildHatchRunLifecycleLineageProjection|buildReleaseRolloutLineageProjection|normalizeOpenLineageProjection)\s*\(/;

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function listCandidateFiles(repoRoot) {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (tracked.status !== 0) {
    throw new Error(`capability_output_contract_git_ls_files_failed:${String(tracked.stderr || tracked.stdout || "").trim()}`);
  }
  return String(tracked.stdout || "")
    .split("\0")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function discoverCapabilityPackagePaths(trackedFiles = []) {
  return trackedFiles
    .filter((filePath) => /^packages\/capability-[^/]+\/package\.json$/.test(filePath))
    .map((filePath) => filePath.replace(/\/package\.json$/, ""))
    .sort((left, right) => left.localeCompare(right));
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

async function loadSurface(repoRoot, packageRoot) {
  const module = await importModule(repoRoot, `${packageRoot}/capability-contract.mjs`);
  return Object.values(module).find((value) =>
    value
    && typeof value === "object"
    && typeof value.packageName === "string"
    && typeof value.outputPath === "string"
    && Array.isArray(value.entrypoints),
  );
}

function loadCloudEventSurfaceIds(repoRoot) {
  const registry = JSON.parse(readText(path.join(repoRoot, CLOUD_EVENTS_REGISTRY_PATH)) || "{}");
  return new Set((registry.surfaces || []).map((entry) => String(entry?.id || "").trim()).filter(Boolean));
}

function loadOciArtifactClassKeys(repoRoot) {
  const registry = JSON.parse(readText(path.join(repoRoot, OCI_ARTIFACT_TAXONOMY_PATH)) || "{}");
  return new Set((registry.classes || []).map((entry) => String(entry?.key || "").trim()).filter(Boolean));
}

function loadOtelNaming(repoRoot) {
  const contract = JSON.parse(readText(path.join(repoRoot, OTEL_TAXONOMY_SOURCE_JSON_PATH)) || "{}");
  return {
    eventNamePattern: new RegExp(String(contract?.naming?.event_name_pattern || "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$")),
  };
}

function normalizeOutputs(surface) {
  return {
    events: surface?.outputSurfaces?.events || [],
    artifacts: surface?.outputSurfaces?.artifacts || [],
    telemetry: surface?.outputSurfaces?.telemetry || [],
  };
}

function outputRefSet(entries = []) {
  return new Set((entries || []).map((entry) => String(entry?.ref || "").trim()).filter(Boolean));
}

function buildDeclaredOutputIndex(packageRoot, outputs) {
  return {
    events: outputRefSet(outputs.events),
    artifacts: outputRefSet(outputs.artifacts),
    telemetry: outputRefSet(outputs.telemetry),
    allRefs: sortStrings([
      ...outputs.events.map((entry) => entry?.ref || ""),
      ...outputs.artifacts.map((entry) => entry?.ref || ""),
      ...outputs.telemetry.map((entry) => entry?.ref || ""),
    ]),
    producerPaths: new Set(
      sortStrings([
        ...outputs.events.flatMap((entry) => (entry?.producerPaths || []).map((producerPath) => `${packageRoot}/${producerPath}`)),
        ...outputs.artifacts.flatMap((entry) => (entry?.producerPaths || []).map((producerPath) => `${packageRoot}/${producerPath}`)),
        ...outputs.telemetry.flatMap((entry) => (entry?.producerPaths || []).map((producerPath) => `${packageRoot}/${producerPath}`)),
      ]),
    ),
  };
}

function buildDeclaredOutputRefMap(outputs) {
  return new Map(
    sortStrings([
      ...outputs.events.map((entry) => entry?.ref || ""),
      ...outputs.artifacts.map((entry) => entry?.ref || ""),
      ...outputs.telemetry.map((entry) => entry?.ref || ""),
    ]).map((ref) => [ref, new Set()]),
  );
}

function buildGlobalOutputRefIndex(packageDefinitions = []) {
  return {
    events: new Set(sortStrings(packageDefinitions.flatMap(({ outputs }) => outputs.events.map((entry) => entry?.ref || "")))),
    artifacts: new Set(sortStrings(packageDefinitions.flatMap(({ outputs }) => outputs.artifacts.map((entry) => entry?.ref || "")))),
    telemetry: new Set(sortStrings(packageDefinitions.flatMap(({ outputs }) => outputs.telemetry.map((entry) => entry?.ref || "")))),
  };
}

function normalizeSourceFileOutputCoverage(entries = []) {
  return new Map(
    (entries || [])
      .map((entry) => ({
        path: String(entry?.path || "").trim(),
        refs: sortStrings(entry?.refs || []),
      }))
      .filter((entry) => entry.path)
      .map((entry) => [entry.path, entry.refs]),
  );
}

function discoverOutputOwnerImports(source = "") {
  return sortStrings(Array.from(String(source || "").matchAll(FACTORY_OPS_COMMAND_IMPORT_PATTERN), (match) => match[0]));
}

function hasLocalOutputWriteSignal(source = "") {
  return LOCAL_OUTPUT_WRITE_PATTERN.test(String(source || ""));
}

function discoverGovernedOutputHelperImports(source = "") {
  return sortStrings(Array.from(String(source || "").matchAll(GOVERNED_OUTPUT_HELPER_IMPORT_PATTERN), (match) => match[1]));
}

function hasDirectGovernedOutputApiUsage(source = "") {
  return GOVERNED_OUTPUT_DIRECT_API_PATTERN.test(String(source || ""));
}

function resolveImportedModulePath(repoRoot, sourceFile, moduleSpecifier) {
  const specifier = String(moduleSpecifier || "").trim();
  if (!specifier) return "";
  if (specifier.startsWith(".")) {
    const absolutePath = path.resolve(repoRoot, path.dirname(sourceFile), specifier);
    const relativePath = path.relative(repoRoot, absolutePath);
    return relativePath && !relativePath.startsWith("..") ? relativePath : "";
  }
  if (specifier.startsWith("packages/") || specifier.startsWith("docs/")) {
    return path.normalize(specifier).replace(/\\/g, "/");
  }
  const packagesIndex = specifier.indexOf("packages/");
  if (packagesIndex >= 0) {
    return path.normalize(specifier.slice(packagesIndex)).replace(/\\/g, "/");
  }
  const docsIndex = specifier.indexOf("docs/");
  if (docsIndex >= 0) {
    return path.normalize(specifier.slice(docsIndex)).replace(/\\/g, "/");
  }
  return "";
}

function classifySharedOutputOwnerModule(repoRoot, modulePath, globalOutputRefIndex) {
  const source = readText(path.join(repoRoot, modulePath));
  return {
    events: new Set([...globalOutputRefIndex.events].filter((ref) => ref && source.includes(ref))),
    artifacts: new Set([...globalOutputRefIndex.artifacts].filter((ref) => ref && source.includes(ref))),
    telemetry: new Set([...globalOutputRefIndex.telemetry].filter((ref) => ref && source.includes(ref))),
  };
}

function isCapabilityProductionSourceFile(packageRoot, trackedFile) {
  if (!trackedFile.startsWith(`${packageRoot}/`)) return false;
  if (!/\.(mjs|js|ts)$/.test(trackedFile)) return false;
  if (trackedFile.endsWith("/capability-contract.mjs")) return false;
  if (/\/workflows\/.+\.workflow-source\.mjs$/.test(trackedFile)) return false;
  if (trackedFile.includes("/test/")) return false;
  if (/\.(test|spec)\.(mjs|js|ts)$/.test(trackedFile)) return false;
  return true;
}

function validateOutputEntries({
  diagnostics,
  repoRoot,
  packageRoot,
  category,
  entries,
  validCloudEvents,
  validOciArtifactClasses,
  otelNaming,
}) {
  const allowedStandards = {
    events: new Set(["cloudevents"]),
    artifacts: new Set(["oci_artifact_class", "platform_contract_artifact"]),
    telemetry: new Set(["otel_event", "otel_runtime"]),
  };

  for (const entry of entries) {
    const ref = String(entry?.ref || "").trim();
    const id = String(entry?.id || "").trim();
    const standard = String(entry?.standard || "").trim();
    const producerPaths = sortStrings(entry?.producerPaths || []);

    if (!id || !ref || !standard) {
      diagnostics.push(`capability_output_invalid_entry package=${JSON.stringify(packageRoot)} category=${category} ref=${JSON.stringify(ref || id || "unknown")}`);
      continue;
    }
    if (!allowedStandards[category].has(standard)) {
      diagnostics.push(`capability_output_invalid_standard package=${JSON.stringify(packageRoot)} category=${category} ref=${JSON.stringify(ref)} standard=${JSON.stringify(standard)}`);
    }
    for (const producerPath of producerPaths) {
      if (!existsSync(path.join(repoRoot, packageRoot, producerPath))) {
        diagnostics.push(`capability_output_missing_producer_path package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)} producer=${JSON.stringify(producerPath)}`);
      }
    }
    if (category === "events" && standard === "cloudevents" && !validCloudEvents.has(ref)) {
      diagnostics.push(`capability_output_unknown_cloudevents_surface package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)}`);
    }
    if (category === "artifacts" && standard === "oci_artifact_class" && !validOciArtifactClasses.has(ref)) {
      diagnostics.push(`capability_output_unknown_oci_artifact_class package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)}`);
    }
    if (category === "telemetry") {
      if (standard === "otel_runtime" && ref !== GRAPH_RUNTIME_TELEMETRY_REF) {
        diagnostics.push(`capability_output_invalid_runtime_telemetry_ref package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)}`);
      }
      if (standard === "otel_event" && !otelNaming.eventNamePattern.test(ref)) {
        diagnostics.push(`capability_output_invalid_otel_event_name package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)}`);
      }
    }
  }
}

function renderMarkdown(entries, diagnostics) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed registry for capability event, artifact, and telemetry output surfaces."',
    'tags: [capability, contracts, generated, outputs, registry]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Capability Output Registry",
    "",
    `- Registered capabilities: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Capability Outputs",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.package_name}\``,
      `  - events: \`${entry.events.length}\``,
      `  - artifacts: \`${entry.artifacts.length}\``,
      `  - telemetry expectations: \`${entry.telemetry.length}\``,
      ...entry.events.map((surface) => `  - event \`${surface.ref}\` via \`${surface.standard}\``),
      ...entry.artifacts.map((surface) => `  - artifact \`${surface.ref}\` via \`${surface.standard}\``),
      ...entry.telemetry.map((surface) => `  - telemetry \`${surface.ref}\` via \`${surface.standard}\``),
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

export function capabilityOutputDiagnosticMatchesMode(diagnostic = "", mode = "") {
  const entry = String(diagnostic || "");
  switch (mode) {
    case CAPABILITY_OUTPUT_GATE_MODES.governed_output_path_only:
      return entry.startsWith("capability_output_direct_governed_helper_import")
        || entry.startsWith("capability_output_direct_governed_emit_api");
    case CAPABILITY_OUTPUT_GATE_MODES.capability_output_producer_discovery_fail_closed:
      return entry.startsWith("capability_output_unclassified_source_file")
        || entry.startsWith("capability_output_unregistered_producer_file")
        || entry.startsWith("capability_output_unregistered_local_file_writer")
        || entry.startsWith("capability_output_source_coverage_missing_file")
        || entry.startsWith("capability_output_nonproducer_source_declared_as_producer")
        || entry.startsWith("capability_output_source_coverage_unknown_ref")
        || entry.startsWith("capability_output_source_coverage_ref_missing_producer_path")
        || entry.startsWith("capability_output_producer_missing_source_coverage");
    case CAPABILITY_OUTPUT_GATE_MODES.capability_output_contract_runtime_parity:
      return entry.startsWith("capability_output_missing_runtime_telemetry")
        || entry.startsWith("capability_output_missing_runtime_telemetry_producer")
        || entry.startsWith("capability_output_undocumented_")
        || entry.startsWith("capability_output_unknown_")
        || entry.startsWith("capability_output_invalid_");
    default:
      return true;
  }
}

export async function analyzeCapabilityOutputContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const diagnostics = [];
  const packageRoots = discoverCapabilityPackagePaths(trackedFiles);
  const validCloudEvents = loadCloudEventSurfaceIds(repoRoot);
  const validOciArtifactClasses = loadOciArtifactClassKeys(repoRoot);
  const otelNaming = loadOtelNaming(repoRoot);
  const packageDefinitions = [];
  const entries = [];

  for (const packageRoot of packageRoots) {
    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface) {
      diagnostics.push(`capability_output_missing_surface_export source=${JSON.stringify(`${packageRoot}/capability-contract.mjs`)}`);
      continue;
    }

    const outputs = normalizeOutputs(surface);
    validateOutputEntries({
      diagnostics,
      repoRoot,
      packageRoot,
      category: "events",
      entries: outputs.events,
      validCloudEvents,
      validOciArtifactClasses,
      otelNaming,
    });
    validateOutputEntries({
      diagnostics,
      repoRoot,
      packageRoot,
      category: "artifacts",
      entries: outputs.artifacts,
      validCloudEvents,
      validOciArtifactClasses,
      otelNaming,
    });
    validateOutputEntries({
      diagnostics,
      repoRoot,
      packageRoot,
      category: "telemetry",
      entries: outputs.telemetry,
      validCloudEvents,
      validOciArtifactClasses,
      otelNaming,
    });

    packageDefinitions.push({
      packageRoot,
      surface,
      outputs,
    });
  }

  const globalOutputRefIndex = buildGlobalOutputRefIndex(packageDefinitions);
  const sharedOutputOwnerCache = new Map();

  for (const { packageRoot, surface, outputs } of packageDefinitions) {
    const declaredOutputIndex = buildDeclaredOutputIndex(packageRoot, outputs);
    const declaredOutputRefMap = buildDeclaredOutputRefMap(outputs);
    for (const entry of [...outputs.events, ...outputs.artifacts, ...outputs.telemetry]) {
      const ref = String(entry?.ref || "").trim();
      if (!ref || !declaredOutputRefMap.has(ref)) continue;
      for (const producerPath of sortStrings(entry?.producerPaths || [])) {
        declaredOutputRefMap.get(ref).add(`${packageRoot}/${producerPath}`);
      }
    }
    const sourceFileOutputCoverage = normalizeSourceFileOutputCoverage(surface.sourceFileOutputCoverage || []);
    const graphEntrypoints = (surface.entrypoints || []).filter((entry) => entry.kind === "graph");
    if (graphEntrypoints.length > 0) {
      const runtimeEntry = outputs.telemetry.find((entry) => entry.standard === "otel_runtime" && entry.ref === GRAPH_RUNTIME_TELEMETRY_REF);
      if (!runtimeEntry) {
        diagnostics.push(`capability_output_missing_runtime_telemetry package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(GRAPH_RUNTIME_TELEMETRY_REF)}`);
      } else {
        const coveredPaths = new Set(sortStrings(runtimeEntry.producerPaths || []));
        for (const entrypoint of graphEntrypoints) {
          if (!coveredPaths.has(entrypoint.path)) {
            diagnostics.push(`capability_output_missing_runtime_telemetry_producer package=${JSON.stringify(packageRoot)} graph=${JSON.stringify(entrypoint.path)}`);
          }
        }
      }
    }

    const trackedSourceFiles = trackedFiles.filter((trackedFile) => isCapabilityProductionSourceFile(packageRoot, trackedFile));
    for (const trackedFile of trackedSourceFiles) {
      const relativePath = trackedFile.slice(packageRoot.length + 1);
      const source = readText(path.join(repoRoot, trackedFile));
      const discoveredImports = discoverOutputOwnerImports(source)
        .map((entry) => resolveImportedModulePath(repoRoot, trackedFile, entry))
        .filter(Boolean);
      const discoveredKnownOwnerImports = discoveredImports.filter((entry) => {
        if (!sharedOutputOwnerCache.has(entry)) {
          sharedOutputOwnerCache.set(entry, classifySharedOutputOwnerModule(repoRoot, entry, globalOutputRefIndex));
        }
        const classification = sharedOutputOwnerCache.get(entry);
        return classification.events.size > 0
          || classification.artifacts.size > 0
          || classification.telemetry.size > 0;
      });
      const directRefMatches = declaredOutputIndex.allRefs.filter((ref) => ref && source.includes(ref));
      const localWriteSignal = hasLocalOutputWriteSignal(source);
      const governedHelperImports = discoverGovernedOutputHelperImports(source);
      const directGovernedOutputApiUsage = hasDirectGovernedOutputApiUsage(source);

      if (!sourceFileOutputCoverage.has(relativePath)) {
        diagnostics.push(`capability_output_unclassified_source_file package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
        continue;
      }

      const coveredRefs = sourceFileOutputCoverage.get(relativePath) || [];
      if (governedHelperImports.length > 0) {
        diagnostics.push(`capability_output_direct_governed_helper_import package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)} helpers=${JSON.stringify(governedHelperImports)}`);
      }
      if (directGovernedOutputApiUsage) {
        diagnostics.push(`capability_output_direct_governed_emit_api package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
      }
      if ((discoveredKnownOwnerImports.length > 0 || directRefMatches.length > 0 || localWriteSignal) && coveredRefs.length === 0) {
        diagnostics.push(`capability_output_unregistered_producer_file package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
      }
      if (localWriteSignal && coveredRefs.length === 0) {
        diagnostics.push(`capability_output_unregistered_local_file_writer package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
      }
      for (const discovered of discoveredKnownOwnerImports) {
        const requirement = sharedOutputOwnerCache.get(discovered);
        for (const ref of requirement.events) {
          if (!declaredOutputIndex.events.has(ref)) {
            diagnostics.push(`capability_output_undocumented_event_surface package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)} producer=${JSON.stringify(trackedFile)} import=${JSON.stringify(discovered)}`);
          }
        }
        for (const ref of requirement.artifacts) {
          if (!declaredOutputIndex.artifacts.has(ref)) {
            diagnostics.push(`capability_output_undocumented_artifact_surface package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)} producer=${JSON.stringify(trackedFile)} import=${JSON.stringify(discovered)}`);
          }
        }
        for (const ref of requirement.telemetry) {
          if (!declaredOutputIndex.telemetry.has(ref)) {
            diagnostics.push(`capability_output_undocumented_telemetry_surface package=${JSON.stringify(packageRoot)} ref=${JSON.stringify(ref)} producer=${JSON.stringify(trackedFile)} import=${JSON.stringify(discovered)}`);
          }
        }
      }
    }

    for (const [relativePath, refs] of sourceFileOutputCoverage.entries()) {
      const trackedFile = `${packageRoot}/${relativePath}`;
      if (!trackedSourceFiles.includes(trackedFile)) {
        diagnostics.push(`capability_output_source_coverage_missing_file package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
        continue;
      }

      if (refs.length === 0 && declaredOutputIndex.producerPaths.has(trackedFile)) {
        diagnostics.push(`capability_output_nonproducer_source_declared_as_producer package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)}`);
      }

      for (const ref of refs) {
        if (!declaredOutputRefMap.has(ref)) {
          diagnostics.push(`capability_output_source_coverage_unknown_ref package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)} ref=${JSON.stringify(ref)}`);
          continue;
        }
        if (!declaredOutputRefMap.get(ref).has(trackedFile)) {
          diagnostics.push(`capability_output_source_coverage_ref_missing_producer_path package=${JSON.stringify(packageRoot)} source=${JSON.stringify(trackedFile)} ref=${JSON.stringify(ref)}`);
        }
      }
    }

    for (const [ref, producerPaths] of declaredOutputRefMap.entries()) {
      for (const producerPath of producerPaths) {
        if (!producerPath.startsWith(`${packageRoot}/`)) continue;
        if (!isCapabilityProductionSourceFile(packageRoot, producerPath)) continue;
        const relativePath = producerPath.slice(packageRoot.length + 1);
        const refs = sourceFileOutputCoverage.get(relativePath);
        if (!refs) {
          diagnostics.push(`capability_output_producer_path_missing_source_coverage package=${JSON.stringify(packageRoot)} source=${JSON.stringify(producerPath)} ref=${JSON.stringify(ref)}`);
          continue;
        }
        if (!refs.includes(ref)) {
          diagnostics.push(`capability_output_producer_path_missing_source_ref package=${JSON.stringify(packageRoot)} source=${JSON.stringify(producerPath)} ref=${JSON.stringify(ref)}`);
        }
      }
    }

    entries.push({
      package_name: surface.packageName,
      capability_id: surface.capabilityId,
      source_path: surface.sourcePath,
      output_path: surface.outputPath,
      events: outputs.events.map((entry) => ({
        ref: entry.ref,
        standard: entry.standard,
        producer_paths: sortStrings(entry.producerPaths || []),
      })),
      artifacts: outputs.artifacts.map((entry) => ({
        ref: entry.ref,
        standard: entry.standard,
        producer_paths: sortStrings(entry.producerPaths || []),
      })),
      telemetry: outputs.telemetry.map((entry) => ({
        ref: entry.ref,
        standard: entry.standard,
        producer_paths: sortStrings(entry.producerPaths || []),
      })),
    });
  }

  const sortedEntries = entries.sort((left, right) => left.package_name.localeCompare(right.package_name));
  const report = {
    schema_version: "capability_output_registry/v1",
    summary: {
      registered_capabilities: sortedEntries.length,
      documented_events: sortedEntries.reduce((total, entry) => total + entry.events.length, 0),
      documented_artifacts: sortedEntries.reduce((total, entry) => total + entry.artifacts.length, 0),
      documented_telemetry_expectations: sortedEntries.reduce((total, entry) => total + entry.telemetry.length, 0),
      diagnostics: diagnostics.length,
    },
    capabilities: sortedEntries,
    diagnostics,
  };

  return {
    ok: diagnostics.length === 0,
    report,
    renderedJson: stableJson(report),
    renderedMarkdown: renderMarkdown(sortedEntries, diagnostics),
  };
}

export async function writeCapabilityOutputContractOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const result = await analyzeCapabilityOutputContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, CAPABILITY_OUTPUT_REGISTRY_JSON_PATH), result.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, CAPABILITY_OUTPUT_REGISTRY_MARKDOWN_PATH), result.renderedMarkdown, "utf8");
  return result;
}
