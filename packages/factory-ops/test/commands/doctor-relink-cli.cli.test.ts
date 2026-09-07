import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("doctor relink-cli links hatch-ops from the canonical checkout", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "doctor-relink-home-"));
  const resolvedHomeDir = realpathSync(homeDir);
  const run = spawnSync("node", [opsCliPath, "doctor", "relink-cli"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_FACTORY_MUTATION_CONTEXT_JSON: undefined,
      HOME: homeDir,
      HATCH_CANONICAL_CHECKOUT_PATH: repoRoot,
    },
  });

  const payload = JSON.parse(run.stdout.trim());
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(payload.reason === "linked" || payload.reason === "already_linked", true);
  const linkPath = String(payload.link_path || join(resolvedHomeDir, ".local", "share", "pnpm", "hatch-ops"));
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(resolve(dirname(linkPath), readlinkSync(linkPath)), join(repoRoot, "packages", "factory-ops", "src", "cli.ts"));
});

test("doctor relink-cli fails closed outside the canonical checkout", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "doctor-relink-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "doctor-relink-wave-"));
  const run = spawnSync("node", [opsCliPath, "doctor", "relink-cli"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_FACTORY_MUTATION_CONTEXT_JSON: undefined,
      HOME: homeDir,
      HATCH_CANONICAL_CHECKOUT_PATH: repoRoot,
    },
  });

  const payload = JSON.parse(run.stdout.trim());
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.equal(payload.reason, "current_checkout_not_canonical");
});

test("doctor canonical-checkout reports canonical health from main", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "doctor-relink-home-"));
  const run = spawnSync("node", [opsCliPath, "doctor", "canonical-checkout"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_FACTORY_MUTATION_CONTEXT_JSON: undefined,
      HOME: homeDir,
      HATCH_CANONICAL_CHECKOUT_PATH: repoRoot,
    },
  });

  const payload = JSON.parse(run.stdout.trim());
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.equal(payload.ok, false);
  assert.match(JSON.stringify(payload.checks), /global_cli_not_canonical|git_source_unavailable|canonical_checkout_missing/);
});
