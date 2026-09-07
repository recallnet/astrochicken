import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

const legacyToken = String.fromCharCode(116, 97, 120, 105);

function legacyPattern(source) {
  return new RegExp(source.replaceAll("<legacy>", legacyToken));
}

function gitMode(path) {
  const output = execFileSync("git", ["ls-files", "--stage", path], { encoding: "utf8" }).trim();
  const [mode] = output.split(/\s+/, 2);
  return mode;
}

test("runtime workspace/package identity is hatch plus expected published scopes", () => {
  assert.equal(existsSync("apps/hatch/package.json"), true);
  assert.equal(existsSync("apps/taxi/package.json"), false);

  const appPkg = readJson("apps/hatch/package.json");
  const appTsconfig = readJson("apps/hatch/tsconfig.json");
  const sharedTsconfigPkg = readJson("packages/tsconfig/package.json");
  const factoryPatternsPkg = readJson("packages/factory-patterns/package.json");
  const rootPkg = readJson("package.json");
  const postinstallBootstrap = read("scripts/postinstall-bootstrap.mjs");
  const syncBins = read("scripts/sync-workspace-bins.mjs");
  const hatchWrapper = read("scripts/bin/hatch");
  const hatchOpsWrapper = read("scripts/bin/hatch-ops");

  assert.equal(appPkg.name, "hatch");
  assert.equal(appPkg.bin?.hatch, "dist/cli.js");
  assert.equal(appTsconfig.extends, "@hatch/tsconfig/node.json");
  assert.equal(appPkg.devDependencies?.["@hatch/tsconfig"], "workspace:*");

  assert.equal(sharedTsconfigPkg.name, "@hatch/tsconfig");
  assert.equal(factoryPatternsPkg.name, "@recallnet/factory-patterns");

  assert.equal(rootPkg.name, "astrochicken");
  assert.equal(rootPkg.scripts.postinstall, "node scripts/postinstall-bootstrap.mjs");
  assert.match(postinstallBootstrap, /syncWorkspaceBins/);
  assert.match(postinstallBootstrap, /apps", "hatch", "coverage", ".tmp"/);
  assert.match(rootPkg.scripts["test:guard-gates"], /--filter=hatch/);
  assert.match(rootPkg.scripts["validate:typecheck-wiring"], /--filter hatch/);
  assert.match(syncBins, /"scripts", "bin", "hatch"/);
  assert.match(syncBins, /"scripts", "bin", "hatch-ops"/);
  assert.match(hatchWrapper, /repo_root=\$\(cd "\$basedir\/\.\.\/\.\." && pwd\)/);
  assert.match(hatchWrapper, /pnpm_node_path="\$repo_root\/node_modules\/\.pnpm\/node_modules"/);
  assert.match(hatchWrapper, /apps\/hatch\/dist\/cli\.js/);
  assert.doesNotMatch(hatchWrapper, /\.claude\/worktrees\//);
  assert.match(hatchOpsWrapper, /repo_root=\$\(cd "\$basedir\/\.\.\/\.\." && pwd\)/);
  assert.match(hatchOpsWrapper, /pnpm_node_path="\$repo_root\/node_modules\/\.pnpm\/node_modules"/);
  assert.match(hatchOpsWrapper, /packages\/factory-ops\/src\/cli\.mjs/);
  assert.doesNotMatch(hatchOpsWrapper, /\.claude\/worktrees\//);

});

test("runtime parser/hooks/classifier references are hatch-only", () => {
  assert.equal(existsSync("scripts/lib/hatch-dot-parser-wrapper.ts"), true);
  assert.equal(existsSync("scripts/lib/hatch-dot-parser-fallback.ts"), true);
  assert.equal(existsSync("scripts/lib/taxi-dot-parser-wrapper.mjs"), false);
  assert.equal(existsSync("scripts/lib/taxi-dot-parser-fallback.mjs"), false);

  const wrapper = read("scripts/lib/hatch-dot-parser-wrapper.ts");
  const dotLint = read("scripts/dot-lint.mjs");
  const lintDot = read("scripts/lint-dot.mjs");
  const runGates = read("scripts/run-gates.mjs");
  const routingConfig = read("scripts/lib/pre-commit-routing-config.ts");
  const suiteRoutingConfig = read("scripts/lib/suite-routing-config.ts");
  const suiteRoutingJson = read("config/testing/suite-routing.json");
  const preCommit = read(".githooks/pre-commit");
  const postCommit = read(".githooks/post-commit");

  assert.match(wrapper, /apps\/hatch\/dist\/pipeline\/parse\.js/);
  assert.match(dotLint, /\.\/lib\/hatch-dot-parser-wrapper\.(?:mjs|ts)/);
  assert.doesNotMatch(dotLint, legacyPattern("./lib/<legacy>-dot-parser-wrapper.mjs"));
  assert.match(lintDot, /scripts\/dot-lint\.mjs/);

  assert.match(routingConfig, /from "\.\/suite-routing-config\.(?:mjs|ts)"/);
  assert.match(suiteRoutingConfig, /config\/testing\/suite-routing\.json/);
  assert.match(suiteRoutingJson, /"apps\/hatch\/\*\*"/);
  assert.match(suiteRoutingJson, /"test:guard-gates"/);
  assert.doesNotMatch(suiteRoutingJson, legacyPattern("apps/<legacy>/"));

  assert.match(preCommit, /node scripts\/run-gates\.mjs --profile strict --telemetry-prefix pre-commit --staged-file-list/);
  assert.match(runGates, /\.\/node_modules\/.bin\/hatch/);
  assert.match(runGates, /\["validate", file\]/);
  assert.doesNotMatch(preCommit, legacyPattern("node_modules\/.bin\/<legacy> validate"));

  assert.match(postCommit, /Skipping automatic hatch build to avoid background load/);
  assert.match(postCommit, /node scripts\/relink-global-cli\.mjs/);
  assert.doesNotMatch(postCommit, /CURRENT_CLI_SOURCE/);
  assert.doesNotMatch(postCommit, legacyPattern("Building <legacy>"));
});

test("factory runtime bin entrypoints are tracked executable", () => {
  const factoryOpsPkg = readJson("packages/factory-ops/package.json");
  const hostRuntimeSource = read("packages/factory-ops/src/host-runtime.ts");
  const cliSource = read("packages/factory-ops/src/cli.ts");

  assert.equal(factoryOpsPkg.bin?.["hatch-ops"], "src/cli.ts");
  assert.equal(factoryOpsPkg.bin?.["hatch-host"], "src/host-runtime.ts");
  assert.match(hostRuntimeSource, /^#!\/usr\/bin\/env node/m);
  assert.match(cliSource, /^#!\/usr\/bin\/env node/m);
  assert.equal(gitMode("packages/factory-ops/src/cli.ts"), "100755");
  assert.equal(gitMode("packages/factory-ops/src/host-runtime.ts"), "100755");
});

test("runtime state/env identifiers use .hatch and HATCH_*", () => {
  const cli = read("apps/hatch/src/cli.ts");
  const run = read("apps/hatch/src/pipeline/run.ts");
  const runs = read("apps/hatch/src/runs.ts");
  const dispatchStore = read("apps/hatch/src/dispatch/store.ts");
  const checkpoint = read("apps/hatch/src/pipeline/checkpoint.ts");
  const trace = read("apps/hatch/src/pipeline/trace.ts");
  const guard = read("apps/hatch/src/pipeline/guard.ts");
  const guardCore = read("apps/hatch/src/pipeline/guard-core.ts");
  const toolEnv = read("apps/hatch/src/pipeline/tool-env.ts");
  const intentLoader = read("apps/hatch/src/intent/loader.ts");

  assert.match(cli, /HATCH_MODEL/);
  assert.match(cli, /HATCH_PROVIDER/);
  assert.match(cli, /HATCH_INTENT_PATHS/);
  assert.match(cli, /HATCH_DISPATCH_INTERVAL_MS/);
  assert.match(cli, /HATCH_DISPATCH_MAX_PER_TICK/);
  assert.doesNotMatch(cli, /TAXI_[A-Z0-9_]+/);

  assert.match(run, /\.hatch\/runs/);
  assert.match(runs, /\.hatch\/runs/);
  assert.match(dispatchStore, /\.hatch", "dispatch"/);
  assert.match(checkpoint, /\.hatch-checkpoint-/);
  assert.match(trace, /\.hatch-trace-/);
  assert.match(guardCore, /\.hatch", "guard"/);
  assert.match(toolEnv, /HATCH_PIPELINE_FILE/);
  assert.match(toolEnv, /HATCH_WORKDIR/);
  assert.match(intentLoader, /HATCH_INTENT_PATHS/);

  assert.doesNotMatch(run, legacyPattern("\\.<legacy>\/runs"));
  assert.doesNotMatch(runs, legacyPattern("\\.<legacy>\/runs"));
  assert.doesNotMatch(dispatchStore, legacyPattern("\\.<legacy>/dispatch"));
  assert.doesNotMatch(guard, legacyPattern("\\.<legacy>"));
  assert.doesNotMatch(toolEnv, /TAXI_[A-Z0-9_]+/);
});
