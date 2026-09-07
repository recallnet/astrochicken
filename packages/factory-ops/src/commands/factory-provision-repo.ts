import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "../lib/error-catalog.ts";
import { provisionFactoryProvisioningContract } from "../lib/factory-provisioning-contract.ts";
import {
  findRegistryInstanceRow,
  loadFactoryRegistry,
} from "../lib/factory-registry.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export function provisionFactoryRepo({
  instanceId = "",
  registryPath = "factory-registry.json",
  repoRoot = process.cwd(),
  targetRepoPath = "",
  instancePath = ".hatch/instance.json",
  dryRun = false,
  cwd = process.cwd(),
  loadFactoryRegistryFn = loadFactoryRegistry,
  findRegistryInstanceRowFn = findRegistryInstanceRow,
  provisionFactoryProvisioningContractFn = provisionFactoryProvisioningContract,
  ghExec,
  ghJsonExec,
  authCheck,
  gitExec,
  writeAtomicJsonFn,
  writeFileSyncFn,
} = {}) {
  const normalizedInstanceId = trim(instanceId);
  if (!normalizedInstanceId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.missing_args, "instance_id_required");
  }

  const loaded = loadFactoryRegistryFn({ registryPath, cwd });
  const row = findRegistryInstanceRowFn(loaded.registry, normalizedInstanceId);
  if (!row) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing,
      `instance_not_registered:${normalizedInstanceId}`,
    );
  }

  const resolvedRepoRoot = path.resolve(trim(repoRoot || cwd));
  const resolvedTargetRepoPath = path.resolve(trim(targetRepoPath || cwd));

  const report = provisionFactoryProvisioningContractFn({
    repoRoot: resolvedRepoRoot,
    instanceRow: row,
    targetRepoPath: resolvedTargetRepoPath,
    instanceRelativePath: instancePath,
    dryRun: Boolean(dryRun),
    ghExec,
    ghJsonExec,
    authCheck,
    gitExec,
    writeAtomicJsonFn,
    writeFileSyncFn,
  });

  return {
    schema: "factory.provision_repo.report.v1",
    ok: true,
    status: report.status,
    error_code: "",
    instance_id: normalizedInstanceId,
    registry_path: loaded.registryPath,
    dry_run: Boolean(dryRun),
    report,
  };
}

function parseArgv(argv = []) {
  const parsed = {
    instanceId: "",
    registryPath: "factory-registry.json",
    repoRoot: process.cwd(),
    targetRepoPath: "",
    instancePath: ".hatch/instance.json",
    dryRun: false,
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = trim(args[index]);
    if (!entry) continue;

    if (entry === "--dry-run") {
      parsed.dryRun = true;
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
    else if (key === "instance-path") parsed.instancePath = value || ".hatch/instance.json";
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const report = provisionFactoryRepo({
    instanceId: flags.instanceId,
    registryPath: flags.registryPath,
    repoRoot: flags.repoRoot,
    targetRepoPath: flags.targetRepoPath,
    instancePath: flags.instancePath,
    dryRun: flags.dryRun,
  });
  process.stdout.write(JSON.stringify(report));
  process.exitCode = report.ok ? 0 : 1;
}

const isDirectRun = (() => {
  const current = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return current === invoked;
})();

if (isDirectRun) {
  await main();
}
