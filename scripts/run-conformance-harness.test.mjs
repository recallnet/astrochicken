import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const runnerPath = join(repoRoot, "scripts", "run-conformance-harness.mjs");

function writeFactoryFixture({
  config,
  graph,
}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "run-conformance-harness-fixture-"));
  const factoryRoot = join(tempRoot, "factories", "fixture-factory");
  mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
  mkdirSync(join(factoryRoot, "policy-pack", "v1"), { recursive: true });
  mkdirSync(join(factoryRoot, "skills", "supervisor"), { recursive: true });
  mkdirSync(join(factoryRoot, "scenarios", "fixture-factory"), { recursive: true });
  mkdirSync(join(tempRoot, "docs", "astrochicken"), { recursive: true });
  writeFileSync(join(factoryRoot, "factory.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(factoryRoot, "graphs", "factory_supervisor_tick.dot"), graph);
  writeFileSync(join(factoryRoot, "INTENT.md"), "# Fixture Factory Intent\n");
  writeFileSync(join(factoryRoot, "skills", "supervisor", "current.md"), "# Fixture supervisor skill\n");
  writeFileSync(join(factoryRoot, "scenarios", "fixture-factory", "README.md"), "# Fixture scenarios\n");
  writeFileSync(join(tempRoot, "docs", "astrochicken", "astrochicken-platform-intent.md"), "# Platform intent\n");
  writeFileSync(
    join(factoryRoot, "policy-pack", "v1", "metadata.json"),
    `${JSON.stringify({
      version: "v1",
      owned_by: "factory-platform",
      files: {
        model: "model-policy.json",
      },
      required_keys: {
        model: [
          "shared.default_provider",
          "shared.default_model",
          "shared.override_env_vars.provider",
          "shared.override_env_vars.model",
        ],
      },
      customizable_keys: {
        model: [
          "factory.allowed_models",
          "factory.preferred_model",
          "factory.provider_order",
        ],
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(factoryRoot, "policy-pack", "v1", "model-policy.json"),
    `${JSON.stringify({
      shared: {
        default_provider: "openrouter",
        default_model: "openai/gpt-5.3-codex",
        override_env_vars: {
          provider: "HATCH_MODEL_PROVIDER",
          model: "HATCH_MODEL",
        },
      },
      factory: {
        provider_order: ["openrouter"],
        allowed_models: ["openai/gpt-5.3-codex"],
        preferred_model: "openai/gpt-5.3-codex",
      },
    }, null, 2)}\n`,
  );
  return { tempRoot, factoryRoot };
}

function baseFactoryConfig(overrides = {}) {
  return {
    schema: "hatch.factory.config.v1",
    factory_id: "fixture-factory",
    target_repo: "example-org/fixture-factory",
    control_plane_repo: "recallnet/astrochicken",
    dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
    skills: { supervisor: "factories/fixture-factory/skills/supervisor/current.md" },
    scenarios: { root: "factories/fixture-factory/scenarios/fixture-factory" },
    pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
    runs_dir: ".hatch/fixture-factory/runs",
    trust: {
      domain: "fixture-factory.local",
      roles: ["fixture-factory.local.tool"],
    },
    policyPack: {
      version: "v1",
      overrides: {},
    },
    ...overrides,
  };
}

function validGraph() {
  return `digraph factory_supervisor_tick {
  start [shape=Mdiamond label="Start"]
  work [type="tool" governance="reversible" tool_id="shell" action_id="file.write" recovery_owner="supervisor" prompt=":" label="Work"]
  done [shape=Msquare recovery_sink_type="terminal" label="Done"]

  start -> work -> done
}
`;
}

function runHarness(args) {
  return spawnSync("node", [runnerPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("run-conformance-harness reports ordered telemetry and result=ok for healthy fixture", () => {
  ensureHatchBuild({ repoRoot });
  const fixture = writeFactoryFixture({
    config: baseFactoryConfig(),
    graph: validGraph(),
  });

  const run = runHarness(["--factory-root", fixture.factoryRoot, "--repo-root", fixture.tempRoot, "--json"]);
  rmSync(fixture.tempRoot, { recursive: true, force: true });

  assert.equal(run.status, 0, run.stderr || run.stdout);

  const phaseLines = run.stderr.split("\n").filter((line) => line.startsWith("factory_conformance phase="));
  assert.ok(phaseLines.length > 0, "expected phase telemetry lines");

  const expectedOrder = [
    "config_schema",
    "intent_stack",
    "policy_pack_conformance",
    "graph_validate",
    "dot_lint",
    "recovery_ownership",
    "run_dir_isolation",
    "supervisor_tick_smoke",
    "operational_e2e",
    "ops_contract",
  ];

  let cursor = -1;
  for (const phase of expectedOrder) {
    const idx = phaseLines.findIndex((line, index) => index > cursor && line.includes(`phase=${phase} action=run`));
    assert.ok(idx > cursor, `missing ordered run action for phase=${phase}`);
    cursor = idx;
  }

  let resultCursor = -1;
  for (const phase of expectedOrder) {
    const idx = phaseLines.findIndex((line, index) => index > resultCursor && line.includes(`phase=${phase} result=ok`));
    assert.ok(idx > resultCursor, `missing ordered result line for phase=${phase}`);
    resultCursor = idx;
  }

  const runActionLines = phaseLines.filter((line) => line.includes(" action=run"));
  const configRun = runActionLines.find((line) => line.includes("phase=config_schema")) || "";
  const intentRun = runActionLines.find((line) => line.includes("phase=intent_stack")) || "";
  const policyPackRun = runActionLines.find((line) => line.includes("phase=policy_pack_conformance")) || "";
  const dotLintRun = runActionLines.find((line) => line.includes("phase=dot_lint")) || "";
  const smokeRun = runActionLines.find((line) => line.includes("phase=supervisor_tick_smoke")) || "";
  const operationalRun = runActionLines.find((line) => line.includes("phase=operational_e2e")) || "";
  const opsRun = runActionLines.find((line) => line.includes("phase=ops_contract")) || "";

  assert.match(configRun, /label="Config schema"/);
  assert.match(intentRun, /label="Intent stack"/);
  assert.match(policyPackRun, /label="Policy pack conformance"/);
  assert.match(dotLintRun, /command=/);
  assert.match(dotLintRun, /lint-dot\.mjs/);
  assert.match(smokeRun, /command=/);
  assert.match(smokeRun, /hatch run/);
  assert.match(operationalRun, /command=/);
  assert.match(operationalRun, /hatch-ops factory status/);
  assert.match(opsRun, /command=/);
  assert.match(opsRun, /hatch-ops factory status/);

  assert.match(run.stderr, /factory_conformance result=ok failed_phase=/);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.failed_phase, "");
});

test("run-conformance-harness exits non-zero and reports failed_phase on conformance failure", () => {
  ensureHatchBuild({ repoRoot });
  const fixture = writeFactoryFixture({
    config: baseFactoryConfig(),
    graph: `digraph factory_supervisor_tick {
  start [shape=Mdiamond]
  work [label="Work"]
  done [shape=Msquare]

  start -> work -> done
}
`,
  });

  const run = runHarness(["--factory-root", fixture.factoryRoot, "--repo-root", fixture.tempRoot, "--json"]);
  rmSync(fixture.tempRoot, { recursive: true, force: true });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /factory_conformance result=fail failed_phase=recovery_ownership/);
  assert.match(run.stderr, /factory_conformance phase=config_schema result=ok duration_ms=\d+ label="Config schema"/);
  assert.match(run.stderr, /factory_conformance phase=intent_stack result=ok duration_ms=\d+ label="Intent stack"/);
  assert.match(run.stderr, /factory_conformance phase=policy_pack_conformance result=ok duration_ms=\d+ label="Policy pack conformance"/);
  assert.match(run.stderr, /factory_conformance phase=graph_validate result=ok duration_ms=\d+ label="Graph validate"/);
  assert.match(run.stderr, /factory_conformance phase=recovery_ownership result=fail duration_ms=\d+ label="Recovery ownership"/);

  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.failed_phase, "recovery_ownership");
  assert.equal(payload.first_failure.phase, "recovery_ownership");
});
