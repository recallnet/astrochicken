import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireMergeLock, releaseMergeLock } from "../../src/commands/merge-lock.ts";

function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), "taxi-merge-lock-"));
  return dir;
}

test("acquireMergeLock creates lock file and returns acquired=true", () => {
  const repo = tmpRepo();
  const out = acquireMergeLock({ repo });
  assert.equal(out.lock_acquired, "true");
  assert.ok(existsSync(join(repo, ".hatch", "merge.lock")));
});

test("acquireMergeLock lock file contains pid and timestamp", () => {
  const repo = tmpRepo();
  acquireMergeLock({ repo });
  const lock = JSON.parse(readFileSync(join(repo, ".hatch", "merge.lock"), "utf8"));
  assert.equal(lock.pid, process.pid);
  assert.ok(typeof lock.ts === "number");
  assert.ok(lock.ts > 0);
});

test("releaseMergeLock removes lock file", () => {
  const repo = tmpRepo();
  acquireMergeLock({ repo });
  assert.ok(existsSync(join(repo, ".hatch", "merge.lock")));
  const out = releaseMergeLock({ repo });
  assert.equal(out.lock_released, "true");
  assert.ok(!existsSync(join(repo, ".hatch", "merge.lock")));
});

test("releaseMergeLock is idempotent (no error if lock doesn't exist)", () => {
  const repo = tmpRepo();
  const out = releaseMergeLock({ repo });
  assert.equal(out.lock_released, "true");
});

test("acquireMergeLock reclaims stale lock (timestamp > 5min old)", () => {
  const repo = tmpRepo();
  const lockDir = join(repo, ".hatch");
  mkdirSync(lockDir, { recursive: true });
  // Write a stale lock (6 minutes old)
  const staleLock = { pid: 99999, ts: Date.now() - 360000 };
  writeFileSync(join(lockDir, "merge.lock"), JSON.stringify(staleLock), { flag: "wx" });

  const out = acquireMergeLock({ repo });
  assert.equal(out.lock_acquired, "true");
  // Lock should now be ours
  const lock = JSON.parse(readFileSync(join(lockDir, "merge.lock"), "utf8"));
  assert.equal(lock.pid, process.pid);
});

test("acquireMergeLock acquire-release-acquire cycle works", () => {
  const repo = tmpRepo();
  const a1 = acquireMergeLock({ repo });
  assert.equal(a1.lock_acquired, "true");
  releaseMergeLock({ repo });
  const a2 = acquireMergeLock({ repo });
  assert.equal(a2.lock_acquired, "true");
});
