import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createIncidentFingerprint } from "../../src/lib/incident-fingerprint.ts";
import { buildIncidentPacket, persistIncidentPacket, validateIncidentPacket } from "../../src/lib/incident-packet.ts";

test("createIncidentFingerprint is deterministic for semantically equivalent seeds", () => {
  const left = createIncidentFingerprint({
    kind_id: "example-notes",
    crash_type: "module_not_found",
    affected_node: "emit_bug",
    error_excerpt: "Cannot find module x",
    nested: {
      b: 2,
      a: 1,
    },
  });

  const right = createIncidentFingerprint({
    error_excerpt: "Cannot find module x",
    affected_node: "emit_bug",
    crash_type: "module_not_found",
    kind_id: "example-notes",
    nested: {
      a: 1,
      b: 2,
    },
  });

  assert.equal(left, right);
  assert.match(left, /^sha256:[a-f0-9]{64}$/);
});

test("buildIncidentPacket emits incident.v2 payload with deterministic fingerprint", () => {
  const packet = buildIncidentPacket({
    factory_id: "mothership/factory_supervisor",
    control_plane_repo: "recallnet/astrochicken",
    source_factory: "example-notes/factory_supervisor",
    source_repo: "example-org/example-notes",
    run_id: "run-44",
    pipeline: "factory_supervisor_tick",
    signature_hash: "sha256:abc123",
    instance_id: "fac_01",
    kind_id: "example-notes",
    host_id: "host_devrel_mac_01",
    classification: "platform",
    severity: "blocking",
    crash_type: "module_not_found",
    affected_node: "emit_bug",
    error_excerpt: "Cannot find module '@example-org/foo'",
    runtime_version: "v1.2.3",
    kind_version: "v2.0.1",
    evidence: {
      observed_behavior: "Supervisor crashed while loading shared runtime module.",
      expected_behavior: "Supervisor should emit bug without crashing.",
      remediation_attempts: "Retried with clean cache and reran supervisor tick.",
      mutation_context: {
        target_repo: "example-org/example-notes",
        control_plane_repo: "recallnet/astrochicken",
      },
    },
  });

  assert.equal(packet.schema_version, "incident_packet.v1");
  assert.equal(packet.packet_type, "incident_packet");
  assert.equal(packet.schema, "incident.v2");
  assert.equal(packet.classification, "platform");
  assert.equal(packet.severity, "blocking");
  assert.equal(packet.crash_type, "module_not_found");
  assert.equal(packet.affected_node, "emit_bug");
  assert.equal(packet.runtime_version, "v1.2.3");
  assert.equal(packet.kind_version, "v2.0.1");
  assert.equal(packet.instance_id, "fac_01");
  assert.equal(packet.kind_id, "example-notes");
  assert.equal(packet.host_id, "host_devrel_mac_01");
  assert.match(packet.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(packet.resource_refs.fingerprint, packet.fingerprint);

  const validation = validateIncidentPacket(packet);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test("validateIncidentPacket fails closed on missing incident.v2 required fields", () => {
  const packet = buildIncidentPacket({
    factory_id: "mothership",
    control_plane_repo: "recallnet/astrochicken",
    source_factory: "example-notes/factory_supervisor",
    source_repo: "example-org/example-notes",
    run_id: "run-44",
    pipeline: "factory_supervisor_tick",
    signature_hash: "sha256:abc123",
    evidence: {
      observed_behavior: "obs",
      expected_behavior: "exp",
      remediation_attempts: "retry",
    },
  });

  const invalid = {
    ...packet,
    classification: "",
    severity: "",
    crash_type: "",
    runtime_version: "",
    kind_version: "",
    error_excerpt: "",
  };

  const validation = validateIncidentPacket(invalid);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("missing_required_field:classification"), true);
  assert.equal(validation.errors.includes("missing_required_field:severity"), true);
  assert.equal(validation.errors.includes("missing_required_field:crash_type"), true);
  assert.equal(validation.errors.includes("missing_required_field:runtime_version"), true);
  assert.equal(validation.errors.includes("missing_required_field:kind_version"), true);
  assert.equal(validation.errors.includes("missing_required_field:error_excerpt"), true);
});

test("persistIncidentPacket writes packet into canonical packet storage", () => {
  const repo = mkdtempSync(join(tmpdir(), "incident-packet-"));
  const packet = buildIncidentPacket({
    factory_id: "mothership",
    source_factory: "mothership",
    source_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    run_id: "run-44",
    signature_hash: "sha256:abc123",
    classification: "ambiguous",
    severity: "informational",
    crash_type: "unknown",
    affected_node: "postmortem",
    error_excerpt: "review_notes_missing",
    runtime_version: "v0.8.1",
    kind_version: "v0.8.1",
    evidence: {
      observed_behavior: "Supervisor hit a durable packet routing regression",
      expected_behavior: "Incident packet persists under canonical storage",
      remediation_attempts: "Retried packet emit twice",
    },
  });

  const persisted = persistIncidentPacket({ repo, packet });
  const parsed = JSON.parse(readFileSync(persisted.packet_path, "utf8"));
  assert.equal(parsed.packet_type, "incident_packet");
  assert.equal(parsed.schema, "incident.v2");
  assert.match(parsed.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(parsed.packet_state, "open");
  assert.equal(parsed.handoff_kind, "control_plane_incident");
  assert.match(persisted.packet_path, /\.hatch\/mothership\/runs\/run-44\/packets\/incident_packet\//);
});
