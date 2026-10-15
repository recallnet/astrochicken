import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  validateSuiteRoutingContract,
} from "./check-suite-routing-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-suite-routing-contract.ts");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validSuiteRoutingConfig() {
  return {
    schema: "hatch.suite-routing.v1",
    routes: [
      { pattern: "apps/hatch/**", bucket: "guard_only" },
      { pattern: "packages/factory-ops/src/cli/commands/wave.ts", bucket: "wave_claim_only" },
      { pattern: "scripts/**", bucket: "platform_invariant_trigger" },
      { pattern: "*", bucket: "neither_change" },
    ],
    bucket_suites: {
      guard_only: ["test:guard-gates"],
      wave_claim_only: ["test:wave-claim-gates"],
      all_suites: ["test:guard-gates", "test:wave-claim-gates"],
      platform_invariant_trigger: [],
      neither_change: [],
    },
    selection_matrix: [
      { bucket_key: "guard_only", selected_bucket: "guard_only", reason: "guard" },
      { bucket_key: "wave_claim_only", selected_bucket: "wave_claim_only", reason: "wave" },
      { bucket_key: "platform_invariant_trigger", selected_bucket: "platform_invariant_trigger", reason: "platform" },
      { bucket_key: "neither_change", selected_bucket: "neither_change", reason: "neutral" },
      { bucket_key: "guard_only+wave_claim_only", selected_bucket: "all_suites", reason: "all" },
      { bucket_key: "guard_only+platform_invariant_trigger", selected_bucket: "guard_only", reason: "guard" },
      { bucket_key: "guard_only+neither_change", selected_bucket: "guard_only", reason: "guard" },
      { bucket_key: "neither_change+platform_invariant_trigger", selected_bucket: "platform_invariant_trigger", reason: "platform" },
      { bucket_key: "neither_change+wave_claim_only", selected_bucket: "wave_claim_only", reason: "wave" },
      { bucket_key: "platform_invariant_trigger+wave_claim_only", selected_bucket: "wave_claim_only", reason: "wave" },
      { bucket_key: "guard_only+platform_invariant_trigger+wave_claim_only", selected_bucket: "all_suites", reason: "all" },
      { bucket_key: "guard_only+neither_change+platform_invariant_trigger", selected_bucket: "guard_only", reason: "guard" },
      { bucket_key: "guard_only+neither_change+wave_claim_only", selected_bucket: "all_suites", reason: "all" },
      { bucket_key: "neither_change+platform_invariant_trigger+wave_claim_only", selected_bucket: "wave_claim_only", reason: "wave" },
      { bucket_key: "guard_only+neither_change+platform_invariant_trigger+wave_claim_only", selected_bucket: "all_suites", reason: "all" },
    ],
  };
}

function createFixtureRepo(config = validSuiteRoutingConfig()) {
  const dir = mkdtempSync(join(tmpdir(), "suite-routing-contract-"));
  writeJson(join(dir, "config", "testing", "suite-routing.json"), config);
  return dir;
}

test("parseArgs reads repo-root and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--json"]), {
    repoRoot: "/tmp/repo",
    json: true,
  });
});

test("validateSuiteRoutingContract accepts the canonical fixture shape", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(validateSuiteRoutingContract({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    route_count: 4,
    matrix_rows: 15,
  });
});

test("validateSuiteRoutingContract fails closed on duplicate routes and missing catch-all", () => {
  const config = validSuiteRoutingConfig();
  config.routes = [
    { pattern: "apps/hatch/**", bucket: "guard_only" },
    { pattern: "apps/hatch/**", bucket: "guard_only" },
  ];
  const dir = createFixtureRepo(config);
  const result = validateSuiteRoutingContract({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /duplicate pattern/);
  assert.match(result.diagnostics.join("\n"), /must contain exactly one "\*" catch-all route/);
});

test("CLI emits telemetry and JSON for a valid repo", () => {
  const dir = createFixtureRepo();
  const run = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[suite_routing_contract\] result=ok routes=4 matrix_rows=15 errors=0/);
  assert.match(run.stdout, /"ok":true/);
});
