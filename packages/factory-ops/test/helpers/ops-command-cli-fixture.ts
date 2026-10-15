import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../../../..");
export const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

export function createRecordingGhFixture(prefix, script) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const statePath = join(root, "state.json");
  const ghPath = join(root, "gh");
  writeFileSync(statePath, JSON.stringify({ calls: [] }, null, 2), "utf8");
  writeFileSync(ghPath, `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.HATCH_TEST_GH_STATE_PATH;
const mode = process.env.HATCH_TEST_GH_MODE || "ok";
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls.push(args);
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
${script}
`, "utf8");
  chmodSync(ghPath, 0o755);
  return {
    binDir: root,
    statePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function runRecordingOpsCliResult(args = [], { binDir, statePath, mode = "ok", expectedStatus = 0, extraEnv = {} } = {}) {
  const out = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_TEST_GH_STATE_PATH: statePath,
      HATCH_TEST_GH_MODE: mode,
      ...extraEnv,
    },
  });
  assert.equal(out.status, expectedStatus, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  return {
    json: JSON.parse(String(out.stdout || "{}").trim() || "{}"),
    stdout: String(out.stdout || ""),
    stderr: String(out.stderr || ""),
  };
}

export function readGhCalls(statePath) {
  return JSON.parse(readFileSync(statePath, "utf8")).calls || [];
}

export function runRecordingOpsCli(args = [], options = {}) {
  return runRecordingOpsCliResult(args, options).json;
}

export function mothershipFactoryCliArgs(root) {
  return [
    "--factory-root",
    join(root, "factories", "mothership"),
    "--factory-config-path",
    join(root, "factories", "mothership", "factory.config.json"),
    "--factory-id",
    "mothership",
    "--registry-path",
    join(root, "factory-registry.json"),
  ];
}

export function spawnOpsCli(args, options = {}) {
  return spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}
