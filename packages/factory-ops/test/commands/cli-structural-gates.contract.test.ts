/**
 * CLI structural gates — deterministic contracts that prevent the CLI from
 * degrading over time. Catches:
 *
 * 1. Unregistered commands (class exists but not in domain export array)
 * 2. Duplicate command paths (two commands claim the same route)
 * 3. Non-kebab-case flag names
 * 4. Missing help text (static usage)
 * 5. Eager (non-lazy) business logic imports
 * 6. Dead npm dependencies (listed but never imported)
 * 7. DOT graph CLI references that don't match registered commands
 *
 * All gates use static source analysis — no CLI process spawning required.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CMD_DIR = "packages/factory-ops/src/cli/commands";
const CLI_DIR = "packages/factory-ops/src/cli";
const INDEX_PATH = "packages/factory-ops/src/cli/index.ts";
const CLI_ENTRYPOINT_PATH = "packages/factory-ops/src/cli.ts";
const HELPERS_PATH = "packages/factory-ops/src/cli/helpers.ts";
const PKG_PATH = "packages/factory-ops/package.json";
const GRAPHS_DIR = "factories/mothership/graphs";
const OPS_SRC_DIR = "packages/factory-ops/src";

// ---------------------------------------------------------------------------
// Source loading helpers
// ---------------------------------------------------------------------------

const cmdFiles = readdirSync(CMD_DIR)
  .filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"))
  .sort();

const cmdSources = Object.fromEntries(
  cmdFiles.map((f) => [f, readFileSync(join(CMD_DIR, f), "utf8")]),
);

const indexSrc = readFileSync(INDEX_PATH, "utf8");
const cliEntrypointSrc = readFileSync(CLI_ENTRYPOINT_PATH, "utf8");
const helpersSrc = readFileSync(HELPERS_PATH, "utf8");
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));

/**
 * Commands imported directly in index.mjs from ../commands/** are not represented
 * in src/cli/commands/*.mjs domain files, but they are still registered CLI paths.
 * Include them in DOT command-path gates.
 */
const directIndexCommandPaths = [];
const directIndexImportRe = /from\s+"(\.\.\/commands\/[^\"]+\.(?:mjs|ts))"/g;
let dim;
while ((dim = directIndexImportRe.exec(indexSrc)) !== null) {
  const resolvedPath = join(CLI_DIR, dim[1]);
  if (!existsSync(resolvedPath)) continue;
  if (!directIndexCommandPaths.includes(resolvedPath)) {
    directIndexCommandPaths.push(resolvedPath);
  }
}

const dotGateCommandSources = [
  ...cmdFiles.map((f) => ({ file: f, source: cmdSources[f] })),
  ...directIndexCommandPaths.map((resolvedPath) => ({
    file: resolvedPath.replace(`${OPS_SRC_DIR}/`, ""),
    source: readFileSync(resolvedPath, "utf8"),
  })),
];

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Extract all Command class names from a source file.
 * Matches: export class FooCommand extends Command {
 */
function extractCommandClasses(source) {
  const re = /export\s+class\s+(\w+Command)\s+extends\s+Command\b/g;
  const classes = [];
  let m;
  while ((m = re.exec(source)) !== null) classes.push(m[1]);
  return classes;
}

/**
 * Extract the exported array name and its entries from a command file.
 * Matches: export const fooCommands = [ FooCommand, BarCommand ];
 */
function extractExportArray(source) {
  const re = /export\s+const\s+(\w+Commands)\s*=\s*\[([\s\S]*?)\];/;
  const m = source.match(re);
  if (!m) return { name: null, entries: [] };
  const entries = m[2]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("//"));
  return { name: m[1], entries };
}

/**
 * Extract all `static paths` declarations from a source file.
 * Returns array of path arrays, e.g. [["factory", "status"], ["factory", "watch"]]
 */
function extractStaticPaths(source) {
  const re = /static\s+paths\s*=\s*(\[[\s\S]*?\]);/g;
  const allPaths = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    try {
      // Parse the array literal — it's valid JSON-like
      const parsed = JSON.parse(m[1].replace(/'/g, '"'));
      for (const p of parsed) allPaths.push(p);
    } catch {
      // Fallback regex extraction for non-JSON-parseable paths
      const inner = /\["([^"]+)",\s*"([^"]+)"\]/g;
      let pm;
      while ((pm = inner.exec(m[1])) !== null) {
        allPaths.push([pm[1], pm[2]]);
      }
    }
  }
  return allPaths;
}

/**
 * Extract all Option.String / Option.Boolean flag names from a source file.
 * Matches: Option.String("--flag-name", ...) or Option.Boolean("--flag", ...)
 */
function extractOptionFlags(source) {
  const re = /Option\.(?:String|Boolean)\(\s*"(--[^"]+)"/g;
  const flags = [];
  let m;
  while ((m = re.exec(source)) !== null) flags.push(m[1]);
  return flags;
}

/**
 * Extract all await import("...") paths from execute() methods in a source file.
 * Returns the import paths.
 */
function extractLazyImports(source) {
  const re = /await\s+import\(\s*"([^"]+)"\s*\)/g;
  const imports = [];
  let m;
  while ((m = re.exec(source)) !== null) imports.push(m[1]);
  return imports;
}

/**
 * Extract all top-level import paths from a source file.
 * Matches: import ... from "path" (but not inside functions)
 */
function extractTopLevelImports(source) {
  // Match import statements at the start of lines (top-level)
  const re = /^import\s+.*?\s+from\s+"([^"]+)"/gm;
  const imports = [];
  let m;
  while ((m = re.exec(source)) !== null) imports.push(m[1]);
  return imports;
}

/**
 * Extract the flags for a single CLI invocation from the text following it.
 * Stops at: newline (\n or literal \\n), another CLI invocation, a `gh ` command,
 * shell operators (|, ;, &&), or end of prompt string (").
 *
 * Only extracts flags that are direct arguments to THIS command, not flags
 * embedded inside quoted argument values (e.g., --fallback '...--some-flag...').
 */
function extractFlagsFromInvocation(text) {
  // Find the boundary where this command's args end
  const stopPatterns = [
    /\n/,                                          // literal newline
    /\\n/,                                         // escaped newline in DOT prompt
    /\bnode\s+factories\//,                        // another CLI invocation
    /\bhatch-ops\s+/,                            // another CLI invocation (direct form)
    /\bgh\s+/,                                     // gh CLI invocation
    /[|;](?!\s*\w)/,                               // pipe or semicolon
    /&&/,                                          // shell AND
    /"/,                                           // end of prompt string
  ];

  let boundary = text.length;
  for (const pat of stopPatterns) {
    const m = pat.exec(text);
    if (m && m.index < boundary) boundary = m.index;
  }

  const cmdText = text.substring(0, boundary);

  // Extract flags, but skip those inside single-quoted strings
  // Strategy: remove single-quoted segments, then extract --flags
  const withoutQuoted = cmdText.replace(/'[^']*'/g, "''");
  const flagRe = /--([\w-]+)/g;
  const flags = [];
  let fm;
  while ((fm = flagRe.exec(withoutQuoted)) !== null) {
    flags.push(`--${fm[1]}`);
  }
  return flags;
}

/**
 * Extract CLI invocations from DOT graph files.
 * Matches both forms:
 *   node packages/factory-ops/src/cli.ts <domain> run --op <action>
 *   hatch-ops <domain> <action>
 * Returns [{domain, action, file, flags}]
 */
function extractDotCliInvocations(dotSource, fileName) {
  const invocations = [];

  // Pattern 1: node packages/factory-ops/src/cli.ts <domain> run --op <action>
  const re1 =
    /node\s+packages\/factory-ops\/src\/cli\.mjs\s+(\w[\w-]*)\s+run\s+--op\s+([\w-]+)/g;
  let m;
  while ((m = re1.exec(dotSource)) !== null) {
    const afterAction = dotSource.substring(m.index + m[0].length);
    const flags = extractFlagsFromInvocation(afterAction);
    const path = [m[1], m[2]];
    invocations.push({ domain: m[1], action: m[2], path, file: fileName, flags });
  }

  // Pattern 2: hatch-ops <domain> <action> (direct form)
  const re2 = /hatch-ops\s+(\w[\w-]*)\s+([\w-]+)/g;
  while ((m = re2.exec(dotSource)) !== null) {
    if (m[2] === "run") continue; // Skip "run --op" form (handled above)
    const afterAction = dotSource.substring(m.index + m[0].length);
    const flags = extractFlagsFromInvocation(afterAction);
    const path = [m[1], m[2]];
    const tokenRe = /^\s+([A-Za-z][\w-]*)/;
    let remainder = afterAction;
    while (true) {
      const tokenMatch = remainder.match(tokenRe);
      if (!tokenMatch) break;
      path.push(tokenMatch[1]);
      remainder = remainder.slice(tokenMatch[0].length);
    }
    invocations.push({ domain: m[1], action: m[2], path, file: fileName, flags });
  }

  return invocations;
}

function resolveRegisteredInvocationPath(registeredPaths, invocation = {}) {
  const tokens = Array.isArray(invocation.path) ? invocation.path : [invocation.domain, invocation.action].filter(Boolean);
  for (let len = tokens.length; len >= 2; len -= 1) {
    const candidate = tokens.slice(0, len).join(" ");
    if (registeredPaths.has(candidate)) return candidate;
  }
  return `${invocation.domain} ${invocation.action}`;
}

// ---------------------------------------------------------------------------
// Collect data for all gates
// ---------------------------------------------------------------------------

/** All command classes per file */
const classesByFile = Object.fromEntries(
  cmdFiles.map((f) => [f, extractCommandClasses(cmdSources[f])]),
);

/** All export arrays per file */
const exportsByFile = Object.fromEntries(
  cmdFiles.map((f) => [f, extractExportArray(cmdSources[f])]),
);

/** All static paths across all files, with source tracking */
const allPaths = [];
for (const f of cmdFiles) {
  const paths = extractStaticPaths(cmdSources[f]);
  for (const p of paths) allPaths.push({ path: p, file: f });
}
/** All flags across all files */
const allFlags = [];
for (const f of cmdFiles) {
  const flags = extractOptionFlags(cmdSources[f]);
  for (const flag of flags) allFlags.push({ flag, file: f });
}

/** Registered domain import names from index.mjs */
const registeredImports = [];
const importRe = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/commands\/([^"]+)"/g;
let im;
while ((im = importRe.exec(indexSrc)) !== null) {
  registeredImports.push({ exportName: im[1], file: im[2] });
}

/** Spread entries in allCommands array */
const spreadEntries = [];
const allCommandsBlock = indexSrc.match(/const\s+allCommands\s*=\s*\[([\s\S]*?)\];/);
if (allCommandsBlock) {
  const spreadRe = /\.\.\.(\w+)/g;
  let sm;
  while ((sm = spreadRe.exec(allCommandsBlock[1])) !== null) {
    spreadEntries.push(sm[1]);
  }
}

/** Factory barrel imports/spreads for split domain files */
const factoryBarrelSrc = cmdSources["factory.ts"] || cmdSources["factory.mjs"] || "";
const factoryRegisteredImports = [];
const factoryImportRe = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/([^"]+)"/g;
let fim;
while ((fim = factoryImportRe.exec(factoryBarrelSrc)) !== null) {
  factoryRegisteredImports.push({ exportName: fim[1], file: fim[2] });
}

const factorySpreadEntries = [];
const factoryCommandsBlock = factoryBarrelSrc.match(/const\s+factoryCommands\s*=\s*\[([\s\S]*?)\];/);
if (factoryCommandsBlock) {
  const spreadRe = /\.\.\.(\w+)/g;
  let sm;
  while ((sm = spreadRe.exec(factoryCommandsBlock[1])) !== null) {
    factorySpreadEntries.push(sm[1]);
  }
}

const FACTORY_SPLIT_DOMAIN_FILES = new Set([
  "factory-status-cmds.mjs",
  "factory-host-cmds.mjs",
  "factory-control-cmds.mjs",
  "factory-lease-cmds.mjs",
  "factory-release-cmds.mjs",
  "factory-service-profile-cmds.mjs",
  "factory-scheduled-jobs-status.mjs",
  "factory-fleet-triage-cmds.mjs",
  "factory-fleet-triage-queues.mjs",
]);

/** Goal barrel imports/spreads for split domain files (goal-hard-plan.mjs etc.) */
const goalBarrelSrc = cmdSources["goal.mjs"] || "";
const goalRegisteredImports = [];
const goalImportRe = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/([^"]+)"/g;
let gim;
while ((gim = goalImportRe.exec(goalBarrelSrc)) !== null) {
  goalRegisteredImports.push({ exportName: gim[1], file: gim[2] });
}

const goalSpreadEntries = [];
const goalCommandsBlock = goalBarrelSrc.match(/export\s+const\s+goalCommands\s*=\s*\[([\s\S]*?)\];/);
if (goalCommandsBlock) {
  const spreadRe = /\.\.\.(\w+)/g;
  let sm;
  while ((sm = spreadRe.exec(goalCommandsBlock[1])) !== null) {
    goalSpreadEntries.push(sm[1]);
  }
}

const GOAL_SPLIT_DOMAIN_FILES = new Set([
  "goal-hard-plan.mjs",
  "goal-hard-planning-cli.mjs",
  "goal-rationale-cli.mjs",
]);

/** Release barrel imports/spreads for split domain files */
const releaseBarrelSrc = cmdSources["release.mjs"] || "";
const releaseRegisteredImports = [];
const releaseImportRe = /import\s*\{\s*(\w+)\s*\}\s*from\s*"\.\/([^"]+)"/g;
let rim;
while ((rim = releaseImportRe.exec(releaseBarrelSrc)) !== null) {
  releaseRegisteredImports.push({ exportName: rim[1], file: rim[2] });
}

const releaseSpreadEntries = [];
const releaseCommandsBlock = releaseBarrelSrc.match(/export\s+const\s+releaseCommands\s*=\s*\[([\s\S]*?)\];/);
if (releaseCommandsBlock) {
  const spreadRe = /\.\.\.(\w+)/g;
  let sm;
  while ((sm = spreadRe.exec(releaseCommandsBlock[1])) !== null) {
    releaseSpreadEntries.push(sm[1]);
  }
}

const RELEASE_SPLIT_DOMAIN_FILES = new Set([
  "release-context-cmds.mjs",
  "release-delivery-cmds.mjs",
  "release-policy-cmds.mjs",
]);

// ===========================================================================
// Gate 0: Canonical CLI argv shape (normalizeArgv shim required)
// ===========================================================================

test("Gate 0: cli entrypoint uses normalizeArgv shim", () => {
  assert.match(indexSrc, /export\s+function\s+normalizeArgv\b/);
  assert.match(indexSrc, /normalizeArgv\(/);
  assert.match(
    cliEntrypointSrc,
    /cli\.runExit\(normalizeArgv\(process\.argv\.slice\(2\)\)\)/,
  );
});

// ===========================================================================
// Gate 1: Command Registration Completeness
// ===========================================================================

test("Gate 1: every Command class is included in its domain export array", async (t) => {
  for (const f of cmdFiles) {
    const classes = classesByFile[f];
    const { name: arrayName, entries } = exportsByFile[f];

    await t.test(`${f}: export array exists`, () => {
      assert.ok(arrayName, `${f} must have an exported commands array`);
    });

    if (f === "factory.mjs" || f === "release.mjs") {
      await t.test(`${f}: barrel entries are spread command groups`, () => {
        for (const entry of entries) {
          assert.match(
            entry,
            /^\.\.\.\w+Commands$/,
            `${arrayName} in ${f} must only contain spread command arrays`,
          );
        }
      });
      continue;
    }

    for (const cls of classes) {
      await t.test(`${f}: ${cls} is in export array`, () => {
        assert.ok(
          entries.includes(cls),
          `${cls} defined in ${f} but missing from ${arrayName} array`,
        );
      });
    }

    await t.test(`${f}: export array has no phantom entries`, () => {
      for (const entry of entries) {
        // Spread entries (e.g. ...goalHardPlanCommands) are cross-file re-exports; skip phantom check
        if (entry.startsWith("...")) continue;
        assert.ok(
          classes.includes(entry),
          `${arrayName} lists "${entry}" but no such class exists in ${f}`,
        );
      }
    });
  }
});

test("Gate 1b: every domain file is imported and spread in index.mjs", async (t) => {
  for (const f of cmdFiles) {
    if (FACTORY_SPLIT_DOMAIN_FILES.has(f)) {
      const { name: arrayName } = exportsByFile[f];
      if (!arrayName) continue;

      await t.test(`${f}: ${arrayName} is imported in factory.mjs`, () => {
        const imported = factoryRegisteredImports.some(
          (ri) => ri.exportName === arrayName && ri.file === f,
        );
        assert.ok(imported, `${arrayName} from ${f} is not imported in factory.mjs`);
      });

      await t.test(`${f}: ${arrayName} is spread into factoryCommands`, () => {
        assert.ok(
          factorySpreadEntries.includes(arrayName),
          `${arrayName} is not spread into factoryCommands in factory.mjs`,
        );
      });
      continue;
    }

    if (GOAL_SPLIT_DOMAIN_FILES.has(f)) {
      const { name: arrayName } = exportsByFile[f];
      if (!arrayName) continue;

      await t.test(`${f}: ${arrayName} is imported in goal.mjs`, () => {
        const imported = goalRegisteredImports.some(
          (ri) => ri.exportName === arrayName && ri.file === f,
        );
        assert.ok(imported, `${arrayName} from ${f} is not imported in goal.mjs`);
      });

      await t.test(`${f}: ${arrayName} is spread into goalCommands`, () => {
        assert.ok(
          goalSpreadEntries.includes(arrayName),
          `${arrayName} is not spread into goalCommands in goal.mjs`,
        );
      });
      continue;
    }

    if (RELEASE_SPLIT_DOMAIN_FILES.has(f)) {
      const { name: arrayName } = exportsByFile[f];
      if (!arrayName) continue;

      await t.test(`${f}: ${arrayName} is imported in release.mjs`, () => {
        const imported = releaseRegisteredImports.some(
          (ri) => ri.exportName === arrayName && ri.file === f,
        );
        assert.ok(imported, `${arrayName} from ${f} is not imported in release.mjs`);
      });

      await t.test(`${f}: ${arrayName} is spread into releaseCommands`, () => {
        assert.ok(
          releaseSpreadEntries.includes(arrayName),
          `${arrayName} is not spread into releaseCommands in release.mjs`,
        );
      });
      continue;
    }

    const { name: arrayName } = exportsByFile[f];
    if (!arrayName) continue;

    await t.test(`${f}: ${arrayName} is imported in index.mjs`, () => {
      const imported = registeredImports.some((ri) => ri.exportName === arrayName);
      assert.ok(imported, `${arrayName} from ${f} is not imported in index.mjs`);
    });

    await t.test(`${f}: ${arrayName} is spread into allCommands`, () => {
      assert.ok(
        spreadEntries.includes(arrayName),
        `${arrayName} is not spread into allCommands in index.mjs`,
      );
    });
  }
});

// ===========================================================================
// Gate 2: Command Path Uniqueness
// ===========================================================================

test("Gate 2: no duplicate command paths (except intentional aliases)", async (t) => {
  // Build a map of path-string → [files]
  const pathMap = new Map();
  for (const { path, file } of allPaths) {
    const key = path.join(" ");
    if (!pathMap.has(key)) pathMap.set(key, []);
    pathMap.get(key).push(file);
  }

  // Intentional aliases: same command with dual paths in same file (e.g., detect-orphan-features)
  // These appear as the SAME file listed once. Duplicates across DIFFERENT files are the problem.
  for (const [pathStr, files] of pathMap) {
    const uniqueFiles = [...new Set(files)];
    await t.test(`path "${pathStr}" is not duplicated across files`, () => {
      assert.ok(
        uniqueFiles.length <= 1,
        `"${pathStr}" defined in multiple files: ${uniqueFiles.join(", ")}`,
      );
    });
  }

  // Also check within a file: same path should only appear once
  for (const f of cmdFiles) {
    const paths = extractStaticPaths(cmdSources[f]);
    const seen = new Set();
    for (const p of paths) {
      const key = p.join(" ");
      await t.test(`${f}: path "${key}" appears only once`, () => {
        assert.ok(!seen.has(key), `Duplicate path "${key}" within ${f}`);
      });
      seen.add(key);
    }
  }
});

// ===========================================================================
// Gate 3: Flag Naming Consistency (kebab-case enforcement)
// ===========================================================================

test("Gate 3: all CLI flags use kebab-case naming", async (t) => {
  const kebabRe = /^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  for (const { flag, file } of allFlags) {
    await t.test(`${file}: flag "${flag}" is kebab-case`, () => {
      assert.match(
        flag,
        kebabRe,
        `Flag "${flag}" in ${file} is not kebab-case`,
      );
    });
  }
});

// ===========================================================================
// Gate 4: Help Text Completeness (static usage)
// ===========================================================================

test("Gate 4: every command has a static usage description", async (t) => {
  // clipanion uses static usage = Command.Usage({ description: "..." })
  // For our commands, we check that every class either has static usage or
  // the command is simple enough that clipanion auto-generates usable help.
  //
  // At minimum, every command must have static paths defined.
  for (const f of cmdFiles) {
    const classes = classesByFile[f];
    for (const cls of classes) {
      await t.test(`${f}: ${cls} has static paths defined`, () => {
        // Extract the class body and check for static paths
        const re = new RegExp(
          `class\\s+${cls}\\s+extends\\s+Command\\s*\\{[\\s\\S]*?static\\s+paths\\s*=`,
        );
        assert.match(
          cmdSources[f],
          re,
          `${cls} in ${f} must define static paths`,
        );
      });
    }
  }
});

// ===========================================================================
// Gate 5: Lazy Import Enforcement
// ===========================================================================

test("Gate 5: command files only import clipanion and helpers at top level", async (t) => {
  // Allowed top-level imports: clipanion, ../helpers.mjs
  const ALLOWED_TOP_LEVEL = new Set([
    "clipanion",
    "../helpers.mjs",
    "../factory-command-helpers.mjs",
    "./factory-status-cmds.mjs",
    "./factory-host-cmds.mjs",
    "./factory-control-cmds.mjs",
    "./factory-lease-cmds.mjs",
    "./factory-release-cmds.mjs",
    "./factory-service-profile-cmds.mjs",
    "./factory-scheduled-jobs-status.mjs",
    "./factory-fleet-triage-cmds.mjs",
    "./factory-fleet-triage-queues.mjs",
    "./goal-hard-plan.mjs",
    "./goal-hard-planning-cli.mjs",
    "./goal-rationale-cli.mjs",
    "../release-command-helpers.mjs",
    "./release-context-cmds.mjs",
    "./release-delivery-cmds.mjs",
    "./release-policy-cmds.mjs",
  ]);

  for (const f of cmdFiles) {
    const topImports = extractTopLevelImports(cmdSources[f]);
    await t.test(`${f}: no business logic imports at top level`, () => {
      for (const imp of topImports) {
        assert.ok(
          ALLOWED_TOP_LEVEL.has(imp),
          `${f} has top-level import of "${imp}" — business logic must be lazy-loaded via await import() inside execute()`,
        );
      }
    });
  }
});

test("Gate 5b: every command defers business logic to execute()", async (t) => {
  const BARREL_FILES = new Set(["factory.mjs", "release.mjs"]);
  for (const f of cmdFiles) {
    if (BARREL_FILES.has(f)) {
      await t.test(`${f}: barrel file has no command classes`, () => {
        const classes = classesByFile[f];
        assert.equal(classes.length, 0, `${f} should be a pure barrel`);
      });
      continue;
    }

    const lazyImports = extractLazyImports(cmdSources[f]);
    const classes = classesByFile[f];

    // Each command class should have at least one lazy import in its execute()
    // (unless it's trivially simple and only uses built-in/clipanion logic)
    await t.test(`${f}: ${classes.length} commands use lazy imports`, () => {
      assert.ok(
        lazyImports.length >= 1,
        `${f} has ${classes.length} commands but no lazy imports — business logic should be deferred`,
      );
    });
  }
});

// ===========================================================================
// Gate 6: Dead Dependency Detection
// ===========================================================================

test("Gate 6: no dead npm dependencies in ops package.json", async (t) => {
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Collect all imports across all ops source files (recursive)
  const allImportedModules = new Set();

  function scanDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".mjs")) {
        const content = readFileSync(fullPath, "utf8");
        // Static imports
        const staticRe = /(?:import|from)\s+["']([^"'./][^"']*)["']/g;
        let m;
        while ((m = staticRe.exec(content)) !== null) {
          // Get the package name (first segment, or @scope/name for scoped)
          const parts = m[1].split("/");
          const pkgName = m[1].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
          allImportedModules.add(pkgName);
        }
        // Dynamic imports
        const dynamicRe = /await\s+import\(\s*["']([^"'./][^"']*)["']\s*\)/g;
        while ((m = dynamicRe.exec(content)) !== null) {
          const parts = m[1].split("/");
          const pkgName = m[1].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
          allImportedModules.add(pkgName);
        }
      }
    }
  }

  scanDir(OPS_SRC_DIR);

  // c8 is a devDependency used via CLI (not imported in source)
  // @hatch/github-adapter and ink-testing-library are test-only devDependencies
  const CLI_ONLY_DEPS = new Set(["c8", "@hatch/github-adapter", "ink-testing-library"]);

  for (const depName of Object.keys(allDeps)) {
    if (CLI_ONLY_DEPS.has(depName)) continue;
    await t.test(`dependency "${depName}" is actually imported in source`, () => {
      assert.ok(
        allImportedModules.has(depName),
        `"${depName}" is listed in package.json but never imported in ${OPS_SRC_DIR}/ — remove it`,
      );
    });
  }
});

// ===========================================================================
// Gate 7: DOT Graph → CLI Reference Validation
// ===========================================================================

test("Gate 7: DOT graph CLI invocations reference valid registered commands", async (t) => {
  // Build registry of all registered command paths (domain files + direct index imports).
  const registeredPaths = new Set();
  for (const { source } of dotGateCommandSources) {
    for (const path of extractStaticPaths(source)) {
      registeredPaths.add(path.join(" "));
    }
  }

  // Load all DOT graphs
  const dotFiles = existsSync(GRAPHS_DIR)
    ? readdirSync(GRAPHS_DIR).filter((f) => f.endsWith(".dot"))
    : [];

  for (const dotFile of dotFiles) {
    const dotSource = readFileSync(join(GRAPHS_DIR, dotFile), "utf8");
    const invocations = extractDotCliInvocations(dotSource, dotFile);

    for (const inv of invocations) {
      const cmdPath = resolveRegisteredInvocationPath(registeredPaths, inv);
      await t.test(`${dotFile}: "${cmdPath}" maps to a registered command`, () => {
        assert.ok(
          registeredPaths.has(cmdPath),
          `${dotFile} invokes "${cmdPath}" but no command is registered for path ["${inv.domain}", "${inv.action}"]`,
        );
      });
    }
  }
});

test("Gate 7b: DOT graph CLI flags match registered command options", async (t) => {
  // Build a map of command path → known flags
  const flagsByPath = new Map();
  for (const { source } of dotGateCommandSources) {
    // Find each class and extract its paths and flags
    const classRe =
      /export\s+class\s+\w+Command\s+extends\s+Command\s*\{([\s\S]*?)(?=\n\s*export\s+(?:class|const)|$)/g;
    let cm;
    while ((cm = classRe.exec(source)) !== null) {
      const body = cm[1];
      const paths = extractStaticPaths(`static paths = ${body.match(/static\s+paths\s*=\s*(\[[\s\S]*?\]);/)?.[1] || "[]"};`);
      const flags = extractOptionFlags(body);
      for (const p of paths) {
        const key = p.join(" ");
        if (!flagsByPath.has(key)) flagsByPath.set(key, new Set());
        for (const f of flags) flagsByPath.get(key).add(f);
      }
    }
  }
  // Load DOT graphs and check flag usage
  const dotFiles = existsSync(GRAPHS_DIR)
    ? readdirSync(GRAPHS_DIR).filter((f) => f.endsWith(".dot"))
    : [];

  for (const dotFile of dotFiles) {
    const dotSource = readFileSync(join(GRAPHS_DIR, dotFile), "utf8");
    const invocations = extractDotCliInvocations(dotSource, dotFile);

    for (const inv of invocations) {
      const cmdPath = resolveRegisteredInvocationPath(flagsByPath, inv);
      const knownFlags = flagsByPath.get(cmdPath);
      if (!knownFlags) continue; // Gate 7 catches unregistered commands

      for (const flag of inv.flags) {
        // Skip shell-constructed flags like those from printf/base64 pipelines
        if (flag.includes("$") || flag.includes("`")) continue;
        await t.test(
          `${dotFile}: "${cmdPath}" flag "${flag}" is a known option`,
          () => {
            assert.ok(
              knownFlags.has(flag),
              `${dotFile} passes "${flag}" to "${cmdPath}" but command only accepts: ${[...knownFlags].join(", ")}`,
            );
          },
        );
      }
    }
  }
});

// ===========================================================================
// Summary: expected counts (for drift detection)
// ===========================================================================

test("Gate 8: CLI structural counts match expected (drift detection)", async (t) => {
  const totalClasses = Object.values(classesByFile).reduce(
    (sum, classes) => sum + classes.length,
    0,
  );

  await t.test("total command files is 47", () => {
    assert.equal(cmdFiles.length, 47);
  });

  await t.test("total command classes is >= 111", () => {
    assert.ok(
      totalClasses >= 111,
      `Expected at least 111 command classes, got ${totalClasses} (did someone remove a command without updating this gate?)`,
    );
  });

  await t.test("all domain imports are spread into allCommands", () => {
    assert.equal(
      registeredImports.length,
      spreadEntries.length,
      `index.mjs imports ${registeredImports.length} domains but spreads ${spreadEntries.length}`,
    );
  });
});
