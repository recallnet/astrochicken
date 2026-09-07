import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadManagedSupervisorContext } from "../../src/commands/supervisor-managed-load-context.ts";
import { hostInstall, resolveHostPaths } from "../../src/commands/factory-host-lifecycle.ts";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("example-trading managed identity resolves kind -> instance -> context chain", () => {
  const out = loadManagedSupervisorContext({
    factoryId: "example-trading",
    factoryRoot: "factories/example-trading",
    kindPath: "factories/example-trading/kind.json",
    instancePath: "factories/example-trading/instance.template.json",
    kindId: "example-trading",
    instanceId: "example-trading",
    targetRepo: "example-org/example-trading",
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    destinationsJson: JSON.stringify({
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "factory:example-trading"],
      },
    }),
  });

  assert.equal(out.manifest_ok, "true", out.manifest_error || "manifest_error");
  assert.equal(out.kind_id, "example-trading");
  assert.equal(out.instance_id, "example-trading");
  assert.equal(out.target_repo, "example-org/example-trading");
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");

  const instanceTemplate = readJson("factories/example-trading/instance.template.json");
  assert.equal(instanceTemplate.workspace_mode, "checkout");
  assert.equal(instanceTemplate.target_repo?.full_name, "example-org/example-trading");

  const kind = readJson("factories/example-trading/kind.json");
  assert.equal(kind.default_workspace_mode, "checkout");

  const intake = JSON.parse(out.intake_json || "{}");
  assert.deepEqual(intake.issue_selector?.labels || [], ["goal", "ready"]);
});

test("example-trading installation manifest includes checkout workspace mode and work_dir", () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "example-trading-host-install-"));

  try {
    // Pass mutationContext: false to prevent ambient HATCH_FACTORY_MUTATION_CONTEXT_JSON
    // (set in live factory environments) from rejecting the isolated test temp-dir paths.
    // (null would trigger nullish coalescing and still load the live context.)
    const paths = resolveHostPaths({
      factoryId: "example-trading",
      instanceId: "example-trading",
      baseDir: hostBaseDir,
      mutationContext: false,
    });

    const installed = hostInstall(paths, {
      factory_id: "example-trading",
      instance_id: "example-trading",
      workspace_mode: "checkout",
      work_dir: "/path/to/example-trading",
    });

    assert.equal(installed.ok, true);
    const manifest = readJson(paths.installationManifestPath);
    assert.equal(manifest.instance_id, "example-trading");
    assert.equal(manifest.workspace_mode, "checkout");
    assert.equal(manifest.work_dir, "/path/to/example-trading");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory-registry example-trading identity aligns to managed replay home repo", () => {
  const registry = readJson("factory-registry.json");
  const instance = (registry.instances || []).find((entry) => entry.instance_id === "example-trading");

  assert.ok(instance, "registry.instances must include example-trading");
  assert.equal(instance.kind_id, "example-trading");
  assert.equal(instance.target_repo, "example-org/example-trading");
  assert.equal(instance.status, "active");
  assert.equal(instance.assigned_host_id, "unassigned");
  assert.equal(instance.installation_manifest_path, ".hatch/hosts/example-trading/installation.json");
});
