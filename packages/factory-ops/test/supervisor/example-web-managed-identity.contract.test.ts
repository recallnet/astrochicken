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

test("example-web managed identity resolves kind -> instance -> context chain", () => {
  const out = loadManagedSupervisorContext({
    factoryId: "example-web",
    factoryRoot: "factories/example-web",
    kindPath: "factories/example-web/kind.json",
    instancePath: "factories/example-web/instance.template.json",
    kindId: "example-web",
    instanceId: "example-web",
    targetRepo: "example-org/example-web",
    targetRepo: "example-org/example-web",
    controlPlaneRepo: "recallnet/astrochicken",
    destinationsJson: JSON.stringify({
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "factory:example-web"],
      },
    }),
  });

  assert.equal(out.manifest_ok, "true", out.manifest_error || "manifest_error");
  assert.equal(out.kind_id, "example-web");
  assert.equal(out.instance_id, "example-web");
  assert.equal(out.target_repo, "example-org/example-web");
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");

  const instanceTemplate = readJson("factories/example-web/instance.template.json");
  assert.equal(instanceTemplate.workspace_mode, "checkout");
  assert.equal(instanceTemplate.target_repo?.full_name, "example-org/example-web");

  const kind = readJson("factories/example-web/kind.json");
  assert.equal(kind.default_workspace_mode, "checkout");

  const intake = JSON.parse(out.intake_json || "{}");
  assert.deepEqual(intake.issue_selector?.labels || [], ["goal", "ready"]);
});

test("example-web installation manifest includes checkout workspace mode and work_dir", () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "example-web-host-install-"));

  try {
    const paths = resolveHostPaths({
      factoryId: "example-web",
      instanceId: "example-web",
      baseDir: hostBaseDir,
      mutationContext: false,
    });

    const installed = hostInstall(paths, {
      factory_id: "example-web",
      instance_id: "example-web",
      workspace_mode: "checkout",
      work_dir: "/path/to/example-web",
    });

    assert.equal(installed.ok, true);
    const manifest = readJson(paths.installationManifestPath);
    assert.equal(manifest.instance_id, "example-web");
    assert.equal(manifest.workspace_mode, "checkout");
    assert.equal(manifest.work_dir, "/path/to/example-web");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("example-web managed identity artifacts align to home-repo + install manifest contract", () => {
  const config = readJson("factories/example-web/factory.config.json");
  const instance = readJson("factories/example-web/instance.template.json");

  assert.equal(config.kind_id, "example-web");
  assert.equal(config.instance_id, "example-web");
  assert.equal(config.target_repo, "example-org/example-web");
  assert.equal(config.installation_manifest_path, ".hatch/hosts/example-web/installation.json");

  assert.equal(instance.kind_id, "example-web");
  assert.equal(instance.instance_id, "example-web");
  assert.equal(instance.target_repo?.full_name, "example-org/example-web");
});
