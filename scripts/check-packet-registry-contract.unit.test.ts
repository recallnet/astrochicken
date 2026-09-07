import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validatePacketEnvelopeBoundaries,
  validatePacketRegistryJsonShape,
  validatePacketRegistryShape,
  validatePacketRegistrySnapshot,
} from "./check-packet-registry-contract.ts";

test("packet registry contract validates registry shape", () => {
  const out = validatePacketRegistryShape();
  assert.equal(out.ok, true, out.diagnostics.join("\n"));
});

test("packet registry contract requires takeover metadata for durable supervisor/control-plane families", () => {
  const out = validatePacketRegistryShape();
  assert.equal(out.diagnostics.some((entry) => entry.startsWith("missing_takeover_contract:")), false, out.diagnostics.join("\n"));
});

test("packet registry contract requires ephemeral justification for non-durable packet types", () => {
  const packetTypeKey = ["packet", "_type"].join("");
  const schemaVersionKey = ["schema", "_version"].join("");
  const out = validatePacketRegistryShape({
    entries: [
      {
        [packetTypeKey]: "example_ephemeral",
        family: "remediation_packet",
        [schemaVersionKey]: "remediation_packet/v1",
        durable: false,
        storage_class: "state_snapshot",
        consumer: "supervisor.state_snapshot",
        validator: "validateRemediationPacket",
      },
    ],
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.diagnostics, ["missing_ephemeral_justification:example_ephemeral"]);
});

test("packet registry contract validates checked-in snapshot", () => {
  const out = validatePacketRegistrySnapshot();
  assert.equal(out.ok, true, out.error);
});

test("packet registry contract snapshot validation can target an alternate snapshot path", () => {
  const dir = mkdtempSync(join(tmpdir(), "packet-registry-contract-"));
  const snapshotPath = join(dir, "packet-registry.json");
  const schemaVersionKey = ["schema", "_version"].join("");
  const packetTypesKey = ["packet", "_types"].join("");
  writeFileSync(snapshotPath, JSON.stringify({ [schemaVersionKey]: "packet_registry/v1", [packetTypesKey]: [] }, null, 2));
  const out = validatePacketRegistrySnapshot({ snapshotPath });
  assert.equal(out.ok, false);
  assert.match(String(out.error || ""), /snapshot_drift/);
});

test("packet registry contract validates registry JSON and fails on missing ephemeral justification", () => {
  const dir = mkdtempSync(join(tmpdir(), "packet-registry-shape-"));
  const registryPath = join(dir, "packet-registry.json");
  const packetTypeKey = ["packet", "_type"].join("");
  const schemaVersionKey = ["schema", "_version"].join("");
  const packetTypesKey = ["packet", "_types"].join("");
  writeFileSync(registryPath, JSON.stringify({
    [schemaVersionKey]: "packet_registry/v1",
    [packetTypesKey]: [
      {
        [packetTypeKey]: "ephemeral_without_justification",
        family: "remediation_packet",
        [schemaVersionKey]: "remediation_packet/v1",
        durable: false,
        storage_class: "state_snapshot",
        consumer: "supervisor.state_snapshot",
        validator: "validateRemediationPacket",
        takeover_contract: "",
      },
    ],
  }, null, 2));
  const out = validatePacketRegistryJsonShape({ registryPath });
  assert.equal(out.ok, false);
  assert.deepEqual(out.diagnostics, ["missing_ephemeral_justification:ephemeral_without_justification"]);

  const cli = spawnSync("node", ["scripts/check-packet-registry-contract.ts", "--registry-path", registryPath], {
    encoding: "utf8",
  });
  assert.notEqual(cli.status, 0);
  assert.match(String(cli.stderr || ""), /missing_ephemeral_justification:ephemeral_without_justification/);
});

test("packet registry contract rejects packet envelope construction outside allowlist", () => {
  const dir = mkdtempSync(join(tmpdir(), "packet-registry-boundary-"));
  const filePath = join(dir, "fixture.mjs");
  writeFileSync(filePath, "export {};\n");
  const out = validatePacketEnvelopeBoundaries({
    paths: [filePath],
    readFile: () => `const packet = ${["buildNamedPacket", "Envelope"].join("")}({ schemaVersion: 'x', packetType: 'y' });`,
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.diagnostics, [`packet_envelope_boundary_violation:${filePath}`]);
});

test("packet registry contract skips missing tracked source files during staged renames", () => {
  const dir = mkdtempSync(join(tmpdir(), "packet-registry-boundary-missing-"));
  const missingPath = join(dir, "deleted-script.mjs");
  writeFileSync(missingPath, "export {};\n");
  rmSync(missingPath);

  const out = validatePacketEnvelopeBoundaries({
    paths: [missingPath],
  });

  assert.equal(out.ok, true, out.diagnostics.join("\n"));
  assert.deepEqual(out.diagnostics, []);
});
