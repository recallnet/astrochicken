#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { emitResult, main } from "./lib/check-harness.ts";
import {
  buildPacketRegistrySnapshot,
  PACKET_REGISTRY,
} from "../packages/factory-ops/src/lib/packet-core.ts";

export const PACKET_REGISTRY_SNAPSHOT_PATH = "docs/contracts/packet-registry.json";

export const PACKET_ENVELOPE_ALLOWLIST = Object.freeze([
  "packages/factory-ops/src/commands/human-blocker.ts",
  "packages/factory-ops/src/lib/command-owners/goal-hard-planning.ts",
  "packages/factory-ops/src/lib/command-owners/judge-context-contract.ts",
  "packages/factory-ops/src/lib/command-owners/judge-evidence-contract.ts",
  "packages/factory-ops/src/lib/command-owners/reviewer-context-contract.ts",
  "packages/factory-ops/src/lib/goal-decomposition-packet.ts",
  "packages/factory-ops/src/lib/goal-execution-path-packet.ts",
  "packages/factory-ops/src/lib/goal-hard-plan-packet.ts",
  "packages/factory-ops/src/lib/goal-hard-plan-materialization-packet.ts",
  "packages/factory-ops/src/lib/incident-packet.ts",
  "packages/factory-ops/src/lib/merge-conflict-packet.ts",
  "packages/factory-ops/src/lib/remediation-packet.ts",
]);
const PACKET_ENVELOPE_NEEDLE = ["buildNamedPacket", "Envelope("].join("");

function requiresTakeoverContract(entry = {}) {
  return entry?.durable === true
    && ["supervisor", "control_plane", "goal."].some((prefix) => String(entry.consumer || "").startsWith(prefix));
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  return "Usage: node scripts/check-packet-registry-contract.ts [--snapshot-path <path>] [--registry-path <path>]";
}

export function validatePacketRegistryShape({ entries = PACKET_REGISTRY } = {}) {
  const diagnostics = [];
  const packetTypes = new Set();
  const schemaVersions = new Set();
  for (const entry of entries) {
    if (packetTypes.has(entry.packet_type)) {
      diagnostics.push(`duplicate_packet_type:${entry.packet_type}`);
    }
    packetTypes.add(entry.packet_type);
    const schemaKey = `${entry.packet_type}:${entry.schema_version}`;
    if (schemaVersions.has(schemaKey)) {
      diagnostics.push(`duplicate_schema_registration:${schemaKey}`);
    }
    schemaVersions.add(schemaKey);
    if (!String(entry.family || "").trim()) diagnostics.push(`missing_family:${entry.packet_type}`);
    if (!String(entry.validator || "").trim()) diagnostics.push(`missing_validator:${entry.packet_type}`);
    if (!String(entry.consumer || "").trim()) diagnostics.push(`missing_consumer:${entry.packet_type}`);
    if (requiresTakeoverContract(entry) && !String(entry.takeover_contract || "").trim()) {
      diagnostics.push(`missing_takeover_contract:${entry.packet_type}`);
    }
    if (entry?.durable === false && !String(entry?.ephemeral_justification || "").trim()) {
      diagnostics.push(`missing_ephemeral_justification:${entry.packet_type}`);
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

export function validatePacketRegistrySnapshot({ snapshotPath = PACKET_REGISTRY_SNAPSHOT_PATH } = {}) {
  if (!existsSync(snapshotPath)) {
    return { ok: false, error: `missing_snapshot:${snapshotPath}` };
  }
  const actual = readJsonFile(snapshotPath);
  const expected = buildPacketRegistrySnapshot();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return { ok: false, error: `snapshot_drift:${snapshotPath}` };
  }
  return { ok: true, error: "" };
}

export function validatePacketRegistryJsonShape({ registryPath = "" } = {}) {
  const path = String(registryPath || "").trim();
  if (!path) {
    return validatePacketRegistryShape();
  }
  if (!existsSync(path)) {
    return { ok: false, diagnostics: [`missing_registry:${path}`] };
  }
  const parsed = readJsonFile(path);
  const entries = Array.isArray(parsed?.packet_types) ? parsed.packet_types : [];
  return validatePacketRegistryShape({ entries });
}

function collectTrackedSourceFiles() {
  const raw = execFileSync("git", ["ls-files", "-z", "packages/factory-ops/src", "scripts"], { encoding: "buffer" });
  return raw.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => /\.(mjs|js|ts)$/.test(path))
    .filter((path) => existsSync(path));
}

export function validatePacketEnvelopeBoundaries({
  paths = collectTrackedSourceFiles(),
  readFile = (path) => readFileSync(path, "utf8"),
} = {}) {
  const diagnostics = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const source = String(readFile(path) || "");
    if (!source.includes(PACKET_ENVELOPE_NEEDLE)) continue;
    if (path.endsWith("/packet-core.mjs") || path.endsWith("/packet-core.ts")) continue;
    if (!PACKET_ENVELOPE_ALLOWLIST.includes(path)) {
      diagnostics.push(`packet_envelope_boundary_violation:${path}`);
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

function checkPacketRegistryContract(args = {}) {
  const shape = args.registryPath
    ? validatePacketRegistryJsonShape({ registryPath: args.registryPath })
    : validatePacketRegistryShape();
  if (!shape.ok) {
    return { ok: false, diagnostics: shape.diagnostics };
  }

  const registryJsonShape = validatePacketRegistryJsonShape({
    registryPath: args.registryPath || args.snapshotPath,
  });
  if (!registryJsonShape.ok) {
    return { ok: false, diagnostics: registryJsonShape.diagnostics };
  }

  const snapshot = validatePacketRegistrySnapshot({ snapshotPath: args.snapshotPath });
  if (!snapshot.ok) {
    return { ok: false, diagnostics: [snapshot.error] };
  }

  const boundaries = validatePacketEnvelopeBoundaries();
  if (!boundaries.ok) {
    return { ok: false, diagnostics: boundaries.diagnostics };
  }

  return { ok: true, diagnostics: [] };
}

const isEntryPoint = process.argv[1]
  ? new URL(`file://${process.argv[1]}`).href === import.meta.url
  : false;

if (isEntryPoint) {
  main(checkPacketRegistryContract, {
    gate: "packet-registry-contract",
    usage,
    argSchema: [
      { flag: "--snapshot-path", type: "string" },
      { flag: "--registry-path", type: "string" },
    ],
    emit: ({ ok, gate, diagnostics = [] }) => {
      diagnostics.forEach((diagnostic) => console.error(diagnostic));
      emitResult({ ok, gate, diagnostics });
    },
  });
}
