import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const sourceHookPath = join(repoRoot, ".githooks", "post-commit");

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function normalizeMacPrivatePrefix(value) {
  return String(value || "").replace(/^\/private/, "");
}

function setupHookRepo(repoDir) {
  writeFile(join(repoDir, "packages", "factory-ops", "src", "cli.mjs"), "export default 0;\n");
  writeFile(
    join(repoDir, "factories", "mothership", "factory.config.json"),
    JSON.stringify({
      schema: "hatch.factory.config.v1",
      factory_id: "mothership",
      canonical_checkout_path: "${HATCH_CANONICAL_CHECKOUT_PATH}",
    }, null, 2),
  );

  mkdirSync(join(repoDir, ".githooks"), { recursive: true });
  mkdirSync(join(repoDir, "scripts"), { recursive: true });
  mkdirSync(join(repoDir, "packages"), { recursive: true });

  copyFileSync(sourceHookPath, join(repoDir, ".githooks", "post-commit"));
  writeFile(join(repoDir, "scripts", "relink-global-cli.mjs"), `#!/usr/bin/env node
import { lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function normalize(value) {
  return String(value || "").replace(/^\\/private/, "");
}

const repoRoot = normalize(realpathSync(process.cwd()));
const canonicalCheckoutPath = normalize(realpathSync(path.resolve(process.env.HATCH_CANONICAL_CHECKOUT_PATH || "")));
const linkPath = path.resolve(os.homedir(), ".local", "share", "pnpm", "hatch-ops");
const cliSource = path.resolve(canonicalCheckoutPath, "packages", "factory-ops", "src", "cli.mjs");
const linkBaseDir = path.dirname(linkPath);

if (repoRoot !== canonicalCheckoutPath) {
  process.stdout.write("[post-commit] Skipping hatch-ops relink reason=current_checkout_not_canonical\\n");
  process.exit(0);
}

mkdirSync(linkBaseDir, { recursive: true });
const relativeTarget = path.relative(linkBaseDir, cliSource);
try {
  if (lstatSync(linkPath).isSymbolicLink() && readlinkSync(linkPath) === relativeTarget) {
    process.stdout.write(\`[post-commit] Linked hatch-ops -> \${cliSource}\\n\`);
    process.exit(0);
  }
} catch {}

try {
  unlinkSync(linkPath);
} catch {}

symlinkSync(relativeTarget, linkPath);
process.stdout.write(\`[post-commit] Linked hatch-ops -> \${cliSource}\\n\`);
`);
  chmodSync(join(repoDir, "scripts", "relink-global-cli.mjs"), 0o755);
  chmodSync(join(repoDir, ".githooks", "post-commit"), 0o755);
}

function makeNpmStub(binDir) {
  const npmPath = join(binDir, "npm");
  writeFile(npmPath, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(npmPath, 0o755);
}

test("post-commit relinks hatch-ops only from the canonical checkout", () => {
  const canonicalRepoDir = mkdtempSync(join(tmpdir(), "post-commit-canonical-"));
  const homeDir = mkdtempSync(join(tmpdir(), "post-commit-home-"));
  const binDir = mkdtempSync(join(tmpdir(), "post-commit-bin-"));
  setupHookRepo(canonicalRepoDir);
  makeNpmStub(binDir);

  const run = spawnSync("bash", [".githooks/post-commit"], {
    cwd: canonicalRepoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_CANONICAL_CHECKOUT_PATH: canonicalRepoDir,
    },
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const linkLine = `${run.stdout}${run.stderr}`.split("\n").find((line) => line.includes("[post-commit] Linked hatch-ops -> "));
  const linkPath = join(realpathSync(homeDir), ".local", "share", "pnpm", "hatch-ops");
  assert.equal(Boolean(linkLine), true, `${run.stdout}\n${run.stderr}`);
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(
    normalizeMacPrivatePrefix(resolve(dirname(linkPath), readlinkSync(linkPath))),
    normalizeMacPrivatePrefix(join(canonicalRepoDir, "packages", "factory-ops", "src", "cli.mjs")),
  );
});

test("post-commit refuses to relink from a non-canonical checkout", () => {
  const canonicalRepoDir = mkdtempSync(join(tmpdir(), "post-commit-canonical-target-"));
  const waveRepoDir = mkdtempSync(join(tmpdir(), "post-commit-wave-"));
  const homeDir = mkdtempSync(join(tmpdir(), "post-commit-home-"));
  const binDir = mkdtempSync(join(tmpdir(), "post-commit-bin-"));
  setupHookRepo(canonicalRepoDir);
  setupHookRepo(waveRepoDir);
  makeNpmStub(binDir);
  const resolvedHomeDir = realpathSync(homeDir);

  const linkDir = join(resolvedHomeDir, ".local", "share", "pnpm");
  const oldTarget = join(resolvedHomeDir, "old-cli.mjs");
  mkdirSync(linkDir, { recursive: true });
  writeFile(oldTarget, "export default 'old';\n");
  symlinkSync(oldTarget, join(linkDir, "hatch-ops"));

  const run = spawnSync("bash", [".githooks/post-commit"], {
    cwd: waveRepoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_CANONICAL_CHECKOUT_PATH: canonicalRepoDir,
    },
  });

  const linkPath = join(linkDir, "hatch-ops");
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(realpathSync(linkPath), realpathSync(oldTarget));
  assert.equal(readlinkSync(linkPath), oldTarget);
  assert.match(`${run.stdout}${run.stderr}`, /reason=current_checkout_not_canonical/);
});
