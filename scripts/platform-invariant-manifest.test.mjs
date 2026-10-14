import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_INVARIANT_MANIFEST,
  RELEASE_QUALITY_FAMILY_MANIFEST,
  RELEASE_QUALITY_TRIGGER_GLOBS,
  isReleaseQualityTriggerPath,
  resolvePlatformInvariantMatches,
  matchesPlatformInvariantPattern,
  resolveReleaseQualityGatePlan,
} from "./lib/platform-invariant-manifest.ts";

const PLATFORM_INVARIANT_BY_ID = new Map(PLATFORM_INVARIANT_MANIFEST.map((entry) => [entry.id, entry]));

test("release-quality families map to existing invariant commands in deterministic order", () => {
  const expected = [
    ["core_invariants", "cli_context_portability", "test:platform:cli-context-portability"],
    ["recovery_graph_invariants", "supervisor_recovery", "test:platform:supervisor-recovery"],
    ["scaffold_golden_conformance", "scaffold_contract", "test:platform:scaffold-contract"],
    ["external_factory_portability", "factory_portability", "test:platform:factory-portability"],
    ["external_factory_portability_matrix", "external_factory_portability_matrix", "test:platform:external-factory-portability-matrix"],
    ["docs_skills_template_contracts", "docs_skills_templates", "test:platform:docs-skills-templates"],
  ];

  assert.deepEqual(RELEASE_QUALITY_FAMILY_MANIFEST.map((entry) => entry.id), expected.map(([id]) => id));

  for (const [familyId, sourceInvariantId, scriptName] of expected) {
    const family = RELEASE_QUALITY_FAMILY_MANIFEST.find((entry) => entry.id === familyId);
    const sourceInvariant = PLATFORM_INVARIANT_BY_ID.get(sourceInvariantId);

    assert.ok(family, `${familyId} should exist`);
    assert.ok(sourceInvariant, `${sourceInvariantId} should exist`);
    assert.equal(family.sourceInvariantId, sourceInvariantId);
    assert.equal(family.check.script, scriptName);
    assert.equal(family.check, sourceInvariant.check);
    assert.equal(family.triggerGlobs, sourceInvariant.triggerGlobs);
    assert.equal(typeof family.evidenceRole, "string");
    assert.equal(family.evidenceRole.length > 0, true);
  }
});

test("release-quality trigger matcher is deterministic and excludes non-release families", () => {
  assert.equal(RELEASE_QUALITY_TRIGGER_GLOBS.length > 0, true);

  assert.equal(isReleaseQualityTriggerPath("scripts/pre-commit-staged-file-classifier.mjs"), true);
  assert.equal(isReleaseQualityTriggerPath("factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"), true);
  assert.equal(isReleaseQualityTriggerPath("factories/_templates/factory/factory.config.json.template"), true);
  assert.equal(isReleaseQualityTriggerPath("packages/factory-ops/src/commands/factory-status.ts"), true);
  assert.equal(isReleaseQualityTriggerPath("packages/factory-ops/src/cli/commands/common.ts"), true);
  assert.equal(isReleaseQualityTriggerPath("packages/factory-ops/src/commands/common-resolve-default.ts"), true);
  assert.equal(isReleaseQualityTriggerPath("docs/templates/architecture.md.tmpl"), true);

  assert.equal(isReleaseQualityTriggerPath("packages/factory-ops/src/commands/common-resolve-gh-repo.ts"), false);
  assert.equal(isReleaseQualityTriggerPath("context/notes.txt"), false);
});

test("release-quality gate plan runs all families once when relevant and skips otherwise", () => {
  const skipped = resolveReleaseQualityGatePlan(["context/notes.txt"]);
  assert.deepEqual(skipped, {
    shouldRun: false,
    matchedPaths: [],
    families: [],
  });

  const runnable = resolveReleaseQualityGatePlan([
    "docs/templates/architecture.md.tmpl",
    "docs/templates/architecture.md.tmpl",
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);

  assert.equal(runnable.shouldRun, true);
  assert.deepEqual(runnable.matchedPaths, [
    "docs/templates/architecture.md.tmpl",
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);
  assert.deepEqual(
    runnable.families.map((entry) => entry.id),
    RELEASE_QUALITY_FAMILY_MANIFEST.map((entry) => entry.id),
  );
});

test("external example assets map to compat + matrix + smoke invariants", () => {
  const matches = resolvePlatformInvariantMatches([
    "examples/external-factories/acme-support/factory.config.json",
  ]);

  assert.deepEqual(matches.map((entry) => entry.id), [
    "external_factory_compat",
    "external_factory_portability_matrix",
    "external_factory_smoke",
  ]);
});

test("factory public contract surfaces map to factory_public_contract invariant", () => {
  const schemaMatches = resolvePlatformInvariantMatches([
    "docs/contracts/factory-public-contract.v1.json",
  ]);
  assert.deepEqual(schemaMatches.map((entry) => entry.id), ["factory_public_contract"]);

  const templateMatches = resolvePlatformInvariantMatches([
    "factories/_templates/factory/factory.config.json.template",
  ]);
  assert.deepEqual(templateMatches.map((entry) => entry.id), ["scaffold_contract", "factory_public_contract"]);
});

test("runtime external entrypoint surfaces map to runtime_external_entrypoints_contract invariant", () => {
  const manifestMatches = resolvePlatformInvariantMatches([
    "docs/contracts/runtime-release-manifest.json",
  ]);
  assert.deepEqual(manifestMatches.map((entry) => entry.id), ["runtime_external_entrypoints_contract"]);

  const packageMatches = resolvePlatformInvariantMatches([
    "apps/hatch/package.json",
  ]);
  assert.deepEqual(packageMatches.map((entry) => entry.id), ["runtime_external_entrypoints_contract"]);
});

test("managed factory config surfaces map to managed-factory-config-surfaces invariant", () => {
  const registryMatches = resolvePlatformInvariantMatches([
    "factory-registry.json",
  ]);
  assert.deepEqual(registryMatches.map((entry) => entry.id), ["scaffold_contract", "managed-factory-config-surfaces", "provisioning_drift", "factory_registry_consistency"]);

  const kindMatches = resolvePlatformInvariantMatches([
    "factories/brainstorm/kind.json",
  ]);
  assert.deepEqual(kindMatches.map((entry) => entry.id), ["managed-factory-config-surfaces", "provisioning_drift", "factory_registry_consistency", "managed_supervisor_shell_contract"]);

  const configMatches = resolvePlatformInvariantMatches([
    "factories/brainstorm/factory.config.json",
  ]);
  assert.deepEqual(configMatches.map((entry) => entry.id), ["factory_env_contracts", "managed-factory-config-surfaces", "provisioning_drift"]);
});

test("factory env contract surfaces map to factory_env_contracts invariant", () => {
  const contractMatches = resolvePlatformInvariantMatches([
    "factories/mothership/env.contract.json",
  ]);
  assert.deepEqual(contractMatches.map((entry) => entry.id), ["factory_env_contracts"]);

  const exampleMatches = resolvePlatformInvariantMatches([
    "factories/mothership/.env.example",
  ]);
  assert.deepEqual(exampleMatches.map((entry) => entry.id), ["factory_env_contracts"]);

  const sharedMatches = resolvePlatformInvariantMatches([
    "config/testing/factory-env/shared-env.contract.json",
  ]);
  assert.deepEqual(sharedMatches.map((entry) => entry.id), ["factory_env_contracts"]);
});

test("provisioning drift contract paths map to provisioning_drift invariant", () => {
  const scriptMatches = resolvePlatformInvariantMatches([
    "scripts/check-provisioning-drift.ts",
  ]);
  assert.deepEqual(scriptMatches.map((entry) => entry.id), ["cli_context_portability", "provisioning_drift"]);

  const templateMatches = resolvePlatformInvariantMatches([
    "factories/brainstorm/issue_templates/brainstorm-incoming.md",
  ]);
  assert.deepEqual(templateMatches.map((entry) => entry.id), ["provisioning_drift"]);
});

test("managed supervisor shell contract paths map to managed_supervisor_shell_contract invariant", () => {
  const sharedShellMatches = resolvePlatformInvariantMatches([
    "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
  ]);
  assert.deepEqual(sharedShellMatches.map((entry) => entry.id), ["managed_supervisor_shell_contract", "managed-factory-mutation-boundaries", "managed-factory-telemetry-contract"]);

  const lifecycleEnumMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/src/lib/external-factory-control-state.ts",
  ]);
  assert.deepEqual(lifecycleEnumMatches.map((entry) => entry.id), ["managed_supervisor_shell_contract"]);

  const supervisorTickMatches = resolvePlatformInvariantMatches([
    "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
  ]);
  assert.deepEqual(supervisorTickMatches.map((entry) => entry.id), ["managed_supervisor_shell_contract", "managed-factory-mutation-boundaries", "managed-factory-telemetry-contract", "managed_factory_telemetry_contract", "supervisor_recovery"]);
});

test("managed factory mutation boundary paths map to managed-factory-mutation-boundaries invariant", () => {
  const managedGraphMatches = resolvePlatformInvariantMatches([
    "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
  ]);
  assert.deepEqual(managedGraphMatches.map((entry) => entry.id), ["managed_supervisor_shell_contract", "managed-factory-mutation-boundaries", "managed-factory-telemetry-contract", "managed_factory_telemetry_contract", "supervisor_recovery"]);

  const managedGoldenMatches = resolvePlatformInvariantMatches([
    "scripts/test/golden/managed-boundary-violation.dot",
  ]);
  assert.deepEqual(managedGoldenMatches.map((entry) => entry.id), ["cli_context_portability", "managed-factory-mutation-boundaries"]);

  const labelContractMatches = resolvePlatformInvariantMatches([
    "docs/contracts/factory-label-contract.json",
  ]);
  assert.deepEqual(labelContractMatches.map((entry) => entry.id), ["managed-factory-mutation-boundaries", "factory_label_contract"]);

  const incidentPacketMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/src/lib/incident-packet.ts",
  ]);
  assert.deepEqual(incidentPacketMatches.map((entry) => entry.id), ["managed-factory-mutation-boundaries", "supervisor_recovery"]);

  const supervisorArtifactMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/src/commands/supervisor-artifact.ts",
  ]);
  assert.deepEqual(supervisorArtifactMatches.map((entry) => entry.id), ["managed-factory-mutation-boundaries", "supervisor_recovery"]);

  const supervisorArtifactOwnerMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
  ]);
  assert.deepEqual(supervisorArtifactOwnerMatches.map((entry) => entry.id), ["managed-factory-mutation-boundaries", "supervisor_recovery"]);
});

test("managed factory telemetry contract paths map to managed-factory-telemetry-contract invariant", () => {
  const runtimeMatches = resolvePlatformInvariantMatches([
    "packages/factory-runtime/telemetry/managed-factory-telemetry.mjs",
  ]);
  assert.deepEqual(runtimeMatches.map((entry) => entry.id), ["managed-factory-telemetry-contract"]);

  const daemonMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/src/lib/daemon.ts",
  ]);
  assert.deepEqual(daemonMatches.map((entry) => entry.id), ["managed-factory-telemetry-contract"]);
});

test("cli portability regression surfaces map to cli_context_portability invariant", () => {
  const hatchContextMatches = resolvePlatformInvariantMatches([
    "apps/hatch/src/cli-run-config.test.ts",
  ]);
  assert.deepEqual(hatchContextMatches.map((entry) => entry.id), ["cli_context_portability"]);

  const opsContextMatches = resolvePlatformInvariantMatches([
    "packages/factory-ops/test/supervisor/factory-context-resolution-cli.cli.test.ts",
  ]);
  assert.deepEqual(opsContextMatches.map((entry) => entry.id), ["cli_context_portability", "supervisor_recovery"]);

  const gateMatches = resolvePlatformInvariantMatches([
    "scripts/check-cli-context-portability.ts",
  ]);
  assert.deepEqual(gateMatches.map((entry) => entry.id), ["cli_context_portability"]);
});

test("managed shared factory surfaces map to shared-surface + external-consumption + manifest invariants", () => {
  const matches = resolvePlatformInvariantMatches([
    "factories/_shared/surfaces/graphs/release_report_flow.dot.template",
  ]);
  assert.deepEqual(matches.map((entry) => entry.id), [
    "factory_shared_surfaces",
    "factory_shared_surface_consumption",
    "factory_shared_surface_manifest",
    "factory_label_contract",
  ]);
});

test("capability release reporting package maps to factory_shared_surfaces invariant", () => {
  const matches = resolvePlatformInvariantMatches([
    "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
  ]);
  assert.deepEqual(matches.map((entry) => entry.id), ["factory_shared_surfaces"]);
});

test("shared-surface manifest snapshot path maps to manifest invariant", () => {
  const matches = resolvePlatformInvariantMatches([
    "docs/contracts/shared-surface-manifest.json",
  ]);
  assert.deepEqual(matches.map((entry) => entry.id), ["factory_shared_surface_manifest"]);
});

test("nested wildcard ownership globs cover canonical workflow data", () => {
 assert.equal(matchesPlatformInvariantPattern("factories/mothership/workflows/wave-execution/wave_execute.workflow-source.data.json", "factories/*/workflows/**"), true);
 assert.equal(matchesPlatformInvariantPattern("scripts/test/fixtures/mothership/workflows/demo.mjs", "factories/*/workflows/**"), false);
});
