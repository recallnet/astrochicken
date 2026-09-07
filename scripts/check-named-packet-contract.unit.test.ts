import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = join(repoRoot, "scripts", "check-named-packet-contract.mjs");

function runCheck(source) {
  const dir = mkdtempSync(join(tmpdir(), "named-packet-contract-"));
  const filePath = join(dir, "fixture.mjs");
  writeFileSync(filePath, source, "utf8");
  return spawnSync("node", [scriptPath, "--file", filePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("named packet contract accepts registered packet families with packet_type", () => {
  const run = runCheck(`
    const packet = {
      schema_version: "incident_packet.v1",
      packet_type: "incident_packet",
      packet_id: "incident_packet_123",
    };
    void packet;
  `);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[named-packet-contract\] result=ok/);
});

test("named packet contract rejects inline remediation packet literals", () => {
  const fieldName = "remediation" + "_packet";
  const run = runCheck(`
    const item = {
      ${fieldName}: {
        schema_version: "remediation_packet/v1",
        packet_type: "stalled_wave_recovery",
        packet_id: "stalled_wave_recovery_123",
      },
    };
    void item;
  `);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /inline_remediation_packet_literal/);
});

test("named packet contract rejects packet schemas without packet_type", () => {
  const run = runCheck(`
    const packet = {
      schema_version: "human_blocker.v1",
      signature_hash: "sha256:test",
    };
    void packet;
  `);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /packet_schema_missing_packet_type/);
});

test("named packet contract skips missing staged paths without failing", () => {
  const dir = mkdtempSync(join(tmpdir(), "named-packet-contract-missing-"));
  const filePath = join(dir, "deleted-fixture.mjs");
  writeFileSync(filePath, "const packet = {};\n", "utf8");
  rmSync(filePath);

  const run = spawnSync("node", [scriptPath, "--file", filePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[named-packet-contract\] result=ok/);
});
