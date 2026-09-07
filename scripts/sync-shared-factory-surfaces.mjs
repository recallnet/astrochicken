#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FACTORY_SHARED_SURFACE_MANIFEST,
  RUNTIME_SKILL_PATHS,
  renderFactorySharedSurfaceTemplate,
  resolveExternalSurfaceOutputPath,
  resolveSurfaceOutputPath,
  resolveSurfaceTemplatePath,
} from "./lib/factory-shared-surface-manifest.ts";

const OVERLAY_EXAMPLE_CONTENT = `# Factory-local overlay — extend canonical roles without forking roles.stylesheet
# Place this as roles.stylesheet.override in your factory root and @import it
# after the canonical stylesheet in your graph @import chain.

.coder {
  llm_model = "openai/gpt-4o";
  llm_provider = "openrouter";
}

.reviewer {
  llm_model = "openai/gpt-4o";
  llm_provider = "openrouter";
}
`;

const EXTERNAL_RUNTIME_SKILL_FILES = Object.freeze([
  Object.freeze({
    source: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md",
    destination: "skills/_runtime/supervisor_review/SKILL.md",
  }),
]);

function parseArgs(argv) {
  const options = {
    check: false,
    repoRoot: process.cwd(),
    surfaceId: "",
    externalRoot: "",
    factoryId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = argv[index + 1] ? resolve(argv[index + 1]) : "";
      index += 1;
      continue;
    }
    if (arg === "--surface") {
      options.surfaceId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--external-root") {
      options.externalRoot = argv[index + 1] ? resolve(argv[index + 1]) : "";
      index += 1;
      continue;
    }
    if (arg === "--factory-id") {
      options.factoryId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: node scripts/sync-shared-factory-surfaces.mjs [--check] [--surface <id>] [--repo-root <path>] [--external-root <path> --factory-id <id>]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.externalRoot && !options.factoryId) {
    throw new Error("--factory-id is required when --external-root is provided");
  }

  if (!options.externalRoot && options.factoryId) {
    throw new Error("--factory-id is only supported with --external-root");
  }

  return options;
}

function collectEntries(surfaceId) {
  const surfaces = surfaceId
    ? FACTORY_SHARED_SURFACE_MANIFEST.filter((entry) => entry.id === surfaceId)
    : FACTORY_SHARED_SURFACE_MANIFEST;
  if (surfaceId && surfaces.length === 0) {
    throw new Error(`Unknown shared surface: ${surfaceId}`);
  }
  return surfaces;
}

function collectFactoryEntries(factoryId, surfaceId) {
  return collectEntries(surfaceId).filter((surface) => surface.outputs.some((output) => output.factoryId === factoryId));
}

function verifyRequiredSkillPaths(repoRoot, factoryId, requiredSkillPaths) {
  for (const requiredPath of requiredSkillPaths) {
    const resolved = resolve(repoRoot, "factories", factoryId, requiredPath);
    if (!existsSync(resolved)) {
      throw new Error(`missing required factory asset for ${factoryId}: ${relative(repoRoot, resolved)}`);
    }
  }
}

function findFactoryOutput(surface, factoryId) {
  const output = surface.outputs.find((entry) => entry.factoryId === factoryId);
  if (!output) {
    throw new Error(`shared surface '${surface.id}' does not define output for factory '${factoryId}'`);
  }
  return output;
}

function resolveExternalSurfacePath(outputPath, factoryId) {
  const normalizedPath = String(outputPath || "").replace(/\\/g, "/");
  const expectedPrefix = `factories/${factoryId}/`;
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error(`shared surface output path '${outputPath}' does not match expected prefix '${expectedPrefix}'`);
  }
  return normalizedPath.slice(expectedPrefix.length);
}

function syncSurfaceEntry(repoRoot, surface, checkOnly) {
  const templatePath = resolveSurfaceTemplatePath(repoRoot, surface.templatePath);
  const templateSource = readFileSync(templatePath, "utf8");
  const changed = [];

  for (const output of surface.outputs) {
    verifyRequiredSkillPaths(repoRoot, output.factoryId, surface.contract.requiredSkillPaths);
    const rendered = renderFactorySharedSurfaceTemplate(templateSource, output.values).replace(/\s+$/u, "\n");
    const outputPath = resolveSurfaceOutputPath(repoRoot, output.outputPath);
    const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (current === rendered) {
      continue;
    }
    changed.push(relative(repoRoot, outputPath));
    if (!checkOnly) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, rendered);
    }
  }

  return changed;
}

function syncExternalSurfaceEntry(repoRoot, externalRoot, surface, factoryId, checkOnly) {
  const output = findFactoryOutput(surface, factoryId);
  verifyRequiredSkillPaths(repoRoot, factoryId, surface.contract.requiredSkillPaths);

  const templatePath = resolveSurfaceTemplatePath(repoRoot, surface.templatePath);
  const templateSource = readFileSync(templatePath, "utf8");
  const rendered = renderFactorySharedSurfaceTemplate(templateSource, output.values).replace(/\s+$/u, "\n");

  const externalRelativePath = resolveExternalSurfacePath(output.outputPath, factoryId);
  const externalOutputPath = resolve(externalRoot, externalRelativePath);
  const current = existsSync(externalOutputPath) ? readFileSync(externalOutputPath, "utf8") : "";
  if (current === rendered) {
    return [];
  }

  if (!checkOnly) {
    mkdirSync(dirname(externalOutputPath), { recursive: true });
    writeFileSync(externalOutputPath, rendered);
  }

  return [externalRelativePath];
}

function syncExternalRuntimeSkills(repoRoot, externalRoot, checkOnly) {
  const changed = [];

  for (const skillFile of EXTERNAL_RUNTIME_SKILL_FILES) {
    const sourcePath = resolve(repoRoot, skillFile.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`missing required runtime skill asset: ${relative(repoRoot, sourcePath)}`);
    }

    const rendered = readFileSync(sourcePath, "utf8").replace(/\s+$/u, "\n");
    const destinationPath = resolve(externalRoot, skillFile.destination);
    const current = existsSync(destinationPath) ? readFileSync(destinationPath, "utf8") : "";
    if (current === rendered) {
      continue;
    }

    changed.push(skillFile.destination);
    if (!checkOnly) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      writeFileSync(destinationPath, rendered);
    }
  }

  return changed;
}

export function syncSharedFactorySurfaces({
  repoRoot = process.cwd(),
  check = false,
  surfaceId = "",
  externalRoot = "",
  factoryId = "",
} = {}) {
  const normalizedRepoRoot = resolve(repoRoot);
  const normalizedExternalRoot = externalRoot ? resolve(externalRoot) : "";

  const changes = [];
  for (const surface of collectEntries(surfaceId)) {
    const surfaceChanges = normalizedExternalRoot
      ? syncExternalSurfaceEntry(normalizedRepoRoot, normalizedExternalRoot, surface, factoryId, check)
      : syncSurfaceEntry(normalizedRepoRoot, surface, check);

    for (const file of surfaceChanges) {
      changes.push({ surfaceId: surface.id, file });
    }
  }

  if (normalizedExternalRoot) {
    const runtimeSkillChanges = syncExternalRuntimeSkills(normalizedRepoRoot, normalizedExternalRoot, check);
    for (const file of runtimeSkillChanges) {
      changes.push({ surfaceId: "runtime_skill_distribution", file });
    }
  }

  return changes;
}

function rewriteRuntimeSkillPathsForExternal(renderedGraph) {
  let rewritten = renderedGraph;
  for (const runtimeSkill of RUNTIME_SKILL_PATHS) {
    rewritten = rewritten.replaceAll(runtimeSkill.sourcePath, runtimeSkill.externalDest);
  }
  return rewritten;
}

/**
 * Render canonical shared surfaces for an external standalone factory layout.
 *
 * @param {object} params
 * @param {string} [params.repoRoot=process.cwd()] monorepo root containing templates and runtime skills
 * @param {string} params.externalRoot target external factory root
 * @param {string} params.factoryId factory id whose manifest outputs should be rendered
 * @param {boolean} [params.check=false] when true, detect drift without writing
 * @param {string} [params.surfaceId=""] optional single-surface filter
 * @returns {{ kind: "surface"|"skill"|"overlay", surfaceId: string, file: string }[]}
 */
export function renderExternalFactorySurfaces({
  repoRoot = process.cwd(),
  externalRoot,
  factoryId,
  check = false,
  surfaceId = "",
} = {}) {
  if (!externalRoot) {
    throw new Error("renderExternalFactorySurfaces requires externalRoot");
  }
  if (!factoryId) {
    throw new Error("renderExternalFactorySurfaces requires factoryId");
  }

  const changes = [];
  const surfaces = collectFactoryEntries(factoryId, surfaceId);

  for (const surface of surfaces) {
    const output = surface.outputs.find((entry) => entry.factoryId === factoryId);
    if (!output) {
      continue;
    }

    const templatePath = resolveSurfaceTemplatePath(repoRoot, surface.templatePath);
    const templateSource = readFileSync(templatePath, "utf8");
    let rendered = renderFactorySharedSurfaceTemplate(templateSource, output.values);
    rendered = rewriteRuntimeSkillPathsForExternal(rendered).replace(/\s+$/u, "\n");

    const outputPath = resolveExternalSurfaceOutputPath(externalRoot, surface);
    const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (current !== rendered) {
      changes.push({ kind: "surface", surfaceId: surface.id, file: outputPath });
      if (!check) {
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, rendered);
      }
    }
  }

  for (const runtimeSkill of RUNTIME_SKILL_PATHS) {
    const sourcePath = resolve(repoRoot, runtimeSkill.sourcePath);
    const destinationPath = resolve(externalRoot, runtimeSkill.externalDest);
    const sourceContent = readFileSync(sourcePath, "utf8");
    const destinationContent = existsSync(destinationPath) ? readFileSync(destinationPath, "utf8") : "";

    if (sourceContent !== destinationContent) {
      changes.push({ kind: "skill", surfaceId: `runtime_skill:${runtimeSkill.skillId}`, file: destinationPath });
      if (!check) {
        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, sourceContent);
      }
    }
  }

  const overlayExamplePath = resolve(externalRoot, "roles.stylesheet.override.example");
  if (!existsSync(overlayExamplePath)) {
    changes.push({ kind: "overlay", surfaceId: "roles.stylesheet.override.example", file: overlayExamplePath });
    if (!check) {
      mkdirSync(externalRoot, { recursive: true });
      writeFileSync(overlayExamplePath, OVERLAY_EXAMPLE_CONTENT);
    }
  }

  return changes;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.externalRoot) {
    const externalChanges = renderExternalFactorySurfaces(options);
    if (options.check && externalChanges.length > 0) {
      for (const change of externalChanges) {
        process.stderr.write(`shared_surface_drift surface=${change.surfaceId} file=${change.file}\n`);
      }
      process.exit(1);
    }
    for (const change of externalChanges) {
      process.stdout.write(`shared_surface_sync surface=${change.surfaceId} file=${change.file}\n`);
    }
    return;
  }

  const changes = syncSharedFactorySurfaces(options);
  if (options.check && changes.length > 0) {
    for (const change of changes) {
      process.stderr.write(`shared_surface_drift surface=${change.surfaceId} file=${change.file}\n`);
    }
    process.exit(1);
  }
  for (const change of changes) {
    process.stdout.write(`shared_surface_sync surface=${change.surfaceId} file=${change.file}\n`);
  }
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
