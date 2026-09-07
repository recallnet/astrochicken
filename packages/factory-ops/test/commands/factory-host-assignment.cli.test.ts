import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const factoryRoot = join(repoRoot, "factories/mothership");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args, { expectStatus = 0, env = process.env } = {}) {
  // Always clear mutation-context env var so the CLI does not inherit the live
  // factory's path policy, which would reject isolated test temp-dir paths.
  const safeEnv = { ...env };
  delete safeEnv["HATCH_FACTORY_MUTATION_CONTEXT_JSON"];
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: safeEnv,
  });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  const stdout = String(run.stdout || "").trim();
  return {
    ...run,
    payload: stdout ? JSON.parse(stdout) : {},
  };
}

function writeRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

function writeManifest(root, payload = {}) {
  mkdirSync(root, { recursive: true });
  const path = join(root, "installation.json");
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function registryRow() {
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

test("factory host-assign writes lease file + registry and host-assignment-status reports state", () => {
  const root = makeTmpDir("factory-host-assignment-cli-");
  try {
    const hostBaseDir = join(root, ".hatch", "hosts");
    const installationDir = join(hostBaseDir, "mothership");
    const installationManifestPath = writeManifest(installationDir, {
      installation_id: "inst_mothership_host_cli",
      instance_id: "mothership",
      host_id: "host_cli",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: join(installationDir, "logs"),
      artifact_dir: join(installationDir, "artifacts"),
      runtime_version: "3.4.5",
    });
    const registryPath = writeRegistry(root, [registryRow()]);

    const assigned = runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_cli",
      "--registry-path", registryPath,
      "--installation-manifest-path", installationManifestPath,
      "--lease-ttl", "600",
    ]).payload;

    assert.equal(assigned.ok, true);
    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.assigned_host_id, "host_cli");
    assert.equal(typeof assigned.lease, "object");
    assert.equal(assigned.lease.lease_ttl_sec, 600);

    const status = runCli([
      "factory", "host-assignment-status",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--registry-path", registryPath,
      "--installation-manifest-path", installationManifestPath,
    ]).payload;

    assert.equal(status.ok, true);
    assert.equal(status.status, "ok");
    assert.equal(status.assigned_host_id, "host_cli");
    assert.equal(status.lease_present, true);
    assert.equal(status.lease.host_id, "host_cli");

    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.equal(registry.instances[0].assigned_host_id, "host_cli");
    assert.equal(registry.instances[0].installation_manifest_path, installationManifestPath);

    const leasePath = join(installationDir, "lease.json");
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    assert.equal(lease.host_id, "host_cli");
    assert.equal(lease.runtime_version, "3.4.5");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory host-assign is idempotent when same host reassigns", () => {
  const root = makeTmpDir("factory-host-assignment-cli-idempotent-");
  try {
    const hostBaseDir = join(root, ".hatch", "hosts");
    const installationDir = join(hostBaseDir, "mothership");
    const installationManifestPath = writeManifest(installationDir, {
      installation_id: "inst_mothership_host_cli_same",
      instance_id: "mothership",
      host_id: "host_same",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: join(installationDir, "logs"),
      artifact_dir: join(installationDir, "artifacts"),
      runtime_version: "3.4.5",
    });
    const registryPath = writeRegistry(root, [{
      ...registryRow(),
      assigned_host_id: "host_same",
      installation_manifest_path: installationManifestPath,
    }]);

    const first = runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_same",
      "--registry-path", registryPath,
      "--installation-manifest-path", installationManifestPath,
    ]).payload;
    const second = runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_same",
      "--registry-path", registryPath,
      "--installation-manifest-path", installationManifestPath,
    ]).payload;

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.assigned_host_id, "host_same");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory host-assign exits non-zero when installation manifest is missing", () => {
  const root = makeTmpDir("factory-host-assignment-cli-missing-manifest-");
  try {
    const hostBaseDir = join(root, ".hatch", "hosts");
    const registryPath = writeRegistry(root, [registryRow()]);
    const missingManifest = join(hostBaseDir, "mothership", "installation.json");

    const run = runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_cli",
      "--registry-path", registryPath,
      "--installation-manifest-path", missingManifest,
    ], { expectStatus: 1 });

    assert.equal(run.payload.ok, false);
    assert.equal(run.payload.error_code, "host_assignment_manifest_missing");
    assert.match(String(run.stderr || ""), /installation_manifest_not_found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory host-assign exits non-zero with ambiguous_host_assignment on conflicting host", () => {
  const root = makeTmpDir("factory-host-assignment-cli-conflict-");
  try {
    const hostBaseDir = join(root, ".hatch", "hosts");
    const installationDir = join(hostBaseDir, "mothership");
    const installationManifestPath = writeManifest(installationDir, {
      installation_id: "inst_mothership_host_cli_b",
      instance_id: "mothership",
      host_id: "host_b",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: join(installationDir, "logs"),
      artifact_dir: join(installationDir, "artifacts"),
      runtime_version: "3.4.5",
    });
    const registryPath = writeRegistry(root, [{
      ...registryRow(),
      assigned_host_id: "host_a",
      installation_manifest_path: installationManifestPath,
    }]);

    const leasePath = join(installationDir, "lease.json");
    const beforeRegistry = readFileSync(registryPath, "utf8");

    const run = runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_b",
      "--registry-path", registryPath,
      "--installation-manifest-path", installationManifestPath,
    ], { expectStatus: 1 });

    assert.equal(run.payload.ok, false);
    assert.equal(run.payload.error_code, "ambiguous_host_assignment");
    assert.match(String(run.stderr || ""), /ambiguous_host_assignment/);
    assert.equal(readFileSync(registryPath, "utf8"), beforeRegistry);
    assert.equal(existsSync(leasePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
