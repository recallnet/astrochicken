import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  analyzeCapabilityOutputContract,
  CAPABILITY_OUTPUT_GATE_MODES,
  capabilityOutputDiagnosticMatchesMode,
} from "./capability-output-contract.ts";
import { analyzeFactoryCompositionContract } from "./factory-composition-contract.ts";
import { analyzeLineageGovernanceContract } from "./lineage-governance-contract.ts";
import { analyzeLineageProjectionSamples } from "./lineage-projection-samples.ts";
import {
  extractChecklistGateIds,
  hasConflictingChecklistState,
  extractPhaseSection,
  isChecklistLineChecked,
  readRoadmap,
  ROADMAP_PATH,
} from "./roadmap-phase-status.ts";
import { analyzeWorkflowIrAcceptanceContract } from "./workflow-ir-acceptance-contract.ts";
import { analyzeWorkflowIrParityContract } from "./workflow-ir-parity-contract.ts";
import { analyzeWorkflowSourceContract } from "./workflow-source-contract.ts";
import { renderWorkflowSourceModuleToDot } from "../../packages/factory-core/src/workflow-ir-registry.ts";
import { exportWorkflowSourceDocument } from "../../packages/factory-core/src/workflow-source-registry.ts";

export const PHASE_GOVERNANCE_REPORT_JSON_PATH = "docs/contracts/reopened-phase-governance.json";
export const PHASE_GOVERNANCE_REPORT_MARKDOWN_PATH = "docs/contracts/reopened-phase-governance.md";
export const GOVERNED_SURFACE_OWNER_GATES = Object.freeze([
  "capability_output_contract",
  "governed_output_path_only",
  "capability_output_producer_discovery_fail_closed",
  "capability_output_contract_runtime_parity",
  "workflow_source_contract",
  "governed_execution_dot_input_forbidden",
  "generated_governed_dot_only",
  "factory_composition_contract",
  "factory_local_dot_scope_guard",
  "factory_execution_glue_forbidden",
  "factory_composition_binding_truth",
  "thin_factory_end_state_guard",
  "lineage_governance_contract",
  "lineage_supported_class_truth",
  "lineage_projection_presence",
  "lineage_hot_path_isolation",
]);

const THIN_FACTORY_FORBIDDEN_NODE_TYPES = Object.freeze([
  "agent.worktree",
  "codergen",
  "fan_out.dynamic",
  "fan_in.dynamic",
  "fan_out.detached",
]);

const TARGET_PHASES = Object.freeze([
  {
    heading: "Phase 8.2: Capability Event and Artifact Surfaces",
    checklist: [
      {
        label: "Capability events and artifact outputs are documented and validated.",
        gates: ["capability_output_contract", "capability_output_contract_runtime_parity"],
      },
      {
        label: "Capability telemetry expectations are explicit and enforceable.",
        gates: ["capability_output_contract", "capability_output_contract_runtime_parity"],
      },
      {
        label: "No private capability output surface remains undocumented.",
        gates: ["governed_output_path_only", "capability_output_producer_discovery_fail_closed"],
      },
      {
        label: "Capability outputs do not invent private event, artifact, or telemetry conventions parallel to the platform standards.",
        gates: ["governed_output_path_only", "capability_output_contract_runtime_parity"],
      },
    ],
  },
  {
    heading: "Phase 9.2: DOT Generation and Parity Enforcement",
    checklist: [
      {
        label: "DOT is treated as runtime IR, not canonical source, for migrated families.",
        gates: ["generated_governed_dot_only", "workflow_ir_parity_contract", "no_handwritten_dot_for_migrated_families"],
      },
      {
        label: "Generated IR parity is enforced in CI.",
        gates: ["workflow_ir_parity_contract", "workflow_ir_runtime_parity_e2e"],
      },
      {
        label: "Compiled IR is packaged as a governed artifact class with publication-ready metadata where required.",
        gates: ["workflow_ir_claim_truth", "workflow_ir_publish_or_plan_exclusive"],
      },
      {
        label: "The generator remains a boring deterministic translation layer rather than a second orchestration runtime.",
        gates: ["workflow_ir_runtime_parity_e2e"],
      },
    ],
  },
  {
    heading: "Phase 9.3: Active Workflow Family Migration",
    checklist: [
      {
        label: "Active migrated workflow families are source-authored and DOT-generated.",
        gates: ["generated_governed_dot_only", "workflow_source_contract", "no_handwritten_dot_for_migrated_families"],
      },
      {
        label: "No dual authoring path exists for migrated workflow families.",
        gates: ["generated_governed_dot_only", "workflow_source_contract", "no_handwritten_dot_for_migrated_families"],
      },
      {
        label: "Compatibility shims do not accumulate after migration of a family.",
        gates: ["legacy_pattern_zero_inventory"],
      },
    ],
  },
  {
    heading: "Phase 10: Factory Composition Model",
    checklist: [
      { label: "New factories are mostly composition and configuration.", gates: ["generated_governed_dot_only", "factory_local_dot_scope_guard", "thin_factory_end_state_guard"] },
      { label: "Factory policy surfaces are explicit and typed.", gates: ["factory_composition_contract"] },
      { label: "Factory manifests are generated and inspectable.", gates: ["factory_composition_contract"] },
      { label: "Shared capabilities can be reused with minimal factory-specific glue.", gates: ["generated_governed_dot_only", "factory_composition_binding_truth", "factory_execution_glue_forbidden"] },
      { label: "Factory bootstrap and onboarding are productized.", gates: ["factory_composition_contract"] },
      { label: "New factories do not require a factory-local DSL or private composition substrate beyond the shared model.", gates: ["generated_governed_dot_only", "thin_factory_end_state_guard", "factory_local_dot_scope_guard"] },
    ],
  },
  {
    heading: "Phase 11: Downstream Lineage and Governance",
    checklist: [
      { label: "OpenLineage-compatible outputs exist for supported run and artifact classes.", gates: ["lineage_supported_class_truth", "lineage_projection_presence"] },
      { label: "Downstream lineage consumers can attach without execution-plane changes.", gates: ["lineage_supported_class_truth", "lineage_projection_presence"] },
      { label: "Governance/catalog integrations remain consumers, not dependencies.", gates: ["lineage_governance_contract", "lineage_hot_path_isolation"] },
      { label: "No hot-path control decision requires Marquez, Atlas, or similar systems.", gates: ["lineage_hot_path_isolation"] },
      { label: "No governance integration introduces a second execution-path metadata substrate parallel to the platform contracts/events/artifacts.", gates: ["lineage_hot_path_isolation", "governed_surface_totality"] },
    ],
  },
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function readJson(repoRoot, relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadGraphSemanticsText(repoRoot, relativePath) {
  if (!String(relativePath || "").endsWith(".workflow-source.mjs")) {
    return readText(repoRoot, relativePath);
  }
  const dataPath = String(relativePath).replace(/\.workflow-source\.mjs$/u, ".workflow-source.data.json");
  const workflowSourceData = JSON.parse(readText(repoRoot, dataPath));
  return renderWorkflowSourceModuleToDot(exportWorkflowSourceDocument(workflowSourceData), {
    hostPath: relativePath,
  });
}

function parseThinFactoryGraphDiagnostics(repoRoot, manifest) {
  const diagnostics = [];
  if (manifest.compositionModel !== "thin_composition") return diagnostics;
  const localGraphs = new Set([
    ...manifest.graphBindings.filter((entry) => entry.owner === "factory").map((entry) => entry.path),
    ...(manifest.artifactDefaults?.scheduledGraphs || []),
  ]);
  for (const graphPath of localGraphs) {
    const source = loadGraphSemanticsText(repoRoot, graphPath);
    const localPipelineTargets = Array.from(source.matchAll(/pipeline="([^"]+)"/g), (match) => match[1])
      .filter((entry) => entry.startsWith(`factories/${manifest.factoryId}/`));
    if (localPipelineTargets.length > 0) {
      diagnostics.push(`factory_local_pipeline_target path=${JSON.stringify(graphPath)} targets=${JSON.stringify(sortStrings(localPipelineTargets))}`);
    }
    const forbiddenTypes = Array.from(source.matchAll(/type="([^"]+)"/g), (match) => match[1])
      .filter((entry) => THIN_FACTORY_FORBIDDEN_NODE_TYPES.includes(entry));
    if (forbiddenTypes.length > 0) {
      diagnostics.push(`factory_thin_execution_semantics path=${JSON.stringify(graphPath)} node_types=${JSON.stringify(sortStrings(forbiddenTypes))}`);
    }
  }
  return diagnostics;
}

function auditExampleScannerStub(repoRoot) {
  const readmePath = "factories/example-scanner/README.md";
  if (!existsSync(path.join(repoRoot, readmePath))) return [];
  const source = readText(repoRoot, readmePath);
  if (/does \*\*not\*\* currently own or ship/i.test(source)) {
    return [];
  }
  const diagnostics = [];
  for (const claimedPath of [
    "factory.config.json",
    "kind.json",
    "env.contract.json",
    "instance.template.json",
    "graphs/factory_supervisor_tick.dot",
    "graphs/domain_example_scanner.dot",
  ]) {
    if (source.includes(`\`${claimedPath}\``) && !existsSync(path.join(repoRoot, "factories/example-scanner", claimedPath))) {
      diagnostics.push(`factory_stub_claims_missing_surface factory="example-scanner" surface=${JSON.stringify(claimedPath)}`);
    }
  }
  return diagnostics;
}

function renderMarkdown(report) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-23"',
    'status: "active"',
    'summary: "Reopened phase governance inventory linking checked claims to real gate coverage and transitional-state audits."',
    'tags: [architecture, contracts, generated, governance, roadmap]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Reopened Phase Governance",
    "",
    `- Diagnostics: ${report.summary.diagnostics}`,
    `- Claim mapping diagnostics: ${report.summary.claim_mapping_diagnostics}`,
    `- Legacy inventory diagnostics: ${report.summary.legacy_inventory_diagnostics}`,
    "",
    "## Legacy Inventory",
    "",
    ...Object.entries(report.legacy_inventory).map(([key, value]) => `- \`${key}\`: \`${value}\``),
    "",
    "## Supporting Gate Status",
    "",
    ...Object.entries(report.supporting_gate_status).map(([key, value]) => `- \`${key}\`: \`${value ? "pass" : "fail"}\``),
    "",
    "## Diagnostics",
    "",
    ...(report.diagnostics.length > 0 ? report.diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

export async function analyzeReopenedPhaseGovernance({
  repoRoot = process.cwd(),
  includeWorkflowIrRuntimeParity = true,
  workflowIrAcceptanceAnalysis = null,
  workflowIrAcceptanceAnalyzer = analyzeWorkflowIrAcceptanceContract,
  workflowIrParityAnalysis = null,
  lineageSamplesAnalysis = null,
  capabilityOutputAnalysis = null,
  workflowSourceAnalysis = null,
  factoryCompositionAnalysis = null,
  lineageAnalysis = null,
} = {}) {
  const diagnostics = [];
  const roadmap = readRoadmap(repoRoot);
  const capabilityOutput = capabilityOutputAnalysis || await analyzeCapabilityOutputContract({ repoRoot });
  const workflowSource = workflowSourceAnalysis || await analyzeWorkflowSourceContract({ repoRoot });
  // @context:decision !critical — Phase 10/11 preflight gates only need the
  // reopened claim/inventory model, not full runtime-parity replay. Allow them
  // to skip the hatch validate loop so a single governance check does not spawn
  // a repo-wide validation walk on every hook invocation.
  const workflowIr = workflowIrAcceptanceAnalysis || await workflowIrAcceptanceAnalyzer({
    repoRoot,
    includeRuntimeParity: includeWorkflowIrRuntimeParity,
  });
  const workflowIrParity = workflowIrParityAnalysis || await analyzeWorkflowIrParityContract({ repoRoot });
  const factoryComposition = factoryCompositionAnalysis || await analyzeFactoryCompositionContract({ repoRoot });
  const lineage = lineageAnalysis || await analyzeLineageGovernanceContract({ repoRoot });
  const lineageSamples = lineageSamplesAnalysis || analyzeLineageProjectionSamples();
  const workflowIrRuntimeParityDiagnostics = includeWorkflowIrRuntimeParity
    ? (workflowIr.runtimeParityDiagnostics || [])
    : [...workflowSource.diagnostics, ...workflowIrParity.diagnostics];
  const governedExecutionDotInputForbidden = !workflowSource.diagnostics.some((entry) => /workflow_source_governed_execution_dot_input_forbidden/.test(entry));
  const generatedGovernedDotOnly = !workflowSource.diagnostics.some((entry) =>
    /workflow_source_governed_execution_dot_input_forbidden|workflow_source_governed_execution_dot_exemption_/.test(entry),
  );

  const capabilityLegacyCount = capabilityOutput.report.diagnostics.filter((entry) =>
    capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.governed_output_path_only)
    || capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.capability_output_producer_discovery_fail_closed),
  ).length;

  const factoryManifests = factoryComposition.manifests || [];
  const thinFactoryDiagnostics = factoryManifests.flatMap((manifest) => parseThinFactoryGraphDiagnostics(repoRoot, manifest));
  const exampleScannerStubDiagnostics = auditExampleScannerStub(repoRoot);
  const workflowLegacyCount = workflowSource.diagnostics.filter((entry) => /active_mothership_graph_not_migrated|missing_runtime_graph_marker|runtime_graph_path_drift/.test(entry)).length
    + workflowIr.runtimeParityDiagnostics.length;

  const legacyInventory = {
    private_capability_output_emission: capabilityLegacyCount,
    handwritten_migrated_family_dot: workflowLegacyCount,
    thin_factory_execution_semantics: thinFactoryDiagnostics.length,
    fake_factory_stub_claims: exampleScannerStubDiagnostics.length,
  };
  const noHandwrittenDotForMigratedFamilies = !workflowSource.diagnostics.some((entry) =>
    /workflow_source_active_mothership_graph_not_migrated|workflow_source_missing_runtime_graph_marker|workflow_source_runtime_graph_path_drift|workflow_source_missing_for_runtime_graph/.test(entry),
  );
  const factoryLocalDotScopeGuard = thinFactoryDiagnostics.every((entry) => !entry.startsWith("factory_local_pipeline_target"));
  const factoryExecutionGlueForbidden = thinFactoryDiagnostics.every((entry) => !entry.startsWith("factory_thin_execution_semantics"));
  const factoryCompositionBindingTruth = factoryComposition.report.diagnostics.every((entry) => !entry.startsWith("factory_composition_ungoverned_shared_graph"));
  const thinFactoryEndStateGuard = thinFactoryDiagnostics.length === 0 && exampleScannerStubDiagnostics.length === 0;
  const phase10Section = extractPhaseSection(roadmap, "Phase 10: Factory Composition Model");
  const legacyPatternZeroInventory = Object.entries(legacyInventory).every(([key, count]) => {
    if (count < 1) return true;
    if (key === "thin_factory_execution_semantics" || key === "fake_factory_stub_claims") {
      return !(
        isChecklistLineChecked(phase10Section, "New factories are mostly composition and configuration.")
        || isChecklistLineChecked(phase10Section, "Shared capabilities can be reused with minimal factory-specific glue.")
        || isChecklistLineChecked(phase10Section, "New factories do not require a factory-local DSL or private composition substrate beyond the shared model.")
      );
    }
    return false;
  });
  const lineageSupportedClassTruth = lineage.diagnostics.every((entry) =>
    !entry.startsWith("lineage_missing_run_class")
    && !entry.startsWith("lineage_missing_artifact_class")
    && !entry.startsWith("lineage_registry_"),
  );
  const lineageHotPathIsolation = lineage.diagnostics.every((entry) =>
    !entry.startsWith("lineage_hot_path_governance_dependency")
    && !entry.startsWith("lineage_duplicate_projection_owner"),
  );
  const reportSupportingGateStatus = {
    capability_output_contract: capabilityOutput.ok,
    governed_output_path_only: capabilityOutput.report.diagnostics.every((entry) =>
      !capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.governed_output_path_only),
    ),
    capability_output_producer_discovery_fail_closed: capabilityOutput.report.diagnostics.every((entry) =>
      !capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.capability_output_producer_discovery_fail_closed),
    ),
    capability_output_contract_runtime_parity: capabilityOutput.report.diagnostics.every((entry) =>
      !capabilityOutputDiagnosticMatchesMode(entry, CAPABILITY_OUTPUT_GATE_MODES.capability_output_contract_runtime_parity),
    ),
    workflow_source_contract: workflowSource.ok,
    governed_execution_dot_input_forbidden: governedExecutionDotInputForbidden,
    generated_governed_dot_only: generatedGovernedDotOnly,
    no_handwritten_dot_for_migrated_families: noHandwrittenDotForMigratedFamilies,
    workflow_ir_acceptance: workflowIr.ok,
    workflow_ir_claim_truth: workflowIr.claimTruthDiagnostics.length === 0,
    workflow_ir_publish_or_plan_exclusive: workflowIr.publishStateDiagnostics.length === 0,
    workflow_ir_runtime_parity_e2e: workflowIrRuntimeParityDiagnostics.length === 0,
    workflow_ir_parity_contract: workflowIrParity.diagnostics.length === 0,
    factory_composition_contract: factoryComposition.ok,
    factory_local_dot_scope_guard: factoryLocalDotScopeGuard,
    factory_execution_glue_forbidden: factoryExecutionGlueForbidden,
    factory_composition_binding_truth: factoryCompositionBindingTruth,
    thin_factory_end_state_guard: thinFactoryEndStateGuard,
    legacy_pattern_zero_inventory: legacyPatternZeroInventory,
    lineage_governance_contract: lineage.ok,
    lineage_supported_class_truth: lineageSupportedClassTruth,
    lineage_projection_presence: lineageSamples.ok,
    lineage_hot_path_isolation: lineageHotPathIsolation,
  };
  reportSupportingGateStatus.governed_surface_totality = GOVERNED_SURFACE_OWNER_GATES
    .every((gateId) => reportSupportingGateStatus[gateId] === true);

  diagnostics.push(...lineageSamples.diagnostics.map((entry) => `lineage_projection_presence ${entry}`));

  for (const phase of TARGET_PHASES) {
    const section = extractPhaseSection(roadmap, phase.heading);
    for (const item of phase.checklist) {
      if (hasConflictingChecklistState(section, item.label)) {
        diagnostics.push(`phase_claim_conflicting_checklist_state phase=${JSON.stringify(phase.heading)} claim=${JSON.stringify(item.label)}`);
      }
      if (isChecklistLineChecked(section, item.label)) {
        const lineGateIds = new Set(extractChecklistGateIds(section, item.label));
        for (const gateId of item.gates) {
          if (!lineGateIds.has(gateId)) {
            diagnostics.push(`phase_claim_missing_gate_reference phase=${JSON.stringify(phase.heading)} claim=${JSON.stringify(item.label)} gate=${JSON.stringify(gateId)}`);
          }
          if (!(gateId in reportSupportingGateStatus)) {
            diagnostics.push(`phase_claim_missing_gate_status phase=${JSON.stringify(phase.heading)} claim=${JSON.stringify(item.label)} gate=${JSON.stringify(gateId)}`);
          }
        }
      }
    }
  }

  const report = {
    schema_version: "reopened_phase_governance/v1",
    summary: {
      diagnostics: diagnostics.length,
      claim_mapping_diagnostics: diagnostics.filter((entry) =>
        entry.startsWith("phase_claim_missing_gate_reference")
        || entry.startsWith("phase_claim_missing_gate_status")
        || entry.startsWith("phase_claim_conflicting_checklist_state")
      ).length,
      legacy_inventory_diagnostics: diagnostics.filter((entry) =>
        !entry.startsWith("phase_claim_missing_gate_reference")
        && !entry.startsWith("phase_claim_missing_gate_status")
        && !entry.startsWith("phase_claim_conflicting_checklist_state")
      ).length,
    },
    legacy_inventory: legacyInventory,
    legacy_inventory_details: {
      thin_factory_execution_semantics: thinFactoryDiagnostics,
      fake_factory_stub_claims: exampleScannerStubDiagnostics,
    },
    diagnostics: sortStrings(diagnostics),
    supporting_gate_status: reportSupportingGateStatus,
  };

  return {
    ok: diagnostics.length === 0,
    diagnostics: report.diagnostics,
    report,
    renderedJson: stableJson(report),
    renderedMarkdown: `${renderMarkdown(report)}\n`,
  };
}

export async function writeReopenedPhaseGovernance({ repoRoot = process.cwd() } = {}) {
  const analysis = await analyzeReopenedPhaseGovernance({ repoRoot });
  writeFileSync(path.join(repoRoot, PHASE_GOVERNANCE_REPORT_JSON_PATH), analysis.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, PHASE_GOVERNANCE_REPORT_MARKDOWN_PATH), analysis.renderedMarkdown, "utf8");
  return analyzeReopenedPhaseGovernance({ repoRoot });
}
