#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "provisioning-drift";

import {
  checkProvisioningDriftForInstance,
  formatProvisioningDriftSummary,
  runProvisioningDriftCheck,
} from "../packages/factory-ops/src/lib/factory-provisioning-drift.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function parseArgv(argv = []) {
  const parsed = {
    instanceId: "",
    all: false,
    json: false,
    registryPath: "factory-registry.json",
    repoRoot: process.cwd(),
    targetRepoPath: "",
    targetRepoMapJsonPath: "",
    labelsJsonPath: "",
    instancePath: ".hatch/instance.json",
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = trim(args[index]);
    if (!entry) continue;

    if (entry === "--all") {
      parsed.all = true;
      continue;
    }
    if (entry === "--json") {
      parsed.json = true;
      continue;
    }

    if (!entry.startsWith("--")) continue;

    const separator = entry.indexOf("=");
    const hasInlineValue = separator >= 0;
    const key = hasInlineValue ? entry.slice(2, separator).trim() : entry.slice(2).trim();
    const value = hasInlineValue
      ? entry.slice(separator + 1).trim()
      : trim(args[index + 1]);

    if (!hasInlineValue && value && !value.startsWith("--")) {
      index += 1;
    }

    if (key === "instance-id") parsed.instanceId = value;
    else if (key === "registry-path") parsed.registryPath = value || "factory-registry.json";
    else if (key === "repo-root") parsed.repoRoot = value || process.cwd();
    else if (key === "target-repo-path") parsed.targetRepoPath = value;
    else if (key === "target-repo-map-json") parsed.targetRepoMapJsonPath = value;
    else if (key === "labels-json-path") parsed.labelsJsonPath = value;
    else if (key === "instance-path") parsed.instancePath = value || ".hatch/instance.json";
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const report = runProvisioningDriftCheck({
    instanceId: flags.instanceId,
    all: flags.all,
    registryPath: flags.registryPath,
    repoRoot: flags.repoRoot,
    targetRepoPath: flags.targetRepoPath,
    targetRepoMapJsonPath: flags.targetRepoMapJsonPath,
    labelsJsonPath: flags.labelsJsonPath,
    instancePath: flags.instancePath,
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(report));
    process.stdout.write("\n");
  } else {
    process.stdout.write(`${formatProvisioningDriftSummary(report)}\n`);
  }

  process.stdout.write(`[${TELEMETRY_PREFIX}] result=${report.ok ? "ok" : "fail"} checked=${Number(report.checked_count) || 0} drifted=${Number(report.drifted_count) || 0}\n`);

  process.exitCode = report.ok ? 0 : 1;
}

export {
  checkProvisioningDriftForInstance,
  runProvisioningDriftCheck,
  formatProvisioningDriftSummary,
};

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    const payload = {
      schema: "factory.provisioning_drift.report.v1",
      ok: false,
      checked_count: 0,
      drifted_count: 0,
      registry_path: "",
      entries: [],
      error_code: "provisioning_drift_check_failed",
      error: String(error?.message || error || "unknown_error"),
      timestamp: new Date().toISOString(),
    };
    process.stderr.write(`${payload.error}\n`);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.stdout.write(`[${TELEMETRY_PREFIX}] result=fail checked=0 drifted=0\n`);
    process.exitCode = 1;
  });
}
