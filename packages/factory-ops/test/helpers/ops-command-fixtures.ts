import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runFixtureCommand(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

export function makeHostRegistryRow() {
  return {
    instance_id: "mothership",
    kind_id: "mothership",
    target_repo: "recallnet/astrochicken",
    status: "active",
    assigned_host_id: "unassigned",
    installation_manifest_path: "",
    graphs: [],
    daemonStatus: { status: "stopped" },
  };
}

export function makeOpsTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeHostRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

export function readFixtureText(path) {
  return readFileSync(path, "utf8");
}

export function writeInstallationManifest(root, payload = {}) {
  mkdirSync(root, { recursive: true });
  const path = join(root, "installation.json");
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

export function writeFixtureRunState(runsDir, runId, state) {
  const dir = join(runsDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8");
}

export function assertWorkflowEdgeChain(dot, nodes, message = "workflow edge chain must remain complete") {
  for (let i = 1; i < nodes.length; i += 1) {
    assert.match(dot, new RegExp(`${nodes[i - 1]} -> ${nodes[i]}(?:\\s|$)`), message);
  }
}

export function readFixtureJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeFixtureJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export function createBaseGitFixture(prefix) {
  const repo = makeOpsTempDir(prefix);
  runFixtureCommand(["git", "init", "-b", "main"], repo);
  runFixtureCommand(["git", "config", "user.email", "taxi@example.com"], repo);
  runFixtureCommand(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  runFixtureCommand(["git", "add", "file.txt"], repo);
  runFixtureCommand(["git", "commit", "-m", "base"], repo);
  return repo;
}

export function successfulCommandResult(stdout = "") {
  return { ok: true, status: 0, stdout, stderr: "" };
}
