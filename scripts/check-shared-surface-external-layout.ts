#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FACTORY_SHARED_SURFACE_MANIFEST,
  RUNTIME_SKILL_PATHS,
  resolveExternalSurfaceOutputPath,
} from "./lib/factory-shared-surface-manifest.ts";

function parseArgs(argv) {
  const options = {
    externalRoot: "",
    factoryId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
        "Usage: node scripts/check-shared-surface-external-layout.ts --external-root <path> --factory-id <id>\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.externalRoot) {
    throw new Error("--external-root is required");
  }
  if (!options.factoryId) {
    throw new Error("--factory-id is required");
  }

  return options;
}

export function checkSharedSurfaceExternalLayout({ externalRoot, factoryId } = {}) {
  if (!externalRoot) {
    throw new Error("checkSharedSurfaceExternalLayout requires externalRoot");
  }
  if (!factoryId) {
    throw new Error("checkSharedSurfaceExternalLayout requires factoryId");
  }

  const diagnostics = [];
  const surfaces = FACTORY_SHARED_SURFACE_MANIFEST.filter((surface) =>
    surface.outputs.some((output) => output.factoryId === factoryId),
  );

  for (const surface of surfaces) {
    const graphPath = resolveExternalSurfaceOutputPath(externalRoot, surface);
    if (!existsSync(graphPath)) {
      diagnostics.push(`missing_surface surface=${surface.id}`);
      continue;
    }

    const rendered = readFileSync(graphPath, "utf8");
    if (rendered.includes("factories/_runtime/")) {
      diagnostics.push(`monorepo_path_leak file=${graphPath}`);
    }
  }

  for (const runtimeSkill of RUNTIME_SKILL_PATHS) {
    const runtimeSkillPath = resolve(externalRoot, runtimeSkill.externalDest);
    if (!existsSync(runtimeSkillPath)) {
      diagnostics.push(`missing_runtime_skill skill=${runtimeSkill.skillId}`);
    }
  }

  return diagnostics;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const diagnostics = checkSharedSurfaceExternalLayout(options);

  if (diagnostics.length > 0) {
    process.stderr.write(`[shared-surface-external-layout] result=fail diagnostics=${diagnostics.length}\n`);
    for (const diagnostic of diagnostics) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("[shared-surface-external-layout] result=ok diagnostics=0\n");
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error("[shared-surface-external-layout] result=fail diagnostics=1");
    console.error(error.message);
    process.exit(1);
  });
}
