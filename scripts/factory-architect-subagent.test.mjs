import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const hatchFactoryArchitectSkillRoot = "factories/mothership/skills/hatch_factory_architect";

const contextPackPath = join(repoRoot, hatchFactoryArchitectSkillRoot, "context-pack.json");
const currentMdPath = join(repoRoot, hatchFactoryArchitectSkillRoot, "current.md");
const interfacePath = join(repoRoot, hatchFactoryArchitectSkillRoot, "interface.json");

function readRequiredText(path) {
  assert.ok(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

function parseRequiredJson(path) {
  const text = readRequiredText(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    assert.fail(`Failed to parse JSON at ${path}: ${error.message}`);
  }
}

test("context-pack contract requires required_files array with mandated coverage", () => {
  const contextPack = parseRequiredJson(contextPackPath);

  assert.strictEqual(
    Array.isArray(contextPack.required_files),
    true,
    `context-pack.json must export required_files array: ${contextPackPath}`,
  );

  const requiredFiles = [...new Set(contextPack.required_files.map((value) => String(value).trim()).filter(Boolean))];

  const mandatedTargets = [
    "AGENTS.md",
    "docs/skills/factory-design/SKILL.md",
    "apps/hatch/src/cli.ts",
    "apps/hatch/src/pipeline/handler/register.ts",
    "factories/mothership/graphs/*.dot",
    "packages/factory-ops/src/**/*.mjs",
  ];

  for (const target of mandatedTargets) {
    assert.ok(requiredFiles.includes(target), `context-pack.json required_files missing mandated entry: ${target}`);
  }
});

test("current.md includes mandated Hatch Factory Architect headings", () => {
  const currentMd = readRequiredText(currentMdPath);

  assert.ok(/^## Curated Context Pack$/m.test(currentMd), "current.md missing heading: Curated Context Pack");
  assert.ok(/^## Playbooks$/m.test(currentMd), "current.md missing heading: Playbooks");
  assert.ok(/^## Completion Checklist$/m.test(currentMd), "current.md missing heading: Completion Checklist");
  assert.ok(/^## Example Invocation$/m.test(currentMd), "current.md missing heading: Example Invocation");
});

test("interface.json exposes required output schema keys", () => {
  const interfaceDoc = parseRequiredJson(interfacePath);
  const schemaProperties = interfaceDoc?.output_schema?.properties;

  assert.strictEqual(
    schemaProperties && typeof schemaProperties === "object",
    true,
    `interface.json missing output_schema.properties object: ${interfacePath}`,
  );

  for (const key of ["design_summary", "playbook_steps", "validation_commands", "next_actions"]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(schemaProperties, key),
      `interface.json missing required key in output_schema.properties: ${key}`,
    );
  }
});
