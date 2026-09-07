import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzePhase1GateReadinessArtifacts } from "./lib/phase1-gate-readiness.ts";
import { PHASE1_GATE_SCOPE_CONTRACT } from "./lib/phase1-gate-scope-contract.ts";

const manifest = {
  schema_version: "active_surface_manifest/v1",
  graph_families: [{ id: "g", classification: "active_factory", include: ["factories/**/*.dot"] }],
  runtime_surfaces: [{ id: "r", classification: "hot_path", include: ["apps/**/*.ts"] }],
  command_surfaces: [{ id: "c", classification: "active_deterministic_owner", include: ["packages/factory-ops/src/commands/release-build-report-context.ts"] }],
};

const gateManifest = Object.freeze([
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.gateId,
    command: "node",
    args: PHASE1_GATE_SCOPE_CONTRACT.graph_transport.args,
    profiles: ["fast", "strict", "full"],
    failureTarget: "check-internal-cli-transport",
    runtime: { stagedFileList: true },
  },
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.gateId,
    command: "node",
    args: PHASE1_GATE_SCOPE_CONTRACT.runtime_internal_cli.args,
    profiles: ["fast", "strict", "full"],
    failureTarget: "check-runtime-internal-cli-enforcement",
    runtime: { stagedFileList: true },
  },
  {
    id: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.gateId,
    command: "node",
    args: PHASE1_GATE_SCOPE_CONTRACT.command_thinness.args,
    profiles: ["fast", "strict", "full"],
    failureTarget: "check-command-thinness-enforcement",
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
  if (path === ".githooks/pre-commit") return "node scripts/run-gates.mjs --profile strict --staged-file-list";
  if (path === ".githooks/pre-push") return "node scripts/run-gates.mjs --profile fast --staged-file-list";
  if (path === "package.json") return JSON.stringify({ scripts: { "qa:pre-merge": "node scripts/run-gates.mjs --profile full --all-tracked" } });
  if (path === ".github/workflows/pre-merge-quality.yml") return "run: pnpm --silent qa:pre-merge\n";
  if (path.endsWith(".dot")) return "digraph x {}";
  if (path.endsWith(".ts")) return "export const x = 1;\n";
  if (path.endsWith(".mjs")) return "export const x = 1;\n";
  throw new Error(`unexpected path ${path}`);
}

test("analyzePhase1GateReadinessArtifacts succeeds when checked-in artifacts match generated output", () => {
  const first = analyzePhase1GateReadinessArtifacts({
    files: [
      "factories/mothership/graphs/daily_release_report.dot",
      "apps/hatch/src/pipeline/handler/tool.ts",
      "packages/factory-ops/src/commands/release-build-report-context.ts",
    ],
    manifest,
    gateManifest,
    readFile,
  });
  const second = analyzePhase1GateReadinessArtifacts({
    files: [
      "factories/mothership/graphs/daily_release_report.dot",
      "apps/hatch/src/pipeline/handler/tool.ts",
      "packages/factory-ops/src/commands/release-build-report-context.ts",
    ],
    manifest,
    gateManifest,
    readFile,
    expectedJson: first.rendered_json,
    expectedMarkdown: first.rendered_markdown,
  });

  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});

test("CLI ignores tracked files that have been deleted from the working tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "phase1-gate-readiness-"));
  mkdirSync(path.join(root, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(root, "factories/demo/graphs"), { recursive: true });
  mkdirSync(path.join(root, "apps/demo"), { recursive: true });
  mkdirSync(path.join(root, "packages/factory-ops/src/commands"), { recursive: true });
  mkdirSync(path.join(root, ".githooks"), { recursive: true });
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });

  writeFileSync(path.join(root, ".githooks/pre-commit"), "node scripts/run-gates.mjs --profile strict --staged-file-list\n");
  writeFileSync(path.join(root, ".githooks/pre-push"), "node scripts/run-gates.mjs --profile fast --staged-file-list\n");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { "qa:pre-merge": "node scripts/run-gates.mjs --profile full --all-tracked" } }));
  writeFileSync(path.join(root, ".github/workflows/pre-merge-quality.yml"), "run: pnpm --silent qa:pre-merge\n");
  writeFileSync(path.join(root, "docs/contracts/active-surface-manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(root, "docs/contracts/phase1-gate-readiness-report.json"), "{}\n");
  writeFileSync(path.join(root, "docs/contracts/phase1-gate-readiness-report.md"), "# stale\n");
  writeFileSync(path.join(root, "factories/demo/graphs/live.dot"), "digraph x {}\n");
  writeFileSync(path.join(root, "factories/demo/graphs/deleted.dot"), "digraph x {}\n");
  writeFileSync(path.join(root, "apps/demo/engine.ts"), "export const x = 1;\n");
  writeFileSync(path.join(root, "packages/factory-ops/src/commands/release-build-report-context.ts"), "export const x = 1;\n");

  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" }).status, 0);
  rmSync(path.join(root, "factories/demo/graphs/deleted.dot"));

  const writeRun = spawnSync("node", [path.join(process.cwd(), "scripts/check-phase1-gate-readiness.ts"), "--write"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(writeRun.status, 0, writeRun.stderr || writeRun.stdout);

  const verifyRun = spawnSync("node", [path.join(process.cwd(), "scripts/check-phase1-gate-readiness.ts")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(verifyRun.status, 0, verifyRun.stderr || verifyRun.stdout);
  assert.match(verifyRun.stdout, /\[phase1-gate-readiness\] result=ok/);
});
