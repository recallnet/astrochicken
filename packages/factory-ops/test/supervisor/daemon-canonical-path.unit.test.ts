import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { evaluateDaemonStartupInvariants } from "../../src/lib/daemon.ts";

const tempDirs = [];
function makeTmpDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

for (const factory of ["mothership", "managed"]) {
  test(`evaluateDaemonStartupInvariants blocks canonical symlink aliases for ${factory}`, () => {
    const root = makeTmpDir("daemon-canonical-alias-");
    const canonical = path.join(root, "canonical");
    const alias = path.join(root, "alias");
    mkdirSync(canonical);
    symlinkSync(canonical, alias);
    const result = evaluateDaemonStartupInvariants({
      factoryId: factory === "managed" ? "example-trading" : factory,
      repoRoot: alias,
      canonicalCheckoutPath: canonical,
      config: { managed: factory === "managed" },
      currentBranch: factory === "managed" ? "main" : "wave/alias-bypass",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, factory === "managed"
      ? "managed_factory_cannot_run_from_canonical_checkout"
      : "canonical_checkout_requires_main");
    assert.equal(result.running_from_canonical, true);
  });
}

test("evaluateDaemonStartupInvariants denies unresolved canonical filesystem paths", () => {
  const root = makeTmpDir("daemon-canonical-loop-");
  const loop = path.join(root, "loop");
  symlinkSync(loop, loop);
  for (const paths of [
    { repoRoot: root, canonicalCheckoutPath: loop },
    { repoRoot: loop, canonicalCheckoutPath: root },
  ]) {
    const result = evaluateDaemonStartupInvariants({
      factoryId: "mothership",
      ...paths,
      currentBranch: "main",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "filesystem_path_resolution_failed");
  }
});
