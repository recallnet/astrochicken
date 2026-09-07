import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { validateScenarioPayload } from "./scenario-validate-payload.ts";


/**
 * Write a scenario file to the registry.
 * Takes the JSON payload (scenario_domain, scenario_slug, scenario_md)
 * and writes SCENARIO.md to the appropriate registry path.
 */
export function saveScenario({ payload = "{}", registryRoot = "" } = {}) {
  const validated = validateScenarioPayload(payload);
  if (!validated.ok) {
    return { ok: false, error: validated.error, path: "" };
  }
  const resolvedRegistryRoot = String(registryRoot || "").trim();
  if (!resolvedRegistryRoot) {
    return { ok: false, error: "registryRoot is required", path: "" };
  }
  const domain = validated.scenario_domain;
  const slug = validated.scenario_slug;
  const md = validated.scenario_md;
  const root = resolve(resolvedRegistryRoot);

  const dir = join(root, domain, slug);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, "SCENARIO.md");
  writeFileSync(filePath, md + "\n", "utf8");

  return { ok: true, path: filePath, error: "" };
}
