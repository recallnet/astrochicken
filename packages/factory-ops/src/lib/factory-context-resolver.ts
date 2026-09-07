import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function importIfExists(filePath) {
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  return import(pathToFileURL(filePath).href);
}

async function loadSharedResolverModule() {
  const candidates = [];
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(moduleDir, "../../../../apps/hatch/dist/factory/context-resolver.js"));
  candidates.push(path.resolve(process.cwd(), "dist", "factory", "context-resolver.js"));

  const cwdResolver = path.resolve(process.cwd(), "apps", "hatch", "dist", "factory", "context-resolver.js");
  candidates.push(cwdResolver);

  const contextRepoRoot = String(process.env.FACTORY_CONTEXT_REPO_PATH || "").trim();
  if (contextRepoRoot) {
    candidates.push(path.resolve(contextRepoRoot, "apps", "hatch", "dist", "factory", "context-resolver.js"));
  }

  try {
    const hatchEntryUrl = import.meta.resolve("hatch");
    const hatchEntryPath = fileURLToPath(hatchEntryUrl);
    const hatchDistDir = path.dirname(hatchEntryPath);
    candidates.push(path.join(hatchDistDir, "factory", "context-resolver.js"));
  } catch {
    // fall through to explicit package import below.
  }

  for (const candidate of candidates) {
    const loaded = await importIfExists(candidate);
    if (loaded) return loaded;
  }

  try {
    return await import("hatch/factory/context-resolver");
  } catch {
    // fallback exhausted below.
  }

  const attempted = candidates.map((value) => value.replace(/\\/g, "/")).join(", ");
  throw new Error(`[factory-context] shared resolver import failed; attempted=${attempted}`);
}

const sharedResolver = await loadSharedResolverModule();

export function findNearestFactoryConfigPath(options) {
  return sharedResolver.findNearestFactoryConfigPath(options);
}

export function normalizeFactoryContext(context, options) {
  return sharedResolver.normalizeFactoryContext(context, options);
}

export function formatFactoryContextHeaderLines(context) {
  return sharedResolver.formatFactoryContextHeaderLines(context);
}

export function resolveFactoryContext(options) {
  return sharedResolver.resolveFactoryContext(options);
}
