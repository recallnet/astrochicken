import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { SCENARIO_REGISTRY_MAX_COUNT } from "../lib/scenario-registry.ts";

const DEFAULT_REGISTRY_ROOT = "factories/mothership/scenarios";
const DEFAULT_MAX_COUNT = SCENARIO_REGISTRY_MAX_COUNT;

function toAbsolute(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return resolve(process.cwd(), DEFAULT_REGISTRY_ROOT);
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function countScenarioFiles(rootPath) {
  if (!existsSync(rootPath)) return 0;

  let count = 0;
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        queue.push(full);
        continue;
      }

      if (stats.isFile() && entry === "SCENARIO.md") {
        count += 1;
      }
    }
  }

  return count;
}

export function scenarioCountGate({ registryRoot = DEFAULT_REGISTRY_ROOT, maxCount = DEFAULT_MAX_COUNT } = {}) {
  const resolvedRegistryRoot = toAbsolute(registryRoot);
  const limit = parsePositiveInt(maxCount, DEFAULT_MAX_COUNT);
  const exists = existsSync(resolvedRegistryRoot);
  const scenario_count = countScenarioFiles(resolvedRegistryRoot);

  if (scenario_count > limit) {
    return {
      ok: false,
      error: `scenario registry count ${scenario_count} exceeds configured ceiling ${limit}`,
      scenario_count: String(scenario_count),
      max_count: String(limit),
      registry_root: resolvedRegistryRoot,
      registry_exists: exists ? "true" : "false",
    };
  }

  return {
    ok: true,
    error: "",
    scenario_count: String(scenario_count),
    max_count: String(limit),
    registry_root: resolvedRegistryRoot,
    registry_exists: exists ? "true" : "false",
  };
}
