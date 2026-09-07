/**
 * Gate: handler hot-path hygiene
 *
 * Asserts that handler-layer files in apps/hatch/src/pipeline/handler/
 * do not import from langfuse or use console.log, and that no non-test
 * pipeline files import redis-telemetry or redis-lifecycle-projection.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const HANDLER_DIR = "apps/hatch/src/pipeline/handler/";
const PIPELINE_DIR = "apps/hatch/src/pipeline/";

const HANDLER_FILES = [
  "apps/hatch/src/pipeline/handler/manager.ts",
  "apps/hatch/src/pipeline/handler/codergen.ts",
];

const BANNED_HANDLER_SYMBOLS = [
  "bindLangfuseSessionTelemetry",
  "computeLangfusePromptHash",
  "emitLangfuseGenerationEvent",
  "nextLangfuseAttemptIndex",
  "recordLangfuseSessionContext",
];

const BANNED_HANDLER_CALLS = [
  /\bconsole\.log\b/,
];

const BANNED_PIPELINE_IMPORT_MODULES = [
  "redis-telemetry",
  "redis-lifecycle-projection",
];

function listTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("git ls-files failed");
  return result.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function main() {
  const diagnostics = [];

  // Check handler files for langfuse imports and console.log
  for (const file of HANDLER_FILES) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      for (const symbol of BANNED_HANDLER_SYMBOLS) {
        if (line.includes(symbol)) {
          diagnostics.push(`handler_banned_langfuse_symbol file="${file}" line=${i + 1} symbol="${symbol}"`);
        }
      }

      for (const pattern of BANNED_HANDLER_CALLS) {
        if (pattern.test(line)) {
          diagnostics.push(`handler_banned_call file="${file}" line=${i + 1} pattern="${pattern}" content="${line.trim()}"`);
        }
      }
    }
  }

  // Check non-test pipeline files for redis imports
  const allFiles = listTrackedFiles();
  const pipelineFiles = allFiles.filter(
    (f) => f.startsWith(PIPELINE_DIR) && f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".spec."),
  );

  for (const file of pipelineFiles) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const mod of BANNED_PIPELINE_IMPORT_MODULES) {
      if (source.includes(mod)) {
        diagnostics.push(`pipeline_banned_redis_import file="${file}" module="${mod}"`);
      }
    }
  }

  // Check that reactor-collector-contract covers handler files
  const reactorContractLib = "scripts/lib/reactor-collector-contract.ts";
  if (existsSync(reactorContractLib)) {
    const contractSource = readFileSync(reactorContractLib, "utf8");
    for (const handlerFile of HANDLER_FILES) {
      if (!contractSource.includes(handlerFile)) {
        diagnostics.push(`reactor_contract_missing_handler_coverage file="${handlerFile}"`);
      }
    }
  }

  process.stdout.write(`[handler-hot-path-hygiene] result=${diagnostics.length === 0 ? "ok" : "fail"} diagnostics=${diagnostics.length}\n`);
  if (diagnostics.length > 0) {
    process.stderr.write(`${diagnostics.join("\n")}\n`);
    process.exitCode = 1;
  }
}

main();
