#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lib/check-harness.ts";
import {
  PACKET_REGISTRY,
  findPacketRegistryEntry,
} from "../packages/factory-ops/src/lib/packet-core.ts";

const PACKET_SCHEMA_RE = /schema_version\s*:\s*"([^"]+)"/g;
const PACKET_TYPE_RE = /packet_type\s*:\s*"([^"]+)"/g;
const INLINE_REMEDIATION_PACKET_RE = /remediation_packet\s*:\s*\{/g;
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REGISTERED_SCHEMA_VERSIONS = new Set(PACKET_REGISTRY.map((entry) => entry.schema_version));
const PACKETISH_SCHEMA_RE = /(?:^|[_./-])(incident_packet|human_blocker|remediation_packet|reviewer_context|judge_context|judge_evidence|[a-z0-9_]*packet)(?:[./_-]v?\d+)?$/i;

function usage() {
  return "Usage: node scripts/check-named-packet-contract.ts [--file <path> ...]";
}

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
  });
  return String(output)
    .split("\0")
    .filter(Boolean)
    .filter((file) => /^packages\/factory-ops\/src\/|^apps\/hatch\/src\/|^factories\/.+\/graphs\/|^scripts\//.test(file))
    .filter((file) => /\.(mjs|js|ts|dot)$/.test(file))
    .map((file) => resolve(REPO_ROOT, file));
}

function scanFile(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  const body = readFileSync(filePath, "utf8");
  const diagnostics = [];
  const packetTypes = [];
  const schemas = [];

  for (const match of body.matchAll(PACKET_TYPE_RE)) {
    packetTypes.push(match[1]);
  }
  for (const match of body.matchAll(PACKET_SCHEMA_RE)) {
    schemas.push(match[1]);
  }
  if (INLINE_REMEDIATION_PACKET_RE.test(body)) {
    diagnostics.push({
      code: "inline_remediation_packet_literal",
      file: filePath,
      message: "Inline remediation_packet object literals are forbidden; use buildRemediationPacket().",
    });
  }
  for (const packetType of packetTypes) {
    if (!findPacketRegistryEntry(packetType)) {
      diagnostics.push({
        code: "unregistered_packet_type",
        file: filePath,
        message: `Packet type is not registered: ${packetType}`,
      });
    }
  }
  for (const schemaVersion of schemas) {
    if (!REGISTERED_SCHEMA_VERSIONS.has(schemaVersion) && !PACKETISH_SCHEMA_RE.test(schemaVersion)) continue;
    if (!REGISTERED_SCHEMA_VERSIONS.has(schemaVersion)) {
      diagnostics.push({
        code: "unregistered_packet_schema_version",
        file: filePath,
        message: `Packet schema_version is not registered: ${schemaVersion}`,
      });
      continue;
    }
    if (!packetTypes.length) {
      diagnostics.push({
        code: "packet_schema_missing_packet_type",
        file: filePath,
        message: `Packet schema_version requires packet_type alongside it: ${schemaVersion}`,
      });
    }
  }
  return diagnostics;
}

function checkNamedPacketContract(args = {}) {
  const files = Array.isArray(args.file) && args.file.length > 0 ? args.file : trackedFiles();
  const diagnostics = files
    .flatMap((filePath) => scanFile(filePath))
    .map((diagnostic) => `[named-packet-contract] ${diagnostic.code} file=${diagnostic.file} message="${diagnostic.message}"`);
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    files: files.length,
  };
}

if (process.argv[1]?.endsWith("check-named-packet-contract.ts") || process.argv[1]?.endsWith("check-named-packet-contract.mjs")) {
  main(checkNamedPacketContract, {
    gate: "named-packet-contract",
    usage,
    argSchema: [
      { flag: "--file", type: "path", multi: true },
    ],
    okMessage: (_args, result) => `files=${result.files}`,
  });
}
