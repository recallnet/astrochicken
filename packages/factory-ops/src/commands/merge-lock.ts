import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const STALE_MS = 300000; // 5 minutes
const POLL_SECONDS = 3;
const TIMEOUT_MS = 300000; // 5 minutes

export function acquireMergeLock({ repo = "." } = {}) {
  const lockPath = join(String(repo || "."), ".hatch", "merge.lock");
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    // Check for existing lock
    if (existsSync(lockPath)) {
      try {
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        if (Date.now() - lock.ts > STALE_MS) {
          // Stale lock — reclaim
          unlinkSync(lockPath);
        } else {
          // Active lock — wait and retry
          spawnSync("sleep", [String(POLL_SECONDS)]);
          continue;
        }
      } catch {
        // Corrupt lock file — remove and retry
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }

    // Try atomic create
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: "wx" });
      return { lock_acquired: "true" };
    } catch {
      // Another process created the file between our check and write — retry
      spawnSync("sleep", [String(POLL_SECONDS)]);
    }
  }

  return { lock_acquired: "false", reason: "timeout" };
}

export function releaseMergeLock({ repo = "." } = {}) {
  const lockPath = join(String(repo || "."), ".hatch", "merge.lock");
  try { unlinkSync(lockPath); } catch { /* ignore — idempotent */ }
  return { lock_released: "true" };
}
