import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HATCH_PARSE_MODULE_URL = new URL("../../apps/hatch/dist/pipeline/parse.js", import.meta.url);
const HATCH_STYLESHEET_IMPORTS_MODULE_URL = new URL("../../apps/hatch/dist/pipeline/stylesheet-imports.js", import.meta.url);
const FALLBACK_PARSE_MODULE_URL = new URL("./hatch-dot-parser-fallback.mjs", import.meta.url);

let parserModulePromise;
let stylesheetModulePromise;

function isTruthyEnv(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function importFallbackParser(distError) {
  try {
    return await import(FALLBACK_PARSE_MODULE_URL.href);
  } catch (fallbackError) {
    const message = [
      `failed to load hatch dist parser at ${HATCH_PARSE_MODULE_URL.pathname}`,
      `failed to load fallback parser at ${FALLBACK_PARSE_MODULE_URL.pathname}`,
      `dist_cause: ${String(distError?.message || distError)}`,
      `fallback_cause: ${String(fallbackError?.message || fallbackError)}`,
    ].join("; ");
    throw new Error(message);
  }
}

async function loadParserModule() {
  if (!parserModulePromise) {
    const forceFallback = isTruthyEnv(process.env.HATCH_DOT_PARSER_FORCE_FALLBACK);

    parserModulePromise = forceFallback
      ? import(FALLBACK_PARSE_MODULE_URL.href)
      : import(HATCH_PARSE_MODULE_URL.href).catch((error) => importFallbackParser(error));
  }
  return parserModulePromise;
}

async function loadStylesheetModule() {
  if (!stylesheetModulePromise) {
    stylesheetModulePromise = import(HATCH_STYLESHEET_IMPORTS_MODULE_URL.href).catch(() => null);
  }
  return stylesheetModulePromise;
}

function hasImportDirective(input) {
  return /(^|\n)\s*@import\s+"[^"]+"/.test(String(input || ""));
}

function ensureStylesheetImportMetadata(parsed, input) {
  if (Array.isArray(parsed?.stylesheetImports)) {
    return parsed.stylesheetImports;
  }

  if (hasImportDirective(input)) {
    throw new Error("hatch parser wrapper error: parser module does not expose stylesheetImports metadata");
  }

  return [];
}

function resolveRepoRootForFile(filePath) {
  let current = resolve(dirname(filePath));
  while (true) {
    if (existsSync(resolve(current, ".git"))) {
      return current;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(dirname(filePath));
    }

    current = parent;
  }
}

export async function parseDot(input) {
  const module = await loadParserModule();
  if (typeof module.parse !== "function") {
    throw new Error("hatch parser wrapper error: parser module does not export parse()");
  }
  return module.parse(input);
}

export async function parseDotWithAst(input) {
  const module = await loadParserModule();
  if (typeof module.parseWithAst !== "function") {
    throw new Error("hatch parser wrapper error: parser module does not export parseWithAst()");
  }
  return module.parseWithAst(input);
}

export async function parseDotFileWithAst({ input, filePath, repoRootPath }) {
  const parsed = await parseDotWithAst(input);
  const stylesheetImports = ensureStylesheetImportMetadata(parsed, input);
  if (!Array.isArray(parsed.stylesheetImports)) {
    parsed.stylesheetImports = stylesheetImports;
  }

  const effectiveRepoRoot = repoRootPath ? resolve(repoRootPath) : resolveRepoRootForFile(filePath);
  const stylesheetModule = await loadStylesheetModule();
  if (stylesheetModule?.applyGraphStylesheetImports) {
    stylesheetModule.applyGraphStylesheetImports({
      graph: parsed.graph,
      graphFile: filePath,
      stylesheetImports,
      repoRootPath: effectiveRepoRoot,
    });
    return parsed;
  }

  if (stylesheetImports.length > 0) {
    const error = new Error(
      `hatch parser wrapper error: stylesheet import loader unavailable (expected ${HATCH_STYLESHEET_IMPORTS_MODULE_URL.pathname})`,
    );
    error.code = "stylesheet_import.missing";
    throw error;
  }

  return parsed;
}
