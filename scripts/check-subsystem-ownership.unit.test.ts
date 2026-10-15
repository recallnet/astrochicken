import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeSubsystemOwnership,
  parseArgs,
  resolveOwnerId,
} from "./check-subsystem-ownership.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-subsystem-ownership.ts");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path, content = "export {};") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "subsystem-ownership-"));
  writeJson(join(dir, "config", "testing", "subsystem-ownership.json"), {
    schema: "hatch.subsystem-ownership.v1",
    scan_roots: [
      { path: "apps/hatch/src", extensions: [".ts"] },
      { path: "scripts", extensions: [".mjs"], ignore_prefixes: ["scripts/test/fixtures/"] },
    ],
    owners: [
      { id: "hatch.runtime", package: "hatch", subsystem: "runtime", description: "runtime" },
      { id: "repo.testing_infra", package: "repo", subsystem: "testing_infra", description: "testing" },
    ],
    path_rules: [
      { path_prefix: "apps/hatch/src/pipeline/", owner_id: "hatch.runtime" },
      { path_prefix: "scripts/", owner_id: "repo.testing_infra" },
    ],
  });
  writeFile(join(dir, "apps", "hatch", "src", "pipeline", "engine.ts"));
  writeFile(join(dir, "scripts", "run-gates.mjs"), "export {};\n");
  writeFile(join(dir, "scripts", "test", "fixtures", "ignored.mjs"), "export {};\n");
  return dir;
}

test("parseArgs reads repo-root, config, and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--config", "x.json", "--json"]), {
    repoRoot: "/tmp/repo",
    configPath: "x.json",
    json: true,
  });
});

test("resolveOwnerId prefers the most specific path prefix", () => {
  assert.deepEqual(
    resolveOwnerId("apps/hatch/src/pipeline/engine.ts", [
      { path_prefix: "apps/hatch/src/", owner_id: "hatch.runtime" },
      { path_prefix: "apps/hatch/src/pipeline/", owner_id: "hatch.runtime.pipeline" },
    ]),
    {
      status: "ok",
      ownerId: "hatch.runtime.pipeline",
      pathPrefix: "apps/hatch/src/pipeline/",
    },
  );
});

test("analyzeSubsystemOwnership accepts mapped active roots and ignores fixture roots", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(analyzeSubsystemOwnership({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    owner_count: 2,
    rule_count: 2,
    file_count: 2,
    mapped_count: 2,
  });
});

test("analyzeSubsystemOwnership fails closed on unmapped active code path", () => {
  const dir = createFixtureRepo();
  writeFile(join(dir, "apps", "hatch", "src", "factory", "config.ts"));
  const result = analyzeSubsystemOwnership({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unmapped active code\/test path: apps\/hatch\/src\/factory\/config\.ts/);
});

test("CLI emits telemetry and JSON for a valid fixture", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\[subsystem_ownership\] result=ok owners=2 rules=2 files=2 mapped=2 errors=0/);
  assert.match(out.stdout, /"ok":true/);
});
