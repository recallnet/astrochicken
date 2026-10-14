import { buildControlPlaneManifestFixture } from "./control-plane-status.fixture.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";

import { factoryStatus } from "../../src/commands/factory-status.ts";
import { syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

import { appendCanonicalEvents } from "../../src/lib/canonical-event-log.ts";
import { buildControlActionAppliedEvent } from "../../src/lib/canonical-domain-events.ts";

const canonicalEventStore = createCanonicalEventStoreFixture();

before(async () => {
  await canonicalEventStore.setup();
});

after(() => {
  canonicalEventStore.teardown();
});

// @context:regression Canonical control decisions must be seeded alongside their existing disk mirror fixtures.
async function recordControlStateFixture(statePath) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const action = Object.entries(state.action_state).find(([, value]) => value.active)?.[0] || "none";
  await appendCanonicalEvents({
    connectionString: canonicalEventStore.connectionString,
    events: [buildControlActionAppliedEvent({
      factoryId: state.factory_id,
      action,
      stateAction: action,
      reason: state.reason,
      actor: state.updated_by,
      retryTarget: state.retry_target,
      stateVersion: state.version,
      statePath,
    })],
  });
}


function controlStateFixture({ paused, updatedBy, reason, retryTarget }) {
  return {
      schema: "external-factory-control-state/v1",
      factory_id: "example-trading",
      version: 3,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
      reason,
      action_state: {
        pause: { active: paused },
        quarantine: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: false },
      },
      retry_target: retryTarget,
      notes: [],
    };
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

test("factoryStatus prefers control-plane control-state from factory context repo over host-scoped runs dir", async () => {
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
    state: controlStateFixture({
      paused: true,
      updatedBy: "daemon",
      reason: "circuit_breaker_blocking_after_1_failures",
      retryTarget: "run-77",
    }),
  });

  writeExternalControlState({
    rootDir: hostRoot,
    factoryId: "example-trading",
    state: controlStateFixture({
      paused: false,
      updatedBy: "managed_supervisor",
      reason: "",
      retryTarget: "",
    }),
  });

  await recordControlStateFixture(controlStatePath);
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

test("factoryStatus prefers canonical control-plane control-state when factory_root is a git worktree path", async () => {
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
    state: controlStateFixture({
      paused: true,
      updatedBy: "daemon",
      reason: "circuit_breaker_blocking_after_1_failures",
      retryTarget: "run-77",
    }),
  });

  writeExternalControlState({
    rootDir: targetRepoRoot,
    factoryId: "example-trading",
    state: controlStateFixture({
      paused: false,
      updatedBy: "managed_supervisor",
      reason: "",
      retryTarget: "",
    }),
  });

  await recordControlStateFixture(controlStatePath);
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
