import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import managedDomainWorkflowSource from "../../../factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.data.json" with { type: "json" };

import { validateManagedDomainContract } from "../../src/commands/supervisor-managed-domain-contract.ts";

const repoRoot = resolve(".");

function writeDotFixture(name, content) {
  const root = mkdtempSync(join(tmpdir(), "managed-domain-contract-"));
  const path = join(root, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

test("managed domain contract accepts a shell-compliant domain graph", () => {
  const dotPath = writeDotFixture("domain_ok.dot", `digraph domain_ok {
  start [shape=Mdiamond]
  done [shape=Msquare]

  set_context [type="tool" output_key="local_value" prompt="printf '%s' '\${instance_id}'"]
  run_work [type="pipeline" pipeline="@hatch/capability/example.dot" inherit_context="true" export_keys="goal_issue_url"]
  emit [type="tool" output_key="domain_result" prompt="printf '{\"instance_id\":\"%s\",\"issue\":\"%s\"}' '\${instance_id}' '\${selected_issue_number}'"]

  start -> set_context -> run_work -> emit -> done
}`);

  const out = validateManagedDomainContract({ dotPath });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.code, "ok");
  assert.equal(out.required_output_present, "true");
  assert.ok(out.produced_keys.includes("domain_result"));
  assert.ok(out.referenced_keys.includes("instance_id"));
  assert.deepEqual(out.violations, []);
});

test("managed domain contract rejects forbidden side effects and unknown keys", () => {
  const dotPath = writeDotFixture("domain_bad.dot", `digraph domain_bad {
  start [shape=Mdiamond]
  done [shape=Msquare]

  classify [type="tool" output_key="lifecycle_state" prompt="hatch-ops supervisor managed-health-classifier --has-selected-work 'true'"]
  persist [type="tool" prompt="hatch-ops supervisor managed-persist-state --factory-id '\${factory_id}' --lifecycle-state 'active'"]
  summary [type="tool" prompt="hatch-ops supervisor managed-emit-run-summary --factory-id '\${factory_id}'"]
  escalate [type="tool" prompt="hatch-ops supervisor emit-bug --repo '\${control_plane_repo}' --summary 'bad'"]
  emit [type="tool" output_key="domain_result" prompt="printf '{\"x\":\"%s\"}' '\${non_shell_key}'"]

  start -> classify -> persist -> summary -> escalate -> emit -> done
}`);

  const out = validateManagedDomainContract({ dotPath });
  assert.equal(out.ok, false);
  assert.equal(out.code, "managed_domain_contract_violation");

  const violationCodes = out.violations.map((entry) => entry.code);
  assert.ok(violationCodes.includes("forbidden_output_key"), JSON.stringify(out));
  assert.ok(violationCodes.includes("forbidden_lifecycle_classification"), JSON.stringify(out));
  assert.ok(violationCodes.includes("forbidden_control_state_write"), JSON.stringify(out));
  assert.ok(violationCodes.includes("forbidden_shell_telemetry"), JSON.stringify(out));
  assert.ok(violationCodes.includes("forbidden_emit_bug"), JSON.stringify(out));
  assert.ok(violationCodes.includes("unknown_context_key"), JSON.stringify(out));
});

test("managed domain contract fails closed when domain_result is missing", () => {
  const dotPath = writeDotFixture("domain_missing_output.dot", `digraph domain_missing_output {
  start [shape=Mdiamond]
  done [shape=Msquare]

  run [type="tool" output_key="local" prompt="printf '{}'"
  start -> run -> done
}`);

  const out = validateManagedDomainContract({ dotPath });
  assert.equal(out.ok, false);
  assert.equal(out.required_output_present, "false");
  assert.ok(out.violations.some((entry) => entry.code === "missing_domain_result_output"));
});

test("managed domain contract accepts brainstorm domain graph", () => {
  const dotPath = join(repoRoot, "factories/brainstorm/workflows/dispatch-control/domain_brainstorm.workflow-source.mjs");
  const out = validateManagedDomainContract({ dotPath });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.required_output_present, "true");
  assert.ok(out.produced_keys.includes("domain_result"));
});

test("managed domain contract accepts shared managed software delivery domain graph", () => {
  const dotPath = join(repoRoot, "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs");
  const out = validateManagedDomainContract({ dotPath });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.required_output_present, "true");
  assert.ok(out.produced_keys.includes("domain_result"));
});

test("managed delivery domain open bug fast route is scoped to factory-managed incidents", () => {
  const openBugNodes = managedDomainWorkflowSource.nodes.filter(
    (node) => node?.dotAttributes?.action_id === "supervisor.open_bug_gate",
  );

  assert.equal(openBugNodes.length, 2);
  for (const node of openBugNodes) {
    assert.equal(
      node.dotAttributes?.action_label_filters,
      "[\"managed-factory-bug\",\"factory:${factory_id}\"]",
      `node ${node.id} must scope open-bug fast routing to factory-managed incidents`,
    );
  }
});
