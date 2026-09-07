import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function importIfExists(filePath) {
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;
  return import(pathToFileURL(filePath).href);
}

export function resolveSafeProcessCwd({ cwdResolver = () => process.cwd() } = {}) {
  try {
    return String(cwdResolver() || "").trim();
  } catch (error) {
    const message = String(error?.message || error || "");
    if (error?.code === "ENOENT" || /uv_cwd/i.test(message)) {
      return "";
    }
    throw error;
  }
}

export function resolveSharedPresenterCandidates({
  moduleUrl = import.meta.url,
  cwdResolver = () => process.cwd(),
  contextRepoRoot = String(process.env.FACTORY_CONTEXT_REPO_PATH || "").trim(),
} = {}) {
  const candidates = [];
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  candidates.push(path.resolve(moduleDir, "../../../../apps/hatch/dist/factory/status-presenter.js"));
  candidates.push(path.resolve(moduleDir, "../../../../apps/hatch/src/factory/status-presenter.ts"));

  const safeCwd = resolveSafeProcessCwd({ cwdResolver });
  if (safeCwd) {
    candidates.push(path.resolve(safeCwd, "apps", "hatch", "dist", "factory", "status-presenter.js"));
    candidates.push(path.resolve(safeCwd, "apps", "hatch", "src", "factory", "status-presenter.ts"));
  }

  if (contextRepoRoot) {
    candidates.push(path.resolve(contextRepoRoot, "apps", "hatch", "dist", "factory", "status-presenter.js"));
    candidates.push(path.resolve(contextRepoRoot, "apps", "hatch", "src", "factory", "status-presenter.ts"));
  }

  return candidates;
}

async function loadSharedPresenterModule() {
  const candidates = resolveSharedPresenterCandidates();

  try {
    const hatchEntryUrl = import.meta.resolve("hatch");
    const hatchEntryPath = fileURLToPath(hatchEntryUrl);
    const hatchDistDir = path.dirname(hatchEntryPath);
    candidates.push(path.join(hatchDistDir, "factory", "status-presenter.js"));
    candidates.push(path.resolve(hatchDistDir, "../src/factory/status-presenter.ts"));
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    const loaded = await importIfExists(candidate);
    if (!loaded) continue;
    if (
      typeof loaded.presentFactoryStatus === "function"
      && typeof loaded.presentFactoryActiveSummary === "function"
      && typeof loaded.presentTickStatus === "function"
      && typeof loaded.renderFactoryPresentation === "function"
    ) {
      return loaded;
    }
  }

  try {
    const hatch = await import("hatch");
    if (
      typeof hatch.presentFactoryStatus === "function"
      && typeof hatch.presentFactoryActiveSummary === "function"
      && typeof hatch.presentTickStatus === "function"
      && typeof hatch.renderFactoryPresentation === "function"
    ) {
      return hatch;
    }
  } catch {
    // fallback exhausted below
  }

  const attempted = candidates.map((value) => value.replace(/\\/g, "/")).join(", ");
  throw new Error(`[factory-status-presenter] shared presenter import failed; attempted=${attempted}`);
}

const sharedPresenter = await loadSharedPresenterModule();

export const {
  formatFactoryContextHeaderLines,
  formatControlPlaneGateSection,
  formatManagedStateLine,
  formatRuntimeDriftSection,
  formatActiveRunTreeRows,
  formatTickStageLine,
  presentFactoryStatus,
  presentFactoryActiveSummary,
  presentTickStatus,
  renderFactoryPresentation,
} = sharedPresenter;
