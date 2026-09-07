import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

const legacyCliToken = String.fromCharCode(116, 97, 120, 105);

function legacyPattern(source) {
  return new RegExp(source.replaceAll("<legacy>", legacyCliToken));
}

function listFilesRecursive(rootDir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      files.push(absolutePath.replaceAll("\\", "/"));
    }
  }

  walk(rootDir);
  return files;
}

test("CLI/help/runs user-facing command namespace is hatch-only", () => {
  const cli = read("apps/hatch/src/cli.ts");
  const help = read("apps/hatch/src/help.ts");
  const runs = read("apps/hatch/src/runs.ts");

  assert.match(cli, /hatch run <file\.dot>/);
  assert.match(cli, /hatch validate <file\.dot>/);
  assert.match(cli, /hatch resolve @scope\/pkg\/path/);
  assert.match(cli, /hatch runs/);
  assert.match(cli, /hatch watch <file\.dot>/);

  assert.match(cli, /HATCH_MODEL/);
  assert.match(cli, /HATCH_PROVIDER/);
  assert.match(cli, /HATCH_INTENT_PATHS/);
  assert.match(cli, /HATCH_DISPATCH_INTERVAL_MS/);
  assert.match(cli, /HATCH_DISPATCH_MAX_PER_TICK/);

  assert.doesNotMatch(cli, legacyPattern("\\b<legacy>\\b"));
  assert.doesNotMatch(help, legacyPattern("\\b<legacy>\\b"));
  assert.doesNotMatch(runs, legacyPattern("\\b<legacy>\\b"));
});

test("hook/script automation uses hatch runtime identity", () => {
  const preCommit = read(".githooks/pre-commit");
  const runGates = read("scripts/run-gates.mjs");
  const postCommit = read(".githooks/post-commit");
  const pkg = JSON.parse(read("package.json"));
  const routingConfig = read("scripts/lib/pre-commit-routing-config.ts");
  const suiteRoutingConfig = read("scripts/lib/suite-routing-config.ts");
  const suiteRoutingJson = read("config/testing/suite-routing.json");
  const postinstallBootstrap = read("scripts/postinstall-bootstrap.mjs");
  const syncBins = read("scripts/sync-workspace-bins.mjs");

  assert.match(preCommit, /node scripts\/run-gates\.mjs --profile strict --telemetry-prefix pre-commit --staged-file-list/);
  assert.match(runGates, /\.\/node_modules\/.bin\/hatch/);
  assert.match(runGates, /\["validate", file\]/);
  assert.doesNotMatch(preCommit, legacyPattern("\\./node_modules/.bin/<legacy> validate"));

  assert.match(postCommit, /\[post-commit\] Skipping automatic hatch build to avoid background load\./);
  assert.match(postCommit, /node scripts\/relink-global-cli\.mjs/);
  assert.doesNotMatch(postCommit, /CURRENT_CLI_SOURCE/);
  assert.doesNotMatch(postCommit, legacyPattern("Building <legacy>"));
  assert.equal(pkg.scripts.postinstall, "node scripts/postinstall-bootstrap.mjs");
  assert.match(postinstallBootstrap, /syncWorkspaceBins/);
  assert.match(postinstallBootstrap, /apps", "hatch", "coverage", ".tmp"/);
  assert.match(syncBins, /hatch-ops/);

  assert.match(pkg.scripts["test:guard-gates"], /--filter=hatch/);
  assert.doesNotMatch(pkg.scripts["test:guard-gates"], legacyPattern("--filter=<legacy>"));

  assert.match(routingConfig, /from "\.\/suite-routing-config\.(?:mjs|ts)"/);
  assert.match(suiteRoutingConfig, /config\/testing\/suite-routing\.json/);
  assert.match(suiteRoutingJson, /"test:guard-gates"/);
  assert.doesNotMatch(suiteRoutingJson, legacyPattern("test:guard-gates --filter=<legacy>"));
});

test("apps/hatch/src contains no legacy taxi runtime identifiers", () => {
  const files = listFilesRecursive("apps/hatch/src");
  const sourceFiles = files.filter((path) =>
    path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".json"),
  );

  const checks = [
    { token: "TAXI_* env var", regex: /\bTAXI_[A-Z0-9_]+\b/ },
    { token: "@taxi scope", regex: /@taxi\// },
    { token: "apps/taxi path", regex: /\bapps\/taxi\b/ },
    { token: "taxi validate command", regex: /\btaxi\s+validate\b/ },
    { token: ".taxi state path", regex: /\.taxi\// },
    { token: "legacy taxi word", regex: /\btaxi\b/i },
  ];

  const violations = [];
  for (const filePath of sourceFiles) {
    const content = read(filePath);
    for (const check of checks) {
      if (!check.regex.test(content)) continue;
      violations.push(`${filePath}: ${check.token}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("inline-script marker + automation fixtures are hatch-only", () => {
  const dotLint = read("scripts/dot-lint.mjs");
  const debtBaseline = read("scripts/dot-inline-script-ignore-baseline.json");
  const inlineDebtFixture = read("scripts/test/fixtures/dot-lint/inline-script-debt.dot");
  const preCommitHookTest = read("scripts/pre-commit-hook.test.mjs");
  const preCommitMatrixTest = read("scripts/pre-commit-gate-matrix.test.mjs");

  assert.match(dotLint, /# hatch:no-inline-script-ok/);
  assert.match(dotLint, /hatch:no-inline-script-ok/);
  assert.doesNotMatch(dotLint, /#\s*taxi:no-inline-script-ok/);

  assert.match(debtBaseline, /# hatch:no-inline-script-ok/);
  assert.doesNotMatch(debtBaseline, /#\s*taxi:no-inline-script-ok/);

  assert.match(inlineDebtFixture, /# hatch:no-inline-script-ok/);
  assert.doesNotMatch(inlineDebtFixture, /#\s*taxi:no-inline-script-ok/);

  assert.match(preCommitHookTest, /node_modules\/.bin\/hatch/);
  assert.match(preCommitMatrixTest, /node_modules\/.bin\/hatch/);
  assert.doesNotMatch(preCommitHookTest, /node_modules\/.bin\/taxi/);
  assert.doesNotMatch(preCommitMatrixTest, /node_modules\/.bin\/taxi/);
});
