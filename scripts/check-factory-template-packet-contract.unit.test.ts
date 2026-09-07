import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzeFactoryTemplatePacketContract,
} from "./check-factory-template-packet-contract.ts";

function writeFixture(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

test("factory template packet contract accepts packetized recovery scaffolds", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-template-packet-contract-"));
  const diagnostics = analyzeFactoryTemplatePacketContract([
    {
      path: writeFixture(dir, "factory_supervisor_tick.dot.template", `
        digraph t {
          recovery_wait [type="wait.human" recovery_owner="supervisor" recovery_sink_type="wait" label="Supervisor packet recovery"]
          // named packet
          // packet_path, packet_id, packet_type, and schema_version
          // FREEFORM-VS-PACKET BOUNDARY
        }
      `),
      checks: [/named packet/i, /packet_path, packet_id, packet_type, and schema_version/i, /recovery_owner="supervisor"/, /recovery_sink_type="wait"/],
    },
    {
      path: writeFixture(dir, "subgraph-production-line.dot", `
        digraph t {
          recovery_wait [type="wait.human" recovery_owner="supervisor" recovery_sink_type="wait" label="Supervisor packet recovery"]
          build_review_recovery_packet [label="x"]
          build_judge_context_recovery_packet [label="x"]
          build_judge_failure_packet [label="x"]
          build_merge_recovery_packet [label="x"]
        }
      `),
      checks: [/build_review_recovery_packet/, /build_judge_context_recovery_packet/, /build_judge_failure_packet/, /build_merge_recovery_packet/, /recovery_wait \[type="wait\.human" recovery_owner="supervisor" recovery_sink_type="wait"/],
      rejects: [/report_review_failed -> done/, /report_judge_context_failed -> done/, /report_judge_failed -> done/],
    },
    {
      path: writeFixture(dir, "role-definitions.md", `
        named packet family
        freeform agent-to-agent messaging remains allowed
        emit a named durable recovery packet before cleanup
        packet recovery sink
        goal_decomposition_packet
        durable decomposition ledger
        Allowed Freeform
        Must Packetize
      `),
      checks: [/named packet family/i, /freeform agent-to-agent messaging remains allowed/i, /emit a named durable recovery packet before cleanup/i, /packet recovery sink/i, /goal_decomposition_packet/i, /durable decomposition ledger/i],
    },
    {
      path: writeFixture(dir, "SKILL.md", `
        .hatch/<factory_id>/runs/<run_id>/packets/merge_conflict_packet/<packet_id>.json
        Treat the packet as the recovery map.
      `),
      checks: [/\.hatch\/<factory_id>\/runs\/<run_id>\/packets\/merge_conflict_packet\/<packet_id>\.json/, /Treat the packet as the recovery map/i],
    },
  ]);
  assert.deepEqual(diagnostics, []);
});

test("factory template packet contract rejects packetless failure scaffolds", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-template-packet-contract-"));
  const diagnostics = analyzeFactoryTemplatePacketContract([
    {
      path: writeFixture(dir, "subgraph-production-line.dot", `
        digraph t {
          report_review_failed -> done
        }
      `),
      checks: [/build_review_recovery_packet/],
      rejects: [/report_review_failed -> done/],
    },
  ]);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.some((entry) => String(entry.pattern).includes("build_review_recovery_packet")));
  assert.ok(diagnostics.some((entry) => String(entry.pattern).includes("reject")));
});
