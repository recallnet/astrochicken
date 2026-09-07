#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKET_REGISTRY } from "../packages/factory-ops/src/lib/packet-core.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function trackedTestFiles() {
  const output = execFileSync("git", ["ls-files", "-z", "packages/factory-ops/test", "apps/hatch/src"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
  });
  return String(output)
    .split("\0")
    .filter(Boolean)
    .filter((file) => /\.(mjs|js|ts)$/.test(file))
    .map((file) => resolve(REPO_ROOT, file))
    .filter((filePath) => existsSync(filePath));
}

function main() {
  const tests = trackedTestFiles().map((filePath) => ({
    filePath,
    body: readFileSync(filePath, "utf8"),
  }));
  const diagnostics = [];

  for (const entry of PACKET_REGISTRY) {
    if (!String(entry.validator || "").trim()) {
      diagnostics.push({
        code: "packet_family_missing_validator",
        message: `Packet type '${entry.packet_type}' is missing validator metadata.`,
      });
    }
    const hasTestCoverage = tests.some(({ body }) =>
      body.includes(entry.packet_type) || body.includes(entry.schema_version),
    );
    if (!hasTestCoverage) {
      diagnostics.push({
        code: "packet_family_missing_test_reference",
        message: `Packet type '${entry.packet_type}' is not referenced by tracked tests.`,
      });
    }
  }

  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      process.stderr.write(`[packet-family-coverage] ${diagnostic.code} message="${diagnostic.message}"\n`);
    }
    process.stderr.write(`[packet-family-coverage] result=fail diagnostics=${diagnostics.length}\n`);
    process.exit(1);
  }

  process.stdout.write(`[packet-family-coverage] result=ok packet_types=${PACKET_REGISTRY.length}\n`);
}

main();
