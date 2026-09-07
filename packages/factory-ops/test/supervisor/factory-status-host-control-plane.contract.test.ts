import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";

import { factoryStatus } from "../../src/commands/factory-status.ts";
import { buildReleaseManifest, syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const canonicalEventStore = createCanonicalEventStoreFixture();

before(async () => {
  await canonicalEventStore.setup();
});

after(() => {
  canonicalEventStore.teardown();
});

function buildControlPlaneManifestFixture({ status = "promoted", reason = "" } = {}) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseSha: "abc123",
    releaseTag: "v9.9.9",
    entries: [{
      source_repo: "example/external-factory",
      source_issue: 42,
      source_issue_url: "https://example/42",
      summary: "control-plane",
      factory_id: "external/issue_worker",
      required_factory_release: "9.9.9",
      status: "blocked_upstream",
      signature_hash: "sha256:42",
      linkage: {
        schema_version: "factory_link.v1",
        linkage_key: "sha256:42",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 9001,
        source_repo: "example/external-factory",
        source_issue: 42,
        status: "blocked_upstream",
        factory_id: "external/issue_worker",
        required_factory_release: "9.9.9",
        signature_hash: "sha256:42",
      },
    }],
  });

  manifest.rollout.controller = {
    ...manifest.rollout.controller,
    status,
    stage: status === "canary_in_progress" ? "canary" : "general",
    resume_blocked: status === "rolled_back",
    rollback_reason: reason,
    publish: {
      release_id: "v9.9.9",
      release_tag: "v9.9.9",
      release_sha: "abc123",
      asset_id: "asset-555",
      asset_url: "https://example/assets/555",
      manifest_path: "control-plane-manifests/release-manifest.json",
      published_at: "2026-03-08T00:00:00.000Z",
    },
  };

  return manifest;
}

function writeExternalControlState({ rootDir, factoryId, state }) {
  const controlStatePath = join(rootDir, ".hatch", "factories", factoryId, "control-state.json");
  mkdirSync(dirname(controlStatePath), { recursive: true });
  writeFileSync(controlStatePath, JSON.stringify(state, null, 2));
  return controlStatePath;
}

function git(args, cwd) {
  return String(execFileSync("git", args, { cwd, stdio: "pipe" })).trim();
}

test("factoryStatus prefers control-plane manifests from factory context repo over host-scoped runs dir", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-host-runs-control-plane-"));
  const canonicalRepoRoot = join(rootDir, "astrochicken");
  const hostRoot = join(rootDir, "host-runtime");
  const hostRunsDir = join(hostRoot, "mothership", "runs");
  const factoryRoot = join(canonicalRepoRoot, "factories", "mothership");
  mkdirSync(hostRunsDir, { recursive: true });
  mkdirSync(factoryRoot, { recursive: true });
  writeFileSync(join(factoryRoot, "factory.config.json"), JSON.stringify({
    factory_id: "mothership",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: "1",
    model: "gpt-5",
    provider: "openai",
  }, null, 2));
  const manifestPath = join(canonicalRepoRoot, ".hatch", "releases", "v9.9.9", "release-manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(buildControlPlaneManifestFixture({ status: "promoted" }), null, 2));
  const syncOut = syncControlPlaneManifest({
    manifestPath,
    repoRoot: canonicalRepoRoot,
  });
  assert.equal(syncOut.ok, true);

  const out = factoryStatus({
    runsDir: hostRunsDir,
    context: {
      factory_id: "mothership",
      factory_root: factoryRoot,
      factory_config_path: join(factoryRoot, "factory.config.json"),
      control_plane_repo: "recallnet/astrochicken",
      canonical_event_store_url: canonicalEventStore.connectionString,
    },
  });

  assert.equal(out.control_plane.resume_reason, "ready_to_resume");
  assert.equal(out.control_plane.manifest.path, ".hatch/releases/stable/release-manifest.json");
  assert.equal(out.managed_state.health_classification, "healthy");
});

test("factoryStatus prefers control-plane control-state from factory context repo over host-scoped runs dir", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-host-runs-control-state-"));
  const canonicalRepoRoot = join(rootDir, "astrochicken");
  const hostRoot = join(rootDir, "host-runtime");
  const hostRunsDir = join(hostRoot, "example-trading", "runs");
  const factoryRoot = join(canonicalRepoRoot, "factories", "example-trading");
  mkdirSync(hostRunsDir, { recursive: true });
  mkdirSync(factoryRoot, { recursive: true });
  writeFileSync(join(factoryRoot, "factory.config.json"), JSON.stringify({
    factory_id: "example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: "1",
    model: "gpt-5",
    provider: "openai",
  }, null, 2));

  const controlStatePath = writeExternalControlState({
    rootDir: canonicalRepoRoot,
    factoryId: "example-trading",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: "daemon",
      reason: "circuit_breaker_blocking_after_1_failures",
      action_state: {
        pause: { active: true },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "run-77",
      notes: [],
    },
  });

  writeExternalControlState({
    rootDir: hostRoot,
    factoryId: "example-trading",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: "managed_supervisor",
      reason: "",
      action_state: {
        pause: { active: false },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({
    runsDir: hostRunsDir,
    context: {
      factory_id: "example-trading",
      factory_root: factoryRoot,
      factory_config_path: join(factoryRoot, "factory.config.json"),
      control_plane_repo: "recallnet/astrochicken",
      canonical_event_store_url: canonicalEventStore.connectionString,
    },
  });

  assert.equal(out.managed_state.state_action, "pause");
  assert.equal(out.managed_state.health_classification, "locally_unhealthy");
  assert.equal(out.managed_state.reason, "circuit_breaker_blocking_after_1_failures");
  assert.equal(realpathSync(out.managed_state.state_path), realpathSync(controlStatePath));
});

test("factoryStatus prefers canonical control-plane control-state when factory_root is a git worktree path", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-worktree-control-state-"));
  const canonicalRepoRoot = join(rootDir, "astrochicken");
  const hostRoot = join(rootDir, "host-runtime");
  const targetRepoRoot = join(rootDir, "example-trading");
  const hostRunsDir = join(targetRepoRoot, ".hatch", "example-trading", "runs");
  mkdirSync(canonicalRepoRoot, { recursive: true });
  mkdirSync(hostRunsDir, { recursive: true });

  git(["init", "-b", "main"], canonicalRepoRoot);
  git(["config", "user.email", "factory@example.com"], canonicalRepoRoot);
  git(["config", "user.name", "Factory Test"], canonicalRepoRoot);
  mkdirSync(join(canonicalRepoRoot, "factories", "example-trading"), { recursive: true });
  writeFileSync(join(canonicalRepoRoot, "README.md"), "# control plane\n");
  writeFileSync(join(canonicalRepoRoot, "factories", "example-trading", "factory.config.json"), JSON.stringify({
    factory_id: "example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: "1",
    model: "gpt-5",
    provider: "openai",
  }, null, 2));
  git(["add", "."], canonicalRepoRoot);
  git(["commit", "-m", "init"], canonicalRepoRoot);

  const worktreeRepoRoot = join(rootDir, "astrochicken-worktree");
  git(["worktree", "add", "-b", "factory-status-worktree", worktreeRepoRoot, "main"], canonicalRepoRoot);
  const worktreeFactoryRoot = join(worktreeRepoRoot, "factories", "example-trading");

  const controlStatePath = writeExternalControlState({
    rootDir: canonicalRepoRoot,
    factoryId: "example-trading",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: "daemon",
      reason: "circuit_breaker_blocking_after_1_failures",
      action_state: {
        pause: { active: true },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "run-77",
      notes: [],
    },
  });

  writeExternalControlState({
    rootDir: targetRepoRoot,
    factoryId: "example-trading",
    state: {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: "managed_supervisor",
      reason: "",
      action_state: {
        pause: { active: false },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: "",
      notes: [],
    },
  });

  const out = factoryStatus({
    runsDir: hostRunsDir,
    context: {
      factory_id: "example-trading",
      factory_root: worktreeFactoryRoot,
      factory_config_path: join(worktreeFactoryRoot, "factory.config.json"),
      control_plane_repo: "recallnet/astrochicken",
      canonical_event_store_url: canonicalEventStore.connectionString,
    },
  });

  assert.equal(out.managed_state.state_action, "pause");
  assert.equal(out.managed_state.health_classification, "locally_unhealthy");
  assert.equal(out.managed_state.reason, "circuit_breaker_blocking_after_1_failures");
  assert.equal(realpathSync(out.managed_state.state_path), realpathSync(controlStatePath));
});
