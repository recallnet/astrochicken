#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "scripts/config/scenario-registry.json";
const DEFAULT_MAX_SCENARIOS = 30;
const DEFAULT_ROOTS = Object.freeze(["factories/mothership/scenarios"]);

function usage() {
  return "Usage: node scripts/check-scenario-registry-budget.ts [--config <path>] [--all-tracked] [--json] [--help]";
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toAbsolutePath(pathValue) {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    throw new Error("scenario registry root must be a non-empty path");
  }
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function parseArgs(argv) {
  const options = {
    configPath: DEFAULT_CONFIG_PATH,
    allTracked: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      options.configPath = value;
      index += 1;
      continue;
    }
    if (arg === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function loadConfig(configPath) {
  const absoluteConfigPath = toAbsolutePath(configPath);
  const raw = readFileSync(absoluteConfigPath, "utf8");
  const parsed = JSON.parse(raw);

  const maxScenarios = parsePositiveInt(parsed?.maxScenarios, DEFAULT_MAX_SCENARIOS);
  const rootValues = Array.isArray(parsed?.roots) && parsed.roots.length > 0
    ? parsed.roots
    : DEFAULT_ROOTS;
  const roots = rootValues.map(toAbsolutePath);

  return {
    configPath: absoluteConfigPath,
    maxScenarios,
    roots,
  };
}

function countScenarioFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return 0;
  }

  let count = 0;
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];

    try {
      entries = readdirSync(current).sort((a, b) => a.localeCompare(b, "en"));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (stats.isFile() && entry === "SCENARIO.md") {
        count += 1;
      }
    }
  }

  return count;
}

export function checkScenarioRegistryBudget({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  const config = loadConfig(configPath);

  const roots = config.roots.map((rootPath) => ({
    root: rootPath,
    count: countScenarioFiles(rootPath),
  }));

  const totalScenarios = roots.reduce((sum, entry) => sum + entry.count, 0);
  const ok = totalScenarios <= config.maxScenarios;

  return {
    ok,
    config_path: config.configPath,
    max_scenarios: config.maxScenarios,
    total_scenarios: totalScenarios,
    roots,
    error: ok ? "" : `scenario registry count ${totalScenarios} exceeds configured ceiling ${config.maxScenarios}`,
  };
}

function printResult(result) {
  for (const root of result.roots) {
    process.stdout.write(`[scenario_registry_budget] root=${JSON.stringify(root.root)} count=${root.count}\n`);
  }

  process.stdout.write(`Scenario count: ${result.total_scenarios} / limit ${result.max_scenarios}\n`);
  process.stdout.write(
    `[scenario_registry_budget] result=${result.ok ? "ok" : "fail"} total=${result.total_scenarios} max=${result.max_scenarios}\n`,
  );

  if (!result.ok && result.error) {
    process.stderr.write(`[scenario_registry_budget] error=${result.error}\n`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = checkScenarioRegistryBudget({ configPath: options.configPath });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  printResult(result);

  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(1);
  }
}
