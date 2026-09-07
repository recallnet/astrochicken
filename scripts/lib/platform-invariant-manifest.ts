function wildcardPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesPlatformInvariantPattern(pathValue, pattern) {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
  }

  if (pattern.includes("*")) {
    return wildcardPatternToRegex(pattern).test(pathValue);
  }

  return pathValue === pattern;
}

function npmScript(scriptName) {
  return Object.freeze({
    command: "pnpm",
    args: Object.freeze(["run", "--silent", scriptName]),
    script: scriptName,
  });
}

function validateManifest(manifest, label) {
  const ids = new Set();
  for (const invariant of manifest) {
    if (ids.has(invariant.id)) {
      throw new Error(`Duplicate ${label} id: ${invariant.id}`);
    }
    ids.add(invariant.id);
    if (!Number.isInteger(invariant.priority)) {
      throw new Error(`${label} '${invariant.id}' has non-integer priority`);
    }
    if (!Array.isArray(invariant.triggerGlobs) || invariant.triggerGlobs.length === 0) {
      throw new Error(`${label} '${invariant.id}' must declare non-empty triggerGlobs`);
    }
    if (!invariant.check || typeof invariant.check.command !== "string" || !Array.isArray(invariant.check.args)) {
      throw new Error(`${label} '${invariant.id}' has invalid check command metadata`);
    }
  }
}

function sortByPriorityThenId(left, right) {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  return left.id.localeCompare(right.id, "en");
}

export const PLATFORM_INVARIANT_MANIFEST = Object.freeze([
  Object.freeze({
    id: "scaffold_contract",
    priority: 10,
    description: "Scaffolded factory output and benchmark-telemetry conformance are shipped product contracts.",
    triggerGlobs: Object.freeze([
      "apps/hatch/src/factory/**",
      "factories/_templates/**",
      "factories/mothership/factory.config.json",
      "factory-registry.json",
      "scripts/check-scaffolded-factory-contract.ts",
      "scripts/check-scaffolded-factory-contract.integration.test.ts",
      "scripts/factory-health-check.mjs",
      "scripts/factory-health-check.integration.test.mjs",
      "scripts/verify-scaffolded-factory-conformance.mjs",
      "scripts/verify-scaffolded-factory-conformance.test.mjs",
      "scripts/lib/normalize-scaffold-tree.ts",
      "scripts/test/golden/scaffolded-factory-structure.json",
    ]),
    check: npmScript("test:platform:scaffold-contract"),
  }),
  Object.freeze({
    id: "cli_context_portability",
    priority: 20,
    description: "CLI context propagation and portability contracts stay stable.",
    triggerGlobs: Object.freeze([
      ".githooks/**",
      "scripts/**",
      "apps/hatch/src/pipeline/handler/pipeline.ts",
      "apps/hatch/src/pipeline/handler/pipeline-parent-context.test.ts",
      "apps/hatch/src/cli-run-config.test.ts",
      "apps/hatch/src/runs-context-portability.integration.test.ts",
      "packages/factory-ops/test/supervisor/factory-context-resolution-cli.cli.test.ts",
      "packages/factory-ops/test/supervisor/factory-cli-context-portability-spawn.integration.test.ts",
      "apps/hatch/src/pipeline/tool-env.ts",
    ]),
    check: npmScript("test:platform:cli-context-portability"),
  }),
  Object.freeze({
    id: "external_factory_compat",
    priority: 30,
    description: "External-factory config/repo compatibility contracts remain intact.",
    triggerGlobs: Object.freeze([
      "examples/external-factories/**",
      "packages/factory-telemetry/**",
      "packages/factory-ops/src/commands/common-resolve-gh-repo.ts",
      "packages/factory-ops/src/commands/factory-config-loader.ts",
      "packages/factory-ops/src/commands/goal-parse-external-bug-report.ts",
      "packages/factory-ops/src/commands/reviewer-context-contract.ts",
      "packages/factory-ops/src/lib/command-owners/reviewer-context-contract.ts",
      "packages/factory-ops/test/supervisor/factory-config-resolver.test.ts",
      "packages/factory-ops/test/supervisor/factory-daemon-config.contract.test.ts",
    ]),
    check: npmScript("test:platform:external-factory-compat"),
  }),
  Object.freeze({
    id: "managed-factory-config-surfaces",
    priority: 31,
    description: "Managed factory kind/registry config surfaces remain on the post-#2102 schema and reject legacy target_repo fields.",
    triggerGlobs: Object.freeze([
      "factory-registry.json",
      "factories/*/kind.json",
      "factories/*/factory.config.json",
      "scripts/check-managed-factory-config-surfaces.ts",
      "scripts/check-managed-factory-config-surfaces.unit.test.ts",
      "scripts/test/fixtures/managed-factory-configs/**",
    ]),
    check: npmScript("test:platform:managed-factory-config-surfaces"),
  }),
  Object.freeze({
    id: "factory_env_contracts",
    priority: 31,
    description: "Every checked-in factory keeps a machine-readable env contract and generated .env.example in sync with factory-owned env references.",
    triggerGlobs: Object.freeze([
      "config/testing/factory-env/**",
      "factories/*/.env.example",
      "factories/*/README.md",
      "factories/*/env.contract.json",
      "factories/*/factory.config.json",
      "factories/*/instance.template.json",
      "factories/*/policy-pack/**",
      "scripts/check-factory-env-contracts.ts",
      "scripts/check-factory-env-contracts.unit.test.ts",
      "scripts/test/fixtures/factory-env-contracts/**",
    ]),
    check: npmScript("test:platform:factory-env-contracts"),
  }),
  Object.freeze({
    id: "provisioning_drift",
    priority: 31,
    description: "Provisioning drift checks stay aligned with managed factory kind contracts and home-repo assets.",
    triggerGlobs: Object.freeze([
      "factory-registry.json",
      "factories/*/kind.json",
      "factories/*/factory.config.json",
      "factories/*/instance.template.json",
      "factories/*/issue_templates/*",
      "scripts/check-provisioning-drift.ts",
      "scripts/test/check-provisioning-drift.unit.test.mjs",
      "packages/factory-ops/src/commands/factory-provision-repo.ts",
      "packages/factory-ops/src/commands/factory-provisioning-drift.ts",
      "packages/factory-ops/src/lib/factory-provisioning-contract.ts",
      "packages/factory-ops/src/lib/factory-provisioning-drift.ts",
      "packages/factory-ops/test/supervisor/factory-provisioning-drift.contract.test.ts",
      "packages/factory-ops/test/supervisor/supervisor-state-snapshot-provisioning-drift.unit.test.ts",
      "packages/factory-ops/src/commands/supervisor-state-snapshot-actions.ts",
    ]),
    check: npmScript("test:platform:provisioning-drift"),
  }),
  Object.freeze({
    id: "external_factory_portability_matrix",
    priority: 32,
    description: "Dual-context portability matrix (skill loading, scenario resolution, supervisor snapshot context, telemetry identity) exercises both mothership and external-factory fixture.",
    triggerGlobs: Object.freeze([
      "apps/hatch/src/factory/**",
      "apps/hatch/src/pipeline/context.ts",
      "apps/hatch/src/pipeline/scenarios.ts",
      "examples/external-factories/**",
      "factories/mothership/factory.config.json",
      "factories/mothership/skills/**",
      "factories/mothership/scenarios/**",
      "apps/hatch/src/factory/external-factory-portability.contract.test.ts",
      "apps/hatch/src/factory/supervisor-snapshot-context-portability.contract.test.ts",
    ]),
    check: npmScript("test:platform:external-factory-portability-matrix"),
  }),
  Object.freeze({
    id: "external_factory_smoke",
    priority: 33,
    description: "External-consumer smoke test: conformance harness passes for acme-support factory fixture isolated in a temp dir outside the monorepo.",
    triggerGlobs: Object.freeze([
      "examples/external-factories/**",
      "scripts/check-external-factory-smoke.ts",
      "apps/hatch/src/factory/conformance-harness.ts",
      "apps/hatch/src/factory/conformance-runtime-inputs.ts",
    ]),
    check: npmScript("test:platform:external-factory-smoke"),
  }),
  Object.freeze({
    id: "factory_public_contract",
    priority: 34,
    description: "Public factory contract schema/docs/template/onboarding surfaces remain aligned for standalone adopters.",
    triggerGlobs: Object.freeze([
      "docs/contracts/factory-public-contract.v1.json",
      "docs/reference/factory-public-contract.md",
      "docs/runbooks/external-factory-operator-onboarding.md",
      "factories/_templates/factory/factory.config.json.template",
      "scripts/check-factory-public-contract.ts",
      "scripts/check-factory-public-contract.unit.test.ts",
      "scripts/test/fixtures/factory-public-contract/**",
      "apps/hatch/src/factory/public-factory-contract.contract.test.ts",
    ]),
    check: npmScript("test:platform:factory-public-contract"),
  }),
  Object.freeze({
    id: "runtime_external_entrypoints_contract",
    priority: 34,
    description: "External runtime package ownership/version/bin/stable-entrypoint manifest stays aligned with published packages.",
    triggerGlobs: Object.freeze([
      "docs/contracts/runtime-release-manifest.json",
      "docs/architecture/runtime-external-entrypoints.md",
      "docs/contracts/README.md",
      "apps/hatch/package.json",
      "packages/factory-ops/package.json",
      "packages/factory-telemetry/package.json",
      "packages/factory-ops/test/commands/runtime-release-manifest.contract.test.ts",
      "scripts/check-runtime-external-entrypoints-contract.ts",
    ]),
    check: npmScript("test:platform:runtime-external-entrypoints-contract"),
  }),
  Object.freeze({
    id: "factory_registry_consistency",
    priority: 34,
    description: "Managed-factory registry entries resolve to declared kinds with unique instance ids and allowed lifecycle status values.",
    triggerGlobs: Object.freeze([
      "factory-registry.json",
      "factories/*/kind.json",
      "scripts/check-factory-registry-consistency.ts",
      "scripts/check-factory-registry-consistency.unit.test.ts",
      "scripts/test/fixtures/managed-factory-registry/**",
    ]),
    check: npmScript("test:platform:factory-registry-consistency"),
  }),
  Object.freeze({
    id: "managed_supervisor_shell_contract",
    priority: 35,
    description: "Managed-factory shared supervisor shell contract remains aligned across DOT shell lifecycle nodes, enum surfaces, and managed kind references.",
    triggerGlobs: Object.freeze([
      "packages/factory-runtime/graphs/*.dot",
      "factories/*/kind.json",
      "factories/*/graphs/factory_supervisor_tick.dot",
      "packages/factory-ops/src/lib/external-factory-control-state.ts",
      "packages/factory-ops/src/commands/supervisor-external-factory-lifecycle.ts",
      "scripts/check-managed-supervisor-shell-contract.ts",
      "scripts/check-managed-supervisor-shell-contract.unit.test.ts",
      "scripts/test/fixtures/managed-supervisor-shell-contract/**",
    ]),
    check: npmScript("test:platform:managed-supervisor-shell-contract"),
  }),
  Object.freeze({
    id: "managed-factory-telemetry-contract",
    priority: 36,
    description: "Managed factory telemetry event payloads and daemon state snapshot schema remain aligned with the canonical telemetry fixture.",
    triggerGlobs: Object.freeze([
      "packages/factory-runtime/**",
      "packages/factory-ops/src/lib/daemon.ts",
      "scripts/check-managed-factory-telemetry-contract.ts",
      "scripts/check-managed-factory-telemetry-contract.unit.test.ts",
      "scripts/lib/platform-invariant-telemetry.ts",
      "scripts/fixtures/managed-factory-telemetry-contract/**",
    ]),
    check: npmScript("test:platform:managed-factory-telemetry-contract"),
  }),
  Object.freeze({
    id: "factory_portability",
    priority: 36,
    description: "Shared factory context and operator status portability contracts remain stable.",
    triggerGlobs: Object.freeze([
      "packages/factory-ops/src/lib/factory-context-resolver.ts",
      "packages/factory-ops/src/lib/runs-dir-resolver.ts",
      "packages/factory-ops/src/commands/factory-status.ts",
      "packages/factory-ops/src/commands/factory-tick-status.ts",
      "packages/factory-ops/src/commands/common-resolve-default.ts",
      "packages/factory-ops/src/cli/commands/factory.ts",
      "packages/factory-ops/src/cli/commands/common.ts",
      "packages/factory-ops/test/supervisor/factory-context-resolution-cli.contract.test.ts",
      "packages/factory-ops/test/supervisor/factory-status.contract.test.ts",
      "packages/factory-ops/test/supervisor/factory-tick-status.contract.test.ts",
      "packages/factory-ops/test/commands/runs-dir-resolution.test.ts",
      "scripts/check-factory-portability-contract.ts",
    ]),
    check: npmScript("test:platform:factory-portability"),
  }),
  Object.freeze({
    id: "managed-factory-mutation-boundaries",
    priority: 36,
    description: "Managed factory graphs must not mutate control-plane repos, label contracts must include managed labels, and incident fingerprint schema fields stay stable.",
    triggerGlobs: Object.freeze([
      "factories/*/graphs/*.dot",
      "docs/contracts/factory-label-contract.json",
      "packages/factory-ops/src/commands/supervisor-artifact.ts",
      "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
      "packages/factory-ops/src/lib/incident-packet.ts",
      "scripts/check-managed-factory-mutation-boundaries.ts",
      "scripts/check-managed-factory-mutation-boundaries.unit.test.ts",
      "scripts/test/fixtures/managed-factory-mutation-boundaries/**",
      "scripts/test/golden/managed-boundary-violation.dot",
    ]),
    check: npmScript("test:platform:managed-factory-mutation-boundaries"),
  }),
  Object.freeze({
    id: "factory_shared_surfaces",
    priority: 36,
    description: "Managed shared factory graph surfaces stay materialized from their canonical templates.",
    triggerGlobs: Object.freeze([
      "factories/_shared/**",
      "packages/capability-release-reporting/**",
      "scripts/check-factory-shared-surface-contract.ts",
      "scripts/lib/factory-shared-surface-manifest.ts",
      "scripts/sync-shared-factory-surfaces.integration.test.mjs",
      "scripts/sync-shared-factory-surfaces.mjs",
    ]),
    check: npmScript("test:platform:factory-shared-surfaces"),
  }),
  Object.freeze({
    id: "factory_shared_surface_consumption",
    priority: 37,
    description: "Contract test: external standalone repo can consume shared platform surfaces via external-root sync, detect drift, and self-heal.",
    triggerGlobs: Object.freeze([
      "factories/_shared/surfaces/**",
      "scripts/sync-shared-factory-surfaces.mjs",
      "scripts/lib/factory-shared-surface-manifest.ts",
      "scripts/external-factory-shared-surface-consumption.contract.test.mjs",
      "scripts/check-shared-surface-external-layout.ts",
    ]),
    check: npmScript("test:platform:external-factory-compat"),
  }),
  Object.freeze({
    id: "factory_shared_surface_manifest",
    priority: 37,
    description: "Versioned shared-surface manifest snapshot stays in sync with live manifest.",
    triggerGlobs: Object.freeze([
      "docs/contracts/shared-surface-manifest.json",
      "factories/_shared/surfaces/**",
      "scripts/check-shared-surface-manifest-contract.ts",
      "scripts/lib/factory-shared-surface-manifest.ts",
    ]),
    check: npmScript("test:platform:shared-surface-manifest"),
  }),
  Object.freeze({
    id: "factory_label_contract",
    priority: 38,
    description: "Factory label registry, overlays, and raw-label boundary contracts remain deterministic.",
    triggerGlobs: Object.freeze([
      "docs/contracts/factory-label-contract.json",
      "factories/*/graphs/**",
      "packages/factory-ops/src/cli/commands/labels.ts",
      "packages/factory-ops/src/cli/commands/goal-issue.ts",
      "packages/factory-ops/src/cli/commands/goal-run.ts",
      "packages/factory-ops/src/commands/labels-normalize.ts",
      "packages/factory-ops/src/commands/quarantine-status.ts",
      "packages/factory-ops/src/commands/release-manifest.ts",
      "packages/factory-ops/src/commands/wave-ensure-labels.ts",
      "packages/factory-ops/src/lib/command-owners/release-manifest.ts",
      "packages/factory-ops/src/lib/factory-label-contract.ts",
      "packages/factory-ops/test/factory-label-*.test.mjs",
      "packages/factory-ops/test/supervisor/factory-label-contract.unit.test.ts",
      "scripts/check-factory-label-contract.ts",
      "scripts/check-factory-label-contract.unit.test.ts",
    ]),
    check: npmScript("test:platform:factory-label-contract"),
  }),
  Object.freeze({
    id: "managed_factory_telemetry_contract",
    priority: 39,
    description: "Managed-factory run summaries retain the structured telemetry event and identity fields required for fleet operations.",
    triggerGlobs: Object.freeze([
      "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
      "packages/factory-ops/src/commands/supervisor-managed-emit-run-summary.ts",
      "packages/factory-ops/src/commands/supervisor-managed-summary.ts",
      "packages/factory-ops/test/supervisor/supervisor-managed-ops.unit.test.ts",
      "scripts/check-managed-factory-telemetry-contract.ts",
      "scripts/check-managed-factory-telemetry-contract.unit.test.ts",
    ]),
    check: npmScript("test:platform:managed-factory-telemetry-contract"),
  }),
  Object.freeze({
    id: "supervisor_recovery",
    priority: 40,
    description: "Supervisor-owned recovery and graph-level remediation invariants hold.",
    triggerGlobs: Object.freeze([
      "factories/mothership/graphs/**",
      "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
      "docs/contracts/packet-registry.json",
      "apps/hatch/src/pipeline/graph-recovery-invariants.ts",
      "packages/factory-ops/src/commands/goal-decomposition-packet.ts",
      "packages/factory-ops/src/commands/factory-recovery-sweep.ts",
      "packages/factory-ops/src/commands/human-blocker.ts",
      "packages/factory-ops/src/commands/supervisor-*.mjs",
      "packages/factory-ops/src/lib/command-owners/goal-hard-planning.ts",
      "packages/factory-ops/src/lib/command-owners/judge-context-contract.ts",
      "packages/factory-ops/src/lib/command-owners/judge-evidence-contract.ts",
      "packages/factory-ops/src/lib/command-owners/reviewer-context-contract.ts",
      "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
      "packages/factory-ops/src/lib/*packet*.mjs",
      "packages/factory-ops/src/lib/factory-contract-drift.ts",
      "packages/factory-ops/test/packets/goal-decomposition-packet.unit.test.ts",
      "packages/factory-ops/test/supervisor/factory-recovery-sweep.contract.test.ts",
      "packages/factory-ops/test/commands/human-blocker.test.ts",
      "packages/factory-ops/test/commands/incident-packet.test.ts",
      "packages/factory-ops/test/packets/packet-core.unit.test.ts",
      "packages/factory-ops/test/supervisor/*.test.mjs",
      "packages/factory-ops/test/supervisor/fixtures/state-machines/external-factory-lifecycle.machine.json",
      "scripts/check-goal-packet-contract.ts",
      "scripts/check-graph-recovery-contracts.ts",
      "scripts/check-named-packet-contract.ts",
      "scripts/check-packet-registry-contract.ts",
      "scripts/check-packet-takeover-contract.ts",
      "scripts/check-packet-takeover-contract.unit.test.ts",
    ]),
    check: npmScript("test:platform:supervisor-recovery"),
  }),
  Object.freeze({
    id: "docs_skills_templates",
    priority: 50,
    description: "Docs/skills/template contracts that define runtime behavior remain aligned.",
    triggerGlobs: Object.freeze([
      "docs/skills/**",
      "docs/templates/**",
      "factories/mothership/skills/**",
      "packages/factory-ops/test/commands/hatch-factory-architect-skill-contract.test.ts",
      "scripts/factory-architect-subagent.test.mjs",
      "scripts/lib/docs-template-framework.ts",
    ]),
    check: npmScript("test:platform:docs-skills-templates"),
  }),
]);

const PLATFORM_INVARIANT_BY_ID = new Map(PLATFORM_INVARIANT_MANIFEST.map((invariant) => [invariant.id, invariant]));

function releaseQualityFamilyFromInvariant({
  id,
  priority,
  sourceInvariantId,
  description,
  evidenceRole,
}) {
  const sourceInvariant = PLATFORM_INVARIANT_BY_ID.get(sourceInvariantId);
  if (!sourceInvariant) {
    throw new Error(`Unknown platform invariant source for release_quality family '${id}': ${sourceInvariantId}`);
  }

  return Object.freeze({
    id,
    priority,
    sourceInvariantId,
    description,
    evidenceRole,
    triggerGlobs: sourceInvariant.triggerGlobs,
    check: sourceInvariant.check,
  });
}

/**
 * Release-quality evidence set.
 *
 * Each family reuses a single existing invariant command so the release gate
 * integrates existing contract suites without creating duplicate runners.
 */
export const RELEASE_QUALITY_FAMILY_MANIFEST = Object.freeze([
  releaseQualityFamilyFromInvariant({
    id: "core_invariants",
    priority: 10,
    sourceInvariantId: "cli_context_portability",
    description: "Core runtime/CLI invariants remain deterministic.",
    evidenceRole: "Proves the shared execution substrate (context wiring + runtime identity) is stable.",
  }),
  releaseQualityFamilyFromInvariant({
    id: "recovery_graph_invariants",
    priority: 20,
    sourceInvariantId: "supervisor_recovery",
    description: "Recovery graph contracts remain enforceable.",
    evidenceRole: "Proves supervisor recovery invariants still self-heal and route deterministically.",
  }),
  releaseQualityFamilyFromInvariant({
    id: "scaffold_golden_conformance",
    priority: 30,
    sourceInvariantId: "scaffold_contract",
    description: "Scaffold templates keep golden output compatibility.",
    evidenceRole: "Proves generated factory outputs still conform to shipped scaffold contracts.",
  }),
  releaseQualityFamilyFromInvariant({
    id: "external_factory_portability",
    priority: 40,
    sourceInvariantId: "factory_portability",
    description: "External-factory portability matrix contracts stay intact.",
    evidenceRole: "Proves shared factory context/status contracts remain portable across factory contexts.",
  }),
  releaseQualityFamilyFromInvariant({
    id: "external_factory_portability_matrix",
    priority: 45,
    sourceInvariantId: "external_factory_portability_matrix",
    description: "Dual-context portability matrix stays intact across shared runtime changes.",
    evidenceRole: "Proves external-factory skill/scenario/snapshot/telemetry context contracts match mothership behavior.",
  }),
  releaseQualityFamilyFromInvariant({
    id: "docs_skills_template_contracts",
    priority: 50,
    sourceInvariantId: "docs_skills_templates",
    description: "Contract-bearing docs/skills/templates stay aligned.",
    evidenceRole: "Proves live docs/skills/template contracts still match runtime behavior.",
  }),
]);

validateManifest(PLATFORM_INVARIANT_MANIFEST, "Platform invariant");
validateManifest(RELEASE_QUALITY_FAMILY_MANIFEST, "Release-quality family");

export const PLATFORM_INVARIANT_TRIGGER_GLOBS = Object.freeze(
  [...new Set(PLATFORM_INVARIANT_MANIFEST.flatMap((invariant) => invariant.triggerGlobs))].sort((left, right) => left.localeCompare(right, "en")),
);

export const RELEASE_QUALITY_TRIGGER_GLOBS = Object.freeze(
  [...new Set(RELEASE_QUALITY_FAMILY_MANIFEST.flatMap((family) => family.triggerGlobs))].sort((left, right) => left.localeCompare(right, "en")),
);

export function resolvePlatformInvariantMatches(stagedPaths) {
  const matches = [];

  for (const invariant of PLATFORM_INVARIANT_MANIFEST) {
    const matchedPaths = stagedPaths.filter((pathValue) =>
      invariant.triggerGlobs.some((pattern) => matchesPlatformInvariantPattern(pathValue, pattern)),
    );

    if (matchedPaths.length === 0) {
      continue;
    }

    matches.push({
      ...invariant,
      matchedPaths,
    });
  }

  return matches.sort(sortByPriorityThenId);
}

export function isReleaseQualityTriggerPath(pathValue) {
  return RELEASE_QUALITY_TRIGGER_GLOBS.some((pattern) => matchesPlatformInvariantPattern(pathValue, pattern));
}

export function resolveReleaseQualityGatePlan(stagedPaths) {
  const matchedPaths = [...new Set(stagedPaths.filter((pathValue) => isReleaseQualityTriggerPath(pathValue)))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );

  if (matchedPaths.length === 0) {
    return {
      shouldRun: false,
      matchedPaths: [],
      families: [],
    };
  }

  return {
    shouldRun: true,
    matchedPaths,
    families: [...RELEASE_QUALITY_FAMILY_MANIFEST].sort(sortByPriorityThenId),
  };
}
