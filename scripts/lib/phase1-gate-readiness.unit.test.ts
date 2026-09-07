import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePhase1GateReadinessArtifacts,
  buildPhase1GateReadinessReport,
  renderPhase1GateReadinessMarkdown,
} from "./phase1-gate-readiness.ts";
import { PHASE1_GATE_SCOPE_CONTRACT } from "./phase1-gate-scope-contract.ts";

const VALID_MANIFEST = {
  schema_version: "active_surface_manifest/v1",
  graph_families: [
    {
      id: "active_factory_graphs",
      classification: "active_factory",
      include: ["factories/**/*.dot"],
    },
  ],
  runtime_surfaces: [
    {
      id: "runtime_hot_path",
      classification: "hot_path",
      include: ["apps/**/*.ts"],
    },
  ],
  command_surfaces: [
    {
      id: "owner_commands",
      classification: "active_deterministic_owner",
      include: ["packages/factory-ops/src/commands/release-build-report-context.ts"],
    },
  ],
};

const VALID_GATE_MANIFEST = Object.freeze([
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.gateId,
    command: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.command,
    args: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.args,
    profiles: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.profiles,
    failureTarget: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.failureTarget,
    runtime: { stagedFileList: true },
  },
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.gateId,
    command: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.command,
    args: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.args,
    profiles: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.profiles,
    failureTarget: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.failureTarget,
    runtime: { stagedFileList: true },
  },
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.gateId,
    command: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.command,
    args: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.args,
    profiles: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.profiles,
    failureTarget: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.failureTarget,
    runtime: { stagedFileList: true },
  },
  {
    id: "phase1_gate_readiness",
    command: "node",
    args: ["scripts/check-phase1-gate-readiness.ts"],
    profiles: ["fast", "strict", "full"],
    failureTarget: "check-phase1-gate-readiness",
    runtime: { allTracked: true },
  },
]);

function readFile(path) {
  if (path === ".githooks/pre-commit") return "node scripts/run-gates.mjs --profile strict --telemetry-prefix pre-commit --staged-file-list";
  if (path === ".githooks/pre-push") return "node scripts/run-gates.mjs --profile fast --telemetry-prefix pre-push --staged-file-list";
  if (path === "package.json") return JSON.stringify({ scripts: { "qa:pre-merge": "node scripts/run-gates.mjs --profile full --all-tracked" } });
  if (path === ".github/workflows/pre-merge-quality.yml") return "run: pnpm --silent qa:pre-merge\n";
  if (path.endsWith(".dot")) return 'digraph x { run [type="tool" prompt="hatch-ops release build-report-context"] }';
  if (path.endsWith(".ts")) return 'spawnSync("node", ["packages/factory-ops/src/cli.ts", "release", "post-to-slack"]);';
  if (path.endsWith(".mjs")) return `${"x\n".repeat(401)}`;
  throw new Error(`unexpected path ${path}`);
}

test("buildPhase1GateReadinessReport stays green with attributable violations", () => {
  const files = [
    "factories/mothership/graphs/daily_release_report.dot",
    "apps/hatch/src/pipeline/handler/tool.ts",
    "packages/factory-ops/src/commands/release-build-report-context.ts",
  ];
  const report = buildPhase1GateReadinessReport({
    files,
    manifest: VALID_MANIFEST,
    gateManifest: VALID_GATE_MANIFEST,
    readFile,
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.graph_transport_violations, 1);
  assert.equal(report.summary.runtime_internal_cli_violations, 1);
  assert.equal(report.summary.command_thinness_violations, 1);
  assert.deepEqual(report.diagnostics, []);
  assert.match(renderPhase1GateReadinessMarkdown(report), /Phase 1 Gate Readiness Report/);
});

test("buildPhase1GateReadinessReport fails when gate manifest drifts from the shared scope contract", () => {
  const driftedGateManifest = VALID_GATE_MANIFEST.map((gate) => (
    gate.id === PHASE1_GATE_SCOPE_CONTRACT.graph_transport.gateId
      ? { ...gate, args: ["scripts/check-internal-cli-transport.ts", "--fail-opted-in-graphs"] }
      : gate
  ));
  const report = buildPhase1GateReadinessReport({
    files: [],
    manifest: VALID_MANIFEST,
    gateManifest: driftedGateManifest,
    readFile,
  });

  assert.equal(report.ok, false);
  assert.match(report.diagnostics.join("\n"), /gate_args_drift/);
});

test("buildPhase1GateReadinessReport fails when hook routing omits the phase1 gate runner", () => {
  const report = buildPhase1GateReadinessReport({
    files: [],
    manifest: VALID_MANIFEST,
    gateManifest: VALID_GATE_MANIFEST,
    readFile(path) {
      if (path === ".githooks/pre-push") return "# missing";
      return readFile(path);
    },
  });

  assert.equal(report.ok, false);
  assert.match(report.diagnostics.join("\n"), /route_command_missing route=pre_push/);
});

test("analyzePhase1GateReadinessArtifacts reports checked-in drift", () => {
  const analysis = analyzePhase1GateReadinessArtifacts({
    files: [],
    manifest: VALID_MANIFEST,
    gateManifest: VALID_GATE_MANIFEST,
    readFile,
    expectedJson: "{}\n",
    expectedMarkdown: "# stale\n",
  });

  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /phase1_gate_readiness_json_drift/);
  assert.match(analysis.diagnostics.join("\n"), /phase1_gate_readiness_markdown_drift/);
});
