import { existsSync, readFileSync } from "node:fs";

import { analyzeCommandThinnessEnforcement } from "../check-command-thinness-enforcement.ts";
import { analyzeInternalCliTransport } from "../check-internal-cli-transport.ts";
import { analyzeRuntimeInternalCliEnforcement } from "../check-runtime-internal-cli-enforcement.ts";
import { buildActiveSurfaceInventory } from "./active-surface-inventory.ts";
import { loadActiveSurfaceManifest, selectManifestScopedFiles } from "./active-surface-manifest.ts";
import { GATE_MANIFEST } from "./gate-manifest.ts";
import { PHASE1_GATE_SCOPE_CONTRACT, PHASE1_GATE_SCOPE_ENTRIES } from "./phase1-gate-scope-contract.ts";

export const PHASE1_GATE_READINESS_REPORT_JSON_PATH = "docs/contracts/phase1-gate-readiness-report.json";
export const PHASE1_GATE_READINESS_REPORT_MARKDOWN_PATH = "docs/contracts/phase1-gate-readiness-report.md";

const REQUIRED_ROUTE_PROFILES = Object.freeze([
  {
    id: "pre_commit",
    description: "git commit local hook path",
    profile: "strict",
    sourcePath: ".githooks/pre-commit",
    commandPattern: "node scripts/run-gates.mjs --profile strict",
  },
  {
    id: "pre_push",
    description: "git push local hook path",
    profile: "fast",
    sourcePath: ".githooks/pre-push",
    commandPattern: "node scripts/run-gates.mjs --profile fast",
  },
  {
    id: "pre_merge_script",
    description: "pre-merge package script",
    profile: "full",
    sourcePath: "package.json",
    packageScriptName: "qa:pre-merge",
    commandPattern: "node scripts/run-gates.mjs --profile full --all-tracked",
  },
  {
    id: "pre_merge_workflow",
    description: "pre-merge CI workflow",
    profile: "full",
    sourcePath: ".github/workflows/pre-merge-quality.yml",
    commandPattern: "pnpm --silent qa:pre-merge",
  },
]);
const ROUTED_ACTIVE_SURFACE_GATES = Object.freeze([
  ...PHASE1_GATE_SCOPE_ENTRIES.map((entry) => entry.gateId),
  "phase1_gate_readiness",
]);

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultReadFile(path) {
  return readFileSync(path, "utf8");
}

function buildGateManifestLookup(gateManifest = GATE_MANIFEST) {
  return new Map(gateManifest.map((gate) => [gate.id, gate]));
}

function summarizeViolations(violations = []) {
  return violations.map((entry) => ({
    file: entry.file,
    kind: entry.kind,
    classification: entry.classification || "",
    lines: Number(entry.lines || 0),
    count: Number(entry.internal_cli_calls || 0),
    transport_mode: entry.typed_action_transport_mode || "",
  }));
}

function classifyViolationFiles({ manifest, filesBySurface }) {
  const lookup = {};
  for (const [surfaceKey, descriptor] of Object.entries(PHASE1_GATE_SCOPE_CONTRACT)) {
    const scopedFiles = selectManifestScopedFiles({
      manifest,
      files: filesBySurface,
      surfaceType: descriptor.surfaceType,
      classifications: descriptor.classifications,
    });
    lookup[surfaceKey] = new Set(scopedFiles);
  }
  return lookup;
}

function checkGateManifestContract(gateManifest = GATE_MANIFEST) {
  const diagnostics = [];
  const gateLookup = buildGateManifestLookup(gateManifest);
  const gates = [];

  for (const descriptor of PHASE1_GATE_SCOPE_ENTRIES) {
    const gate = gateLookup.get(descriptor.gateId);
    if (!gate) {
      diagnostics.push(`missing_gate_manifest_entry gate=${descriptor.gateId}`);
      continue;
    }

    if (gate.command !== descriptor.command) {
      diagnostics.push(`gate_command_drift gate=${descriptor.gateId} expected=${JSON.stringify(descriptor.command)} actual=${JSON.stringify(gate.command)}`);
    }
    if (JSON.stringify(gate.args) !== JSON.stringify(descriptor.args)) {
      diagnostics.push(`gate_args_drift gate=${descriptor.gateId}`);
    }
    if (JSON.stringify(gate.profiles) !== JSON.stringify(descriptor.profiles)) {
      diagnostics.push(`gate_profiles_drift gate=${descriptor.gateId}`);
    }
    if (gate.failureTarget !== descriptor.failureTarget) {
      diagnostics.push(`gate_failure_target_drift gate=${descriptor.gateId}`);
    }
    const expectedRuntime = descriptor.runtime?.stagedFileList === true;
    if (Boolean(gate.runtime?.stagedFileList) !== expectedRuntime) {
      diagnostics.push(`gate_runtime_scope_drift gate=${descriptor.gateId}`);
    }

    gates.push({
      gate_id: descriptor.gateId,
      profile_scope: [...descriptor.profiles],
      surface_type: descriptor.surfaceType,
      classifications: [...descriptor.classifications],
    });
  }

  return { diagnostics, gates };
}

function checkRouteContract({ gateManifest = GATE_MANIFEST, readFile = defaultReadFile } = {}) {
  const diagnostics = [];
  const gateLookup = buildGateManifestLookup(gateManifest);
  const routes = [];

  for (const route of REQUIRED_ROUTE_PROFILES) {
    const sourceText = readFile(route.sourcePath);
    if (!sourceText.includes(route.commandPattern)) {
      diagnostics.push(`route_command_missing route=${route.id} source=${route.sourcePath}`);
    }
    const missingGates = ROUTED_ACTIVE_SURFACE_GATES.filter((gateId) => {
      const gate = gateLookup.get(gateId);
      return !gate || !gate.profiles.includes(route.profile);
    });
    if (missingGates.length > 0) {
      diagnostics.push(`route_profile_omits_phase1_gate route=${route.id} profile=${route.profile} missing=${missingGates.join(",")}`);
    }
    routes.push({
      route_id: route.id,
      description: route.description,
      profile: route.profile,
      source_path: route.sourcePath,
      phase1_gate_ids: ROUTED_ACTIVE_SURFACE_GATES
        .filter((gateId) => gateLookup.get(gateId)?.profiles.includes(route.profile)),
    });
  }

  return { diagnostics, routes };
}

function collectPhase1Violations({ files, readFile = defaultReadFile, manifest }) {
  const graphInventory = analyzeInternalCliTransport({
    files,
    readFile,
    failOptedInGraphs: false,
    manifest,
    activeGraphManifestClassifications: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.classifications,
  });
  const graphViolations = graphInventory.violations.filter((entry) => entry.kind === PHASE1_GATE_SCOPE_CONTRACT.graph_transport.violationKind);

  const runtimeInventory = analyzeRuntimeInternalCliEnforcement({ files, readFile, manifest });
  const commandInventory = analyzeCommandThinnessEnforcement({ files, readFile, manifest });

  return {
    graph_transport: {
      gate_id: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.gateId,
      checked: graphViolations.length,
      classifications: [...PHASE1_GATE_SCOPE_CONTRACT.graph_transport.classifications],
      violations: summarizeViolations(graphViolations),
    },
    runtime_internal_cli: {
      gate_id: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.gateId,
      checked: runtimeInventory.checked,
      classifications: [...PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.classifications],
      allowlisted_external_boundaries: [...runtimeInventory.allowlisted_external_boundaries],
      violations: summarizeViolations(runtimeInventory.violations),
    },
    command_thinness: {
      gate_id: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.gateId,
      checked: commandInventory.checked,
      classifications: [...PHASE1_GATE_SCOPE_CONTRACT.command_thinness.classifications],
      violations: summarizeViolations(commandInventory.violations),
    },
  };
}

function checkViolationAttribution({ manifest, files, violationInventory }) {
  const diagnostics = [];
  const attributionLookup = classifyViolationFiles({ manifest, filesBySurface: files });

  for (const [surfaceKey, descriptor] of Object.entries(PHASE1_GATE_SCOPE_CONTRACT)) {
    const scopedFiles = attributionLookup[surfaceKey];
    const violations = violationInventory[surfaceKey]?.violations || [];
    for (const violation of violations) {
      if (!scopedFiles.has(violation.file)) {
        diagnostics.push(`phase1_violation_outside_declared_scope gate=${descriptor.gateId} file=${JSON.stringify(violation.file)}`);
      }
    }
  }

  return diagnostics;
}

export function buildPhase1GateReadinessReport({
  files = [],
  manifest = loadActiveSurfaceManifest(),
  gateManifest = GATE_MANIFEST,
  readFile = defaultReadFile,
} = {}) {
  const gateAudit = checkGateManifestContract(gateManifest);
  const routeAudit = checkRouteContract({ gateManifest, readFile });
  const activeSurfaceInventory = buildActiveSurfaceInventory({ files, manifest, readFile });
  const violationInventory = collectPhase1Violations({ files, manifest, readFile });
  const attributionDiagnostics = checkViolationAttribution({
    manifest,
    files,
    violationInventory,
  });
  const diagnostics = [
    ...gateAudit.diagnostics,
    ...routeAudit.diagnostics,
    ...activeSurfaceInventory.diagnostics,
    ...attributionDiagnostics,
  ];

  const graphViolations = violationInventory.graph_transport.violations.length;
  const runtimeViolations = violationInventory.runtime_internal_cli.violations.length;
  const commandViolations = violationInventory.command_thinness.violations.length;

  return {
    schema_version: "phase1_gate_readiness/v1",
    ok: diagnostics.length === 0,
    summary: {
      active_graph_roots: activeSurfaceInventory.live_graph_roots.length,
      active_graphs: activeSurfaceInventory.active_graphs.length,
      active_runtime_files: activeSurfaceInventory.active_runtime_files.length,
      active_command_references: activeSurfaceInventory.active_command_references.length,
      graph_transport_violations: graphViolations,
      runtime_internal_cli_violations: runtimeViolations,
      runtime_internal_cli_allowlisted_external_boundaries: violationInventory.runtime_internal_cli.allowlisted_external_boundaries.length,
      command_thinness_violations: commandViolations,
      diagnostics: diagnostics.length,
    },
    scope_contract: {
      gates: gateAudit.gates,
      routes: routeAudit.routes,
    },
    phase1_violation_inventory: violationInventory,
    diagnostics,
  };
}

export function renderPhase1GateReadinessMarkdown(report) {
  const lines = [
    "---",
    'doc_type: "reference"',
    'owner: "docs-stewards"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Checked-in Phase 1 gate-readiness audit showing canonical scope, hook/CI routing, and remaining attributable violations."',
    'tags: [architecture, contracts, gates, generated, readiness, runtime]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Phase 1 Gate Readiness Report",
    "",
    `Schema: \`${report.schema_version}\``,
    `Diagnostics: ${report.summary.diagnostics}`,
    `Active graph roots: ${report.summary.active_graph_roots}`,
    `Active graphs: ${report.summary.active_graphs}`,
    `Active runtime files: ${report.summary.active_runtime_files}`,
    `Active command references: ${report.summary.active_command_references}`,
    `Graph transport violations: ${report.summary.graph_transport_violations}`,
    `Runtime internal CLI violations: ${report.summary.runtime_internal_cli_violations}`,
    `Runtime internal CLI allowlisted external boundaries: ${report.summary.runtime_internal_cli_allowlisted_external_boundaries}`,
    `Command thinness violations: ${report.summary.command_thinness_violations}`,
    "",
    "## Gate Scope Contract",
    "",
    "| Gate | Surface | Classifications | Profiles |",
    "| --- | --- | --- | --- |",
  ];

  for (const gate of report.scope_contract.gates) {
    lines.push(`| \`${gate.gate_id}\` | \`${gate.surface_type}\` | \`${gate.classifications.join(", ")}\` | \`${gate.profile_scope.join(", ")}\` |`);
  }

  lines.push("", "## Hook and CI Routes", "", "| Route | Profile | Source | Gates |", "| --- | --- | --- | --- |");
  for (const route of report.scope_contract.routes) {
    lines.push(`| \`${route.route_id}\` | \`${route.profile}\` | \`${route.source_path}\` | \`${route.phase1_gate_ids.join(", ")}\` |`);
  }

  for (const [surfaceKey, inventory] of Object.entries(report.phase1_violation_inventory)) {
    lines.push("", `## ${surfaceKey.replaceAll("_", " ")}`, "", "| File | Kind | Detail |", "| --- | --- | --- |");
    if (surfaceKey === "runtime_internal_cli") {
      lines.push("", `Allowlisted external boundaries: ${inventory.allowlisted_external_boundaries.length}`);
    }
    if (inventory.violations.length === 0) {
      lines.push("| _none_ | _none_ | _none_ |");
      continue;
    }
    for (const violation of inventory.violations) {
      const detail = violation.lines > 0
        ? `lines=${violation.lines} class=${violation.classification}`
        : `count=${violation.count} transport=${violation.transport_mode || "n/a"}`;
      lines.push(`| \`${violation.file}\` | \`${violation.kind}\` | \`${detail}\` |`);
    }
  }

  lines.push("", "## Diagnostics", "");
  if (report.diagnostics.length === 0) {
    lines.push("- none");
  } else {
    for (const diagnostic of report.diagnostics) {
      lines.push(`- ${diagnostic}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function analyzePhase1GateReadinessArtifacts({
  files = [],
  manifest = loadActiveSurfaceManifest(),
  gateManifest = GATE_MANIFEST,
  readFile = defaultReadFile,
  expectedJson = "",
  expectedMarkdown = "",
} = {}) {
  const report = buildPhase1GateReadinessReport({ files, manifest, gateManifest, readFile });
  const renderedJson = stableJson(report);
  const renderedMarkdown = renderPhase1GateReadinessMarkdown(report);
  const diagnostics = [...report.diagnostics];

  if (expectedJson && expectedJson !== renderedJson) diagnostics.push("phase1_gate_readiness_json_drift");
  if (expectedMarkdown && expectedMarkdown !== renderedMarkdown) diagnostics.push("phase1_gate_readiness_markdown_drift");

  return {
    schema_version: "phase1_gate_readiness_check/v1",
    ok: diagnostics.length === 0,
    report,
    rendered_json: renderedJson,
    rendered_markdown: renderedMarkdown,
    diagnostics: sortStrings(diagnostics),
  };
}

export function loadCheckedInPhase1GateReadinessArtifacts({ readFile = defaultReadFile } = {}) {
  return {
    json: existsSync(PHASE1_GATE_READINESS_REPORT_JSON_PATH) ? readFile(PHASE1_GATE_READINESS_REPORT_JSON_PATH) : "",
    markdown: existsSync(PHASE1_GATE_READINESS_REPORT_MARKDOWN_PATH) ? readFile(PHASE1_GATE_READINESS_REPORT_MARKDOWN_PATH) : "",
  };
}
