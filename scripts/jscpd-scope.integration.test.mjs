import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const prodConfigPath = join(repoRoot, ".jscpd.json");
const testConfigPath = join(repoRoot, ".jscpd.tests.json");
const fixturesRoot = join(repoRoot, "scripts", "test", "fixtures", "jscpd");
const jscpdBin = process.platform === "win32"
  ? join(repoRoot, "node_modules", ".bin", "jscpd.cmd")
  : join(repoRoot, "node_modules", ".bin", "jscpd");

const REQUIRED_FIXTURE_IGNORES = [
  "scripts/test/fixtures/**",
  "scripts/fixtures/**",
  "packages/**/test/fixtures/**",
];

function runJscpdWithFixture(baseConfigPath, fixtureDirName) {
  const baseConfig = JSON.parse(readFileSync(baseConfigPath, "utf8"));
  const tempDir = mkdtempSync(join(tmpdir(), "jscpd-scope-"));
  const fixtureSourcePath = join(fixturesRoot, fixtureDirName);
  const fixtureRootPath = join(tempDir, "fixture-root");
  const fixturePath = join(fixtureRootPath, fixtureDirName);
  const variantConfigPath = join(tempDir, "config.json");

  cpSync(fixtureSourcePath, fixturePath, { recursive: true });

  const variantConfig = {
    ...baseConfig,
    gitignore: false,
    path: [fixturePath],
    output: join(tempDir, "report"),
    reporters: ["json"],
    ignore: [
      ...(Array.isArray(baseConfig.ignore) ? baseConfig.ignore : []),
      ...REQUIRED_FIXTURE_IGNORES,
    ],
  };

  writeFileSync(variantConfigPath, JSON.stringify(variantConfig, null, 2));

  const run = spawnSync(
    jscpdBin,
    ["--config", variantConfigPath, "--silent"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  rmSync(tempDir, { recursive: true, force: true });

  return run;
}

test("jscpd scope separation: production and test configs target different surfaces", () => {
  assert.equal(existsSync(jscpdBin), true, "local jscpd binary must exist");

  const prodOnProd = runJscpdWithFixture(prodConfigPath, "prod-only");
  const prodOnTest = runJscpdWithFixture(prodConfigPath, "test-only");
  const testOnTest = runJscpdWithFixture(testConfigPath, "test-only");
  const testOnProd = runJscpdWithFixture(testConfigPath, "prod-only");

  assert.equal(prodOnProd.status, 1, `expected production config to fail prod-only fixture: ${prodOnProd.stderr || prodOnProd.stdout}`);
  assert.equal(prodOnTest.status, 0, `expected production config to pass test-only fixture: ${prodOnTest.stderr || prodOnTest.stdout}`);

  assert.equal(testOnTest.status, 1, `expected test config to fail test-only fixture: ${testOnTest.stderr || testOnTest.stdout}`);
  assert.equal(testOnProd.status, 0, `expected test config to pass prod-only fixture: ${testOnProd.stderr || testOnProd.stdout}`);
});
