import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function writeWorkspace(rootDir, { workspaceName = "@hatch/example", lockfilePackages = {} } = {}) {
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({
    name: "root",
    private: true,
    workspaces: ["packages/*"],
    packageManager: "pnpm@10.32.1",
  }, null, 2));
  writeFileSync(join(rootDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  writeFileSync(join(rootDir, "pnpm-lock.yaml"), [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .: {}",
    ...Object.entries(lockfilePackages).map(([key, value]) => `  ${key}:\n    ${value}`),
    "",
  ].join("\n"));
  mkdirSync(join(rootDir, "packages", "example"), { recursive: true });
  writeFileSync(join(rootDir, "packages", "example", "package.json"), JSON.stringify({
    name: workspaceName,
    version: "0.0.0",
  }, null, 2));
}

test("check-lockfile-sync passes when pnpm lockfile includes workspace importer", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pnpm-lock-sync-ok-"));
  writeWorkspace(rootDir, { lockfilePackages: { "packages/example": "{}" } });
  const result = spawnSync("node", ["/path/to/astrochicken-pnpm-worktrees/scripts/check-lockfile-sync.ts"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[lockfile-sync\] result=ok/);
});

test("check-lockfile-sync fails when pnpm lockfile is missing a workspace importer", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pnpm-lock-sync-fail-"));
  writeWorkspace(rootDir, { lockfilePackages: {} });
  const result = spawnSync("node", ["/path/to/astrochicken-pnpm-worktrees/scripts/check-lockfile-sync.ts"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing from pnpm-lock\.yaml/);
  assert.match(result.stderr, /run `pnpm install` to regenerate pnpm-lock\.yaml`?/);
});
