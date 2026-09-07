import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveHostPaths,
  hostInstall,
  hostStart,
  hostStop,
  hostRestart,
  hostHealth,
  hostVersion,
} from "../../src/commands/factory-host-lifecycle.ts";
import { ensureResumeReady } from "../../src/commands/factory-resume-gate.ts";

function writeDaemonStubWithVersion(rootDir, versionFile) {
  const daemonScript = join(rootDir, "daemon_stub.sh");
  writeFileSync(daemonScript, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "factory=${"$"}{HATCH_FACTORY_ID:-unknown}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
trap 'rm -f "$FACTORY_DAEMON_PID_FILE"; exit 0' TERM INT
while true; do sleep 1; done
`);
  chmodSync(daemonScript, 0o755);

  const versionScript = join(rootDir, "version_stub.sh");
  writeFileSync(versionScript, `#!/usr/bin/env bash
set -eu
cat "${versionFile}"
`);
  chmodSync(versionScript, 0o755);

  const updateScript = join(rootDir, "self_update_stub.sh");
  writeFileSync(updateScript, `#!/usr/bin/env bash
set -eu
version="$(cat "${versionFile}" | tr -d '\\r\\n')"
version="${"$"}{version#v}"
IFS=. read -r major minor patch <<EOF
${"$"}version
EOF
patch="${"$"}{patch:-0}"
patch=$((patch + 1))
printf "%s.%s.%s\\n" "${"$"}major" "${"$"}minor" "${"$"}patch" > "${versionFile}"
`);
  chmodSync(updateScript, 0o755);

  return {
    daemonScript,
    versionScript,
    updateScript,
    versionFile,
  };
}

async function waitForPidFile(pidFile, { maxMs = 3000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() <= deadline) {
    if (existsSync(pidFile)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pid_file_timeout:${pidFile}`);
}

test("ensureResumeReady self-update loop: factory_release_below_required → update → recheck → can_resume", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-self-update-gate-"));
  const versionFile = join(rootDir, "VERSION");
  writeFileSync(versionFile, "0.1.0\n", "utf8");

  try {
    const { updateScript } = writeDaemonStubWithVersion(rootDir, versionFile);
    let checkCount = 0;

    const out = ensureResumeReady({
      controlPlaneRepo: "recallnet/astrochicken",
      sourceRepo: "example-org/ext",
      sourceIssueNumber: 1,
      localFactoryReleaseCommand: `cat "${versionFile}"`,
      selfUpdateCommand: updateScript,
      manifestPath: ".hatch/releases/stable/release-manifest.json",
      fetchManifestFn: () => ({
        ok: true,
        selected_channel: "general",
        source: "test",
        manifest_ref: "main",
        manifest_path: ".hatch/releases/stable/release-manifest.json",
        manifest: {
          schema_version: "factory_release_manifest/v1",
          release: { control_plane_repo: "recallnet/astrochicken", sha: "abc", tag: "v0.1.1" },
          rollout: { controller: { status: "promoted", stage: "general", resume_blocked: false, canary_factory_ids: [] } },
          compatibility_matrix: { required_factory_release_floor: "0.1.1" },
          artifacts: [
            {
              source_repo: "example-org/ext",
              source_issue: 1,
              required_factory_release: "0.1.1",
              linkage: {
                schema_version: "factory_link.v1",
                source_repo: "example-org/ext",
                source_issue: 1,
                control_plane_repo: "recallnet/astrochicken",
                control_plane_goal: 2001,
                signature_hash: "sha256:self-update",
                factory_id: "external/self-update",
                required_factory_release: "0.1.1",
                status: "blocked_on_goal",
              },
            },
          ],
        },
      }),
      checkResumeGateFn: ({ localFactoryRelease, requiredFactoryRelease }) => {
        checkCount += 1;
        if (checkCount === 1) {
          return {
            ok: true,
            can_resume: false,
            reason: "factory_release_below_required",
            goal: { number: 2001, state: "CLOSED", url: "https://example/2001", title: "Goal" },
            local_factory_release: localFactoryRelease,
            required_factory_release: requiredFactoryRelease,
          };
        }

        return {
          ok: true,
          can_resume: true,
          reason: "ready_to_resume",
          goal: { number: 2001, state: "CLOSED", url: "https://example/2001", title: "Goal" },
          local_factory_release: localFactoryRelease,
          required_factory_release: requiredFactoryRelease,
        };
      },
    });

    assert.equal(out.attempted_self_update, true);
    assert.equal(out.self_update_ok, true);
    assert.equal(out.local_factory_release_before, "0.1.0");
    assert.notEqual(out.local_factory_release_after, "0.1.0");
    assert.equal(out.local_factory_release_before !== out.local_factory_release_after, true);
    assert.equal(out.can_resume, true);
    assert.equal(checkCount, 2);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("hostStart → self-update → hostRestart → hostVersion and hostHealth reflect updated state", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-self-update-restart-"));
  const versionFile = join(rootDir, "VERSION");
  writeFileSync(versionFile, "1.0.0\n", "utf8");

  const { daemonScript, versionScript, updateScript } = writeDaemonStubWithVersion(rootDir, versionFile);
  const paths = resolveHostPaths({ factoryId: "selfupdate-test", baseDir: rootDir });

  try {
    hostInstall(paths);

    const start = await hostStart({
      factoryId: "selfupdate-test",
      daemonScript,
      env: {
        HATCH_FACTORY_ID: "selfupdate-test",
        HATCH_RUNS_DIR: paths.runsDir,
        FACTORY_DAEMON_LOG_DIR: paths.logsDir,
        FACTORY_DAEMON_PID_DIR: paths.pidDir,
        FACTORY_DAEMON_PID_FILE: paths.pidFile,
        FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
      },
      detach: true,
      pidFile: paths.pidFile,
      paths,
    });
    assert.equal(start.ok, true, start.message);

    await waitForPidFile(paths.pidFile, { maxMs: 3000, intervalMs: 100 });

    const healthBefore = hostHealth({
      factoryId: "selfupdate-test",
      pidFile: paths.pidFile,
      runsDir: paths.runsDir,
      logsDir: paths.logsDir,
      paths,
    });
    assert.equal(healthBefore.status, "running");
    const pidBefore = healthBefore.pid;

    const update = spawnSync("bash", ["-lc", `"${updateScript}"`], { encoding: "utf8" });
    assert.equal(update.status, 0, update.stderr);

    const restart = await hostRestart({
      factoryId: "selfupdate-test",
      daemonScript,
      env: {
        HATCH_FACTORY_ID: "selfupdate-test",
        HATCH_RUNS_DIR: paths.runsDir,
        FACTORY_DAEMON_LOG_DIR: paths.logsDir,
        FACTORY_DAEMON_PID_DIR: paths.pidDir,
        FACTORY_DAEMON_PID_FILE: paths.pidFile,
        FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
      },
      detach: true,
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 3000,
      paths,
    });
    assert.equal(restart.ok, true, restart.message);

    await waitForPidFile(paths.pidFile, { maxMs: 3000, intervalMs: 100 });

    const versionAfter = hostVersion({
      factoryId: "selfupdate-test",
      factoryRoot: rootDir,
      releaseCommand: `"${versionScript}"`,
      paths,
    });

    const healthAfter = hostHealth({
      factoryId: "selfupdate-test",
      pidFile: paths.pidFile,
      runsDir: paths.runsDir,
      logsDir: paths.logsDir,
      paths,
    });

    assert.equal(healthAfter.status, "running");
    assert.notEqual(healthAfter.pid, pidBefore);
    assert.equal(versionAfter.version, "1.0.1");
  } finally {
    await hostStop({
      factoryId: "selfupdate-test",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 1000,
      paths,
    });
    rmSync(rootDir, { recursive: true, force: true });
  }
});
