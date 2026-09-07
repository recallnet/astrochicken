import { resolve } from "node:path";

export const SHARED_SURFACE_MANIFEST_SCHEMA_VERSION = "hatch.shared-surface-manifest.v1";
export const platformVersion = "1.0.0";

export const RUNTIME_SKILL_PATHS = Object.freeze([
  Object.freeze({
    skillId: "supervisor_review",
    sourcePath: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md",
    externalDest: "skills/_runtime/supervisor_review/SKILL.md",
  }),
]);

const MOTHERSHIP_SCENARIO_VALUES = Object.freeze({
  factory_id: "mothership",
  trust_domain: "mothership.local",
  scenario_frontmatter_requirements: "",
  scenario_return_requirements: "",
});

export const FACTORY_SHARED_SURFACE_MANIFEST = Object.freeze([
  Object.freeze({
    id: "write_scenario_item",
    description: "Fan-out child: writes and validates a single scenario file",
    templatePath: "factories/_shared/surfaces/graphs/write_scenario_item.dot.template",
    platformVersion,
    contract: { requiredSkillPaths: [], requiredContextKeys: ["scenario_brief", "scenarios_root"], exportKeys: ["scenario_path"] },
    outputs: [
      Object.freeze({
        factoryId: "mothership",
        outputPath: "factories/mothership/graphs/write_scenario_item.dot",
        values: MOTHERSHIP_SCENARIO_VALUES,
      }),
    ],
  }),
  Object.freeze({
    id: "write_scenarios",
    description: "LLM-scoped scenario writer: scans registry, recommends 0-2 scenarios, fans out to write_scenario_item",
    templatePath: "factories/_shared/surfaces/graphs/write_scenarios.dot.template",
    platformVersion,
    contract: { requiredSkillPaths: [], requiredContextKeys: ["approved_features", "scenarios_root"], exportKeys: ["scenario_paths"] },
    outputs: [
      Object.freeze({
        factoryId: "mothership",
        outputPath: "factories/mothership/graphs/write_scenarios.dot",
        values: MOTHERSHIP_SCENARIO_VALUES,
      }),
    ],
  }),
]);

export function renderFactorySharedSurfaceTemplate(source, values) {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key) => values[key] ?? "");
}

export function resolveSurfaceTemplatePath(repoRoot, templatePath) {
  return resolve(repoRoot, templatePath);
}

export function resolveSurfaceOutputPath(repoRoot, outputPath) {
  return resolve(repoRoot, outputPath);
}

export function resolveExternalSurfaceOutputPath(externalRoot, surface) {
  return resolve(externalRoot, "graphs", `${surface.id}.dot`);
}
