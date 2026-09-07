import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadManagedSupervisorContext } from "../../src/commands/supervisor-managed-load-context.ts";
import { resolveHostPaths, hostInstall } from "../../src/commands/factory-host-lifecycle.ts";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("brainstorm managed identity resolves kind -> instance -> context chain", () => {
  const out = loadManagedSupervisorContext({
    factoryId: "brainstorm",
    factoryRoot: "factories/brainstorm",
    kindPath: "factories/brainstorm/kind.json",
    instancePath: "factories/brainstorm/instance.template.json",
    kindId: "brainstorm",
    instanceId: "brainstorm",
    targetRepo: "example-org/example-notes",
    targetRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    destinationsJson: JSON.stringify({
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "kind:brainstorm"],
      },
    }),
  });

  assert.equal(out.manifest_ok, "true", out.manifest_error || "manifest_error");
  assert.equal(out.kind_id, "brainstorm");
  assert.equal(out.instance_id, "brainstorm");
  assert.equal(out.target_repo, "example-org/example-notes");
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");

  const destinations = JSON.parse(out.destinations_json || "{}");
  assert.equal(destinations.goal_issues?.repo, "recallnet/astrochicken", "managed context missing destinations.goal_issues.repo");
  assert.deepEqual(destinations.goal_issues?.labels, ["goal", "source:brainstorm"], "managed context destinations.goal_issues.labels must match contract");
  assert.equal(destinations.platform_incidents?.repo, "recallnet/astrochicken", "managed context missing destinations.platform_incidents.repo");
  assert.deepEqual(destinations.platform_incidents?.labels, ["managed-factory-bug", "kind:brainstorm"], "managed context destinations.platform_incidents.labels must match contract");

  const kindContext = JSON.parse(out.kind_context_json || "{}");
  assert.equal(kindContext.schema_version, 1);
  assert.equal(kindContext.execution_mode, "issues_only");
  assert.deepEqual(
    kindContext.supported_destinations,
    ["goal_issues", "platform_incidents"],
    "kind context supported_destinations must include goal_issues and platform_incidents",
  );

  const instanceTemplate = readJson("factories/brainstorm/instance.template.json");
  assert.equal(instanceTemplate.workspace_mode, "api_only", "instance.template.json must pin workspace_mode to api_only");
  assert.equal(instanceTemplate.target_repo?.full_name, "example-org/example-notes", "instance.template.json must pin target_repo to example-org/example-notes");
  assert.equal(typeof instanceTemplate.instance_id, "string", "instance.template.json must declare instance_id");
  assert.notEqual(instanceTemplate.instance_id.trim(), "", "instance.template.json instance_id must be non-empty");

  const intake = JSON.parse(out.intake_json || "{}");
  assert.deepEqual(intake.issue_selector?.labels || [], ["brainstorm"]);
});

test("brainstorm installation manifest includes api_only workspace mode", () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "brainstorm-host-install-"));

  try {
    const paths = resolveHostPaths({
      factoryId: "brainstorm",
      instanceId: "brainstorm",
      baseDir: hostBaseDir,
    });

    const installed = hostInstall(paths, {
      factory_id: "brainstorm",
      instance_id: "brainstorm",
    });

    assert.equal(installed.ok, true);
    const manifest = readJson(paths.installationManifestPath);
    assert.equal(manifest.instance_id, "brainstorm");
    assert.equal(manifest.workspace_mode, "api_only");
    assert.equal(manifest.work_dir, null);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory-registry brainstorm identity aligns to managed example-notes home repo", () => {
  const registry = readJson("factory-registry.json");
  const instance = (registry.instances || []).find((entry) => entry.instance_id === "brainstorm");

  assert.ok(instance, "registry.instances must include brainstorm");
  assert.equal(instance.kind_id, "brainstorm");
  assert.equal(instance.target_repo, "example-org/example-notes");
  assert.equal(instance.status, "active");
  assert.equal(instance.assigned_host_id, "unassigned");
  assert.equal(instance.installation_manifest_path, ".hatch/hosts/brainstorm/installation.json");
});
