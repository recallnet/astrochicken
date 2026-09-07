import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function which(bin) {
  const p = spawnSync("which", [bin], { encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error(`missing binary: ${bin}`);
  return String(p.stdout || "").trim();
}

export function withInjectedGitFailure({ match, code = 1, stderr = "injected git failure" }, fn) {
  const realGit = which("git");
  const dir = mkdtempSync(join(tmpdir(), "fake-git-"));
  const fakeGit = join(dir, "git");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${"$"}FAKE_GIT_FAIL_MATCH" && "${"$"}*" == *"${"$"}FAKE_GIT_FAIL_MATCH"* ]]; then
  echo "${"$"}FAKE_GIT_FAIL_STDERR" >&2
  exit ${"$"}FAKE_GIT_FAIL_CODE
fi
exec "${"$"}REAL_GIT_BIN" "${"$"}@"
`;
  writeFileSync(fakeGit, script, "utf8");
  chmodSync(fakeGit, 0o755);

  const oldPath = process.env.PATH || "";
  const oldRealGit = process.env.REAL_GIT_BIN;
  const oldMatch = process.env.FAKE_GIT_FAIL_MATCH;
  const oldCode = process.env.FAKE_GIT_FAIL_CODE;
  const oldStderr = process.env.FAKE_GIT_FAIL_STDERR;

  process.env.PATH = `${dir}:${oldPath}`;
  process.env.REAL_GIT_BIN = realGit;
  process.env.FAKE_GIT_FAIL_MATCH = String(match || "");
  process.env.FAKE_GIT_FAIL_CODE = String(code);
  process.env.FAKE_GIT_FAIL_STDERR = String(stderr || "injected git failure");

  try {
    return fn();
  } finally {
    process.env.PATH = oldPath;
    if (oldRealGit === undefined) delete process.env.REAL_GIT_BIN; else process.env.REAL_GIT_BIN = oldRealGit;
    if (oldMatch === undefined) delete process.env.FAKE_GIT_FAIL_MATCH; else process.env.FAKE_GIT_FAIL_MATCH = oldMatch;
    if (oldCode === undefined) delete process.env.FAKE_GIT_FAIL_CODE; else process.env.FAKE_GIT_FAIL_CODE = oldCode;
    if (oldStderr === undefined) delete process.env.FAKE_GIT_FAIL_STDERR; else process.env.FAKE_GIT_FAIL_STDERR = oldStderr;
  }
}
