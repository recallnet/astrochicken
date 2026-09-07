import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  reconcileManagedFactoryRunsDir,
  resolveFleetRegistryPath,
  resolveFactoryRunsDir,
  resolveRepoScopedFactoryContext,
} from "../../src/cli/factory-command-helpers.ts";

test("resolveFleetRegistryPath prefers host runtime registry for default fleet commands", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "fleet-registry-"));
  const hostBaseDir = join(tempRoot, ".hatch-hosts");
  const runtimeDir = join(hostBaseDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const runtimeRegistryPath = join(runtimeDir, "factory-registry.json");
  writeFileSync(runtimeRegistryPath, JSON.stringify({ schema: "hatch.factory.registry.v1", instances: [] }));

  const previous = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;
  try {
    assert.equal(resolveFleetRegistryPath("factory-registry.json"), runtimeRegistryPath);
  } finally {
    if (previous === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = previous;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveFleetRegistryPath preserves explicit registry path", () => {
  assert.equal(resolveFleetRegistryPath("/tmp/custom-registry.json"), "/tmp/custom-registry.json");
});

test("resolveFleetRegistryPath falls back to repo default when host runtime registry is absent", () => {
  const previous = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = join(tmpdir(), "missing-host-registry");
  try {
    assert.equal(resolveFleetRegistryPath("factory-registry.json"), "factory-registry.json");
  } finally {
    if (previous === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = previous;
  }
});

test("reconcileManagedFactoryRunsDir preserves managed checkout runs dir even when host runs dir exists", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "managed-runs-dir-"));
  const hostBaseDir = join(tempRoot, ".hatch-hosts");
  const hostRunsDir = join(hostBaseDir, "example-trading", "runs");
  mkdirSync(hostRunsDir, { recursive: true });
  const checkoutRunsDir = "/tmp/live-example-trading-checkout/.hatch/example-trading/runs";

  const resolved = reconcileManagedFactoryRunsDir({
    factory_id: "example-trading",
    instance_id: "example-trading",
    factory_mode: "managed",
    runs_dir: checkoutRunsDir,
  }, {
    hostBaseDir,
  });

  assert.equal(resolved.runs_dir, checkoutRunsDir);
  rmSync(tempRoot, { recursive: true, force: true });
});

test("reconcileManagedFactoryRunsDir preserves non-managed runs dir resolution", () => {
  const resolved = reconcileManagedFactoryRunsDir({
    factory_id: "mothership",
    instance_id: "mothership",
    factory_mode: "standalone",
    runs_dir: "/tmp/mothership-runs",
  }, {
    hostBaseDir: "/tmp/unused-host-base",
  });

  assert.equal(resolved.runs_dir, "/tmp/mothership-runs");
});

test("resolveFactoryRunsDir prefers resolved managed checkout runs dir over host runs dir", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "managed-resolve-runs-dir-"));
  const hostBaseDir = join(tempRoot, ".hatch-hosts");
  const hostRunsDir = join(hostBaseDir, "example-trading", "runs");
  mkdirSync(hostRunsDir, { recursive: true });
  const checkoutRunsDir = join(tempRoot, "target-repo", ".hatch", "example-trading", "runs");

  const previous = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = hostBaseDir;
  try {
    const resolved = await resolveFactoryRunsDir("", "example-trading", {
      resolveFactoryContextFn: () => ({
        factory_id: "example-trading",
        factory_mode: "managed",
        runs_dir: checkoutRunsDir,
      }),
    });
    assert.equal(resolved, checkoutRunsDir);
  } finally {
    if (previous === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = previous;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveRepoScopedFactoryContext infers factory identity from registry target repo", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "repo-scoped-factory-context-"));
  try {
    writeFileSync(join(tempRoot, "factory-registry.json"), JSON.stringify({
      schema: "hatch.factory.registry.v1",
      instances: [
        {
          instance_id: "mothership",
          kind_id: "mothership",
          target_repo: "recallnet/astrochicken",
        },
        {
          instance_id: "example-trading",
          kind_id: "example-trading",
          target_repo: "example-org/example-trading",
        },
      ],
    }));

    const resolved = resolveRepoScopedFactoryContext({
      repo: "example-org/example-trading",
      cwd: tempRoot,
    });

    assert.equal(resolved.repoRoot, tempRoot);
    assert.equal(resolved.factoryId, "example-trading");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveRepoScopedFactoryContext preserves explicit factory identity", () => {
  const resolved = resolveRepoScopedFactoryContext({
    repo: "example-org/example-trading",
    repoRoot: "/tmp/control-plane",
    factoryId: "explicit-factory",
    cwd: "/tmp/ignored-cwd",
  });

  assert.equal(resolved.repoRoot, "/tmp/control-plane");
  assert.equal(resolved.factoryId, "explicit-factory");
});

test("resolveRepoScopedFactoryContext resolves targetRepo from registry when factoryId is explicit", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "repo-scoped-target-repo-"));
  try {
    writeFileSync(join(tempRoot, "factory-registry.json"), JSON.stringify({
      schema: "hatch.factory.registry.v1",
      instances: [
        {
          instance_id: "mothership",
          kind_id: "mothership",
          target_repo: "recallnet/astrochicken",
        },
        {
          instance_id: "example-trading",
          kind_id: "example-trading",
          target_repo: "example-org/example-trading",
        },
      ],
    }));

    const resolved = resolveRepoScopedFactoryContext({
      factoryId: "example-trading",
      cwd: tempRoot,
    });

    assert.equal(resolved.factoryId, "example-trading");
    assert.equal(resolved.targetRepo, "example-org/example-trading");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
