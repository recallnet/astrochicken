#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(scriptsDir, "..");
const hatchDistIndex = path.join(monorepoRoot, "apps", "hatch", "dist", "index.js");
const hatchCliPath = path.join(monorepoRoot, "apps", "hatch", "dist", "cli.js");
const hatchOpsCliPath = path.join(monorepoRoot, "packages", "factory-ops", "src", "cli.ts");
const acmeSupportDir = path.join(monorepoRoot, "examples", "external-factories", "acme-support");

const PHASES = Object.freeze(["config_schema", "skill_loading", "scenario_root", "run_dir_isolation"]);

function emit(line) {
  process.stdout.write(`${line}\n`);
}

function ensureBuiltRuntime() {
  if (existsSync(hatchDistIndex) && existsSync(hatchCliPath)) {
    return;
  }

  const missing = [
    existsSync(hatchDistIndex) ? "" : hatchDistIndex,
    existsSync(hatchCliPath) ? "" : hatchCliPath,
  ]
    .filter(Boolean)
    .join(",");
  emit(`[external-factory-smoke] error=hatch_runtime_not_found path=${missing} hint="Run pnpm build first"`);
  process.exit(1);
}

function copyIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return false;
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  return true;
}

function copyDirIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return false;
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, { recursive: true });
  return true;
}

function copyFixtureToTemp(tempDir) {
  const explicitCopies = [
    { type: "file", relPath: "factory.config.json" },
    { type: "dir", relPath: "graphs" },
    { type: "file", relPath: "skills/supervisor/current.md" },
    { type: "dir", relPath: "scenarios" },
    { type: "dir", relPath: "policy-pack" },
  ];

  for (const entry of explicitCopies) {
    const sourcePath = path.join(acmeSupportDir, entry.relPath);
    const destinationPath = path.join(tempDir, entry.relPath);

    if (entry.type === "file") {
      copyIfPresent(sourcePath, destinationPath);
      continue;
    }

    copyDirIfPresent(sourcePath, destinationPath);
  }

  // Keep run_dir_isolation valid for temp-root execution without mutating fixture source.
  const configPath = path.join(tempDir, "factory.config.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    if (raw && typeof raw === "object") {
      raw.runs_dir = "../.hatch/acme-support/runs";
      writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    }
  }
}

function compactOutput(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCommandForLog(command, args) {
  return [command, ...args].map((part) => JSON.stringify(String(part))).join(" ");
}

function runCliCommand({ phase, cliPath, args }) {
  const nodeArgs = [cliPath, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: monorepoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      reject({ phase, message: `spawn_failed ${message}` });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const details = [
        `command=${formatCommandForLog(process.execPath, nodeArgs)}`,
        `exit_code=${code ?? "null"}`,
      ];
      if (signal) {
        details.push(`signal=${signal}`);
      }
      const stderrSummary = compactOutput(stderr);
      const stdoutSummary = compactOutput(stdout);
      if (stderrSummary) {
        details.push(`stderr=${JSON.stringify(stderrSummary)}`);
      } else if (stdoutSummary) {
        details.push(`stdout=${JSON.stringify(stdoutSummary)}`);
      }

      reject({ phase, message: details.join(" ") });
    });
  });
}

async function run() {
  ensureBuiltRuntime();

  if (!existsSync(acmeSupportDir)) {
    emit(`[external-factory-smoke] result=fail failed_phase=setup error=${JSON.stringify(`fixture_not_found:${acmeSupportDir}`)}`);
    process.exit(1);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "acme-smoke-"));

  try {
    if (path.resolve(tempDir).startsWith(path.resolve(monorepoRoot))) {
      emit(`[external-factory-smoke] error=temp_dir_inside_monorepo path=${tempDir}`);
      process.exit(1);
    }

    copyFixtureToTemp(tempDir);

    const fixtureGraphPath = path.join(tempDir, "graphs", "factory_supervisor_tick.dot");

    await runCliCommand({
      phase: "hatch-cli-help",
      cliPath: hatchCliPath,
      args: ["--help"],
    });

    await runCliCommand({
      phase: "hatch-ops-cli-help",
      cliPath: hatchOpsCliPath,
      args: ["factory", "status", "--help"],
    });

    await runCliCommand({
      phase: "hatch-validate",
      cliPath: hatchCliPath,
      args: ["validate", fixtureGraphPath],
    });

    const conformanceArgs = [
      "factory",
      "conformance",
      "--factory-root",
      tempDir,
      "--repo-root",
      tempDir,
      ...PHASES.flatMap((phase) => ["--phase", phase]),
      "--json",
    ];

    await runCliCommand({
      phase: "hatch-conformance",
      cliPath: hatchCliPath,
      args: conformanceArgs,
    });

    emit(`[external-factory-smoke] result=pass phases=${PHASES.join(",")}`);
    process.exit(0);
  } catch (error) {
    const failedPhase = typeof error === "object" && error && "phase" in error
      ? String(error.phase || "runtime")
      : "runtime";
    const message = typeof error === "object" && error && "message" in error
      ? String(error.message || "unknown_error")
      : String(error || "unknown_error");
    emit(`[external-factory-smoke] result=fail failed_phase=${failedPhase} error=${JSON.stringify(message)}`);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  emit(`[external-factory-smoke] result=fail failed_phase=runtime error=${JSON.stringify(message)}`);
  process.exit(1);
});
