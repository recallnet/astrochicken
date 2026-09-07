import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectCanonicalCheckout,
  repairCanonicalCheckout,
} from "../../src/lib/canonical-checkout-doctor.ts";

function runGit(cwd, args) {
  const out = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return String(out.stdout || "").trim();
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readCurrentBranch(repoPath) {
  return runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function resolveLinkedPath(linkPath) {
  return realpathSync(path.resolve(path.dirname(linkPath), readlinkSync(linkPath)));
}

function createFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "canonical-doctor-"));
  const repoRoot = path.join(root, "source");
  const canonicalPath = path.join(root, "canonical");
  const homeDir = path.join(root, "home");
  const hostBaseDir = path.join(root, "hosts");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(hostBaseDir, { recursive: true });

  runGit(root, ["init", "--initial-branch=main", repoRoot]);
  runGit(repoRoot, ["config", "user.email", "doctor@example.com"]);
  runGit(repoRoot, ["config", "user.name", "Doctor"]);

  writeJson(path.join(repoRoot, "factories", "mothership", "factory.config.json"), {
    schema: "hatch.factory.config.v1",
    factory_id: "mothership",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: 407,
    model: "test-model",
    provider: "test-provider",
    canonical_checkout_path: canonicalPath,
  });
  mkdirSync(path.join(repoRoot, "packages", "factory-ops", "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "packages", "factory-ops", "src", "cli.ts"),
    "#!/usr/bin/env node\nif (process.argv.includes('resolve-default')) process.stdout.write('ok\\n');\n",
  );
  mkdirSync(path.join(repoRoot, "apps", "hatch", "dist"), { recursive: true });
  writeFileSync(path.join(repoRoot, "apps", "hatch", "dist", "index.js"), "export const ok = true;\n");
  writeFileSync(
    path.join(repoRoot, "apps", "hatch", "dist", "cli.js"),
    "#!/usr/bin/env node\nif (process.argv.includes('--help')) process.stdout.write('help\\n');\n",
  );
  writeFileSync(path.join(repoRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "-m", "fixture"]);

  return { root, repoRoot, canonicalPath, homeDir, hostBaseDir };
}

test("canonical doctor inspects a healthy canonical checkout", () => {
  const fixture = createFixtureRepo();
  try {
    runGit(fixture.repoRoot, ["checkout", "-b", "wave/source"]);
    runGit(fixture.repoRoot, ["worktree", "add", fixture.canonicalPath, "main"]);
    runGit(fixture.canonicalPath, ["checkout", "--force", "main"]);
    const linkDir = path.join(fixture.homeDir, ".local", "share", "pnpm");
    mkdirSync(linkDir, { recursive: true });
    const cliSource = path.join(fixture.canonicalPath, "packages", "factory-ops", "src", "cli.ts");
    const linkPath = path.join(linkDir, "hatch-ops");
    const relativeTarget = path.relative(linkDir, cliSource);
    const linked = spawnSync("ln", ["-s", relativeTarget, linkPath], { encoding: "utf8" });
    assert.equal(linked.status, 0, linked.stderr || linked.stdout);

    const out = inspectCanonicalCheckout({
      repoRoot: fixture.repoRoot,
      env: (({ HATCH_FACTORY_MUTATION_CONTEXT_JSON: _mc, ...rest }) => ({ ...rest, HATCH_HOST_BASE_DIR: fixture.hostBaseDir }))(process.env),
      homeDir: fixture.homeDir,
    });

    assert.equal(out.ok, true, JSON.stringify(out, null, 2));
    assert.equal(out.checks.every((check) => check.ok), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("canonical doctor repair recreates missing canonical checkout and relinks hatch-ops", () => {
  const fixture = createFixtureRepo();
  try {
    const out = repairCanonicalCheckout({
      repoRoot: fixture.repoRoot,
      env: (({ HATCH_FACTORY_MUTATION_CONTEXT_JSON: _mc, ...rest }) => ({ ...rest, HATCH_HOST_BASE_DIR: fixture.hostBaseDir }))(process.env),
      homeDir: fixture.homeDir,
    });

    assert.equal(out.ok, true, JSON.stringify(out, null, 2));
    assert.equal(out.status, "repaired");
    assert.equal(readCurrentBranch(fixture.canonicalPath), "main");
    const linkPath = path.join(fixture.homeDir, ".local", "share", "pnpm", "hatch-ops");
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(
      resolveLinkedPath(linkPath),
      realpathSync(path.join(fixture.canonicalPath, "packages", "factory-ops", "src", "cli.ts")),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("canonical doctor repair persists a supervisor packet on unsafe canonical shell deadends", () => {
  const fixture = createFixtureRepo();
  try {
    mkdirSync(fixture.canonicalPath, { recursive: true });
    writeFileSync(path.join(fixture.canonicalPath, "package.json"), "{\n  \"name\": \"unexpected\"\n}\n");

    const out = repairCanonicalCheckout({
      repoRoot: fixture.repoRoot,
      env: (({ HATCH_FACTORY_MUTATION_CONTEXT_JSON: _mc, ...rest }) => ({ ...rest, HATCH_HOST_BASE_DIR: fixture.hostBaseDir }))(process.env),
      homeDir: fixture.homeDir,
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "deadend");
    assert.equal(String(out.packet?.packet_type || ""), "canonical_checkout_recovery");
    const packet = JSON.parse(readFileSync(out.packet.packet_path, "utf8"));
    assert.equal(packet.packet_type, "canonical_checkout_recovery");
    assert.equal(packet.handoff_kind, "supervisor_recovery");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("canonical doctor flags unapproved disposable worktrees in the registry", () => {
  const fixture = createFixtureRepo();
  try {
    const badWorktreePath = path.join(fixture.root, ".hatch-worktrees", "bad", "wave-1");
    runGit(fixture.repoRoot, ["worktree", "add", "-b", "wave/test", badWorktreePath]);

    const out = inspectCanonicalCheckout({
      repoRoot: fixture.repoRoot,
      env: (({ HATCH_FACTORY_MUTATION_CONTEXT_JSON: _mc, ...rest }) => ({ ...rest, HATCH_HOST_BASE_DIR: fixture.hostBaseDir }))(process.env),
      homeDir: fixture.homeDir,
    });
    const registry = out.checks.find((check) => check.id === "protected_worktree_registry_sane");
    assert.equal(registry?.ok, false);
    assert.match(String(registry?.issues?.[0] || ""), /unapproved_disposable_root/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
