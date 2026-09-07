#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function resolveNearestPackageRoot(startPath = "") {
  let current = dirname(String(startPath || ""));
  while (current && current !== dirname(current)) {
    if (existsSync(resolve(current, "package.json"))) {
      return current;
    }
    current = dirname(current);
  }
  return "";
}

function resolvePackageRootFromAnchor(anchorPath = "", packageName = "") {
  let current = dirname(String(anchorPath || ""));
  while (current && current !== dirname(current)) {
    const packageJsonPath = resolve(current, "node_modules", String(packageName || ""), "package.json");
    if (existsSync(packageJsonPath)) {
      return dirname(packageJsonPath);
    }
    current = dirname(current);
  }
  return "";
}

function resolvePackageRelativeImportPath({
  anchorPath = "",
  packageName = "",
  relativePath = "",
} = {}) {
  const packageRoot = resolvePackageRootFromAnchor(anchorPath, packageName);
  if (packageRoot) {
    return resolve(packageRoot, relativePath);
  }

  const requireFromAnchor = createRequire(anchorPath);
  const packageEntryPath = requireFromAnchor.resolve(String(packageName || ""));
  const resolvedRoot = resolveNearestPackageRoot(packageEntryPath);
  if (!resolvedRoot) {
    throw new Error(`package_root_not_found:${String(packageName || "")}`);
  }
  return resolve(resolvedRoot, relativePath);
}

export const RUNTIME_STARTUP_PROBE_MANIFEST = Object.freeze([
  Object.freeze({
    id: "hatch_dist_exports",
    kind: "module_import",
    path: "apps/hatch/dist/index.js",
  }),
  Object.freeze({
    id: "hatch_cli_help",
    kind: "cli_help",
    path: "apps/hatch/dist/cli.js",
    args: ["--help"],
  }),
  Object.freeze({
    id: "factory_ops_cli_help",
    kind: "cli_exec",
    path: "packages/factory-ops/src/cli.ts",
    args: ["common", "resolve-default", "--value", "ok", "--fallback", "nope"],
  }),
  Object.freeze({
    id: "pi_ai_azure_openai_provider",
    kind: "package_relative_import",
    package: "@mariozechner/pi-ai",
    relativePath: "dist/providers/azure-openai-responses.js",
    path: "@mariozechner/pi-ai/dist/providers/azure-openai-responses.js",
    from: "apps/hatch/package.json",
  }),
]);

export async function runRuntimeStartupProbe({ manifest = RUNTIME_STARTUP_PROBE_MANIFEST } = {}) {
  const results = [];

  for (const probe of manifest) {
    const absolutePath = typeof probe.path === "string" ? resolve(probe.path) : "";
    if (probe.kind !== "repo_worktree" && probe.kind !== "module_specifier" && probe.kind !== "package_relative_import" && !existsSync(absolutePath)) {
      results.push({
        id: probe.id,
        path: probe.path,
        ok: false,
        reason: "missing_path",
      });
      continue;
    }

    if (probe.kind === "module_import") {
      try {
        await import(pathToFileURL(absolutePath).href);
        results.push({ id: probe.id, path: probe.path, ok: true });
      } catch (error) {
        results.push({
          id: probe.id,
          path: probe.path,
          ok: false,
          reason: "import_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    if (probe.kind === "module_specifier") {
      const anchorPath = resolve(String(probe.from || "package.json"));
      if (!existsSync(anchorPath)) {
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: false,
          reason: "missing_path",
        });
        continue;
      }

      try {
        const requireFromAnchor = createRequire(anchorPath);
        const resolvedSpecifier = requireFromAnchor.resolve(String(probe.path || ""));
        await import(pathToFileURL(resolvedSpecifier).href);
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: true,
        });
      } catch (error) {
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: false,
          reason: "specifier_import_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    if (probe.kind === "package_relative_import") {
      const anchorPath = resolve(String(probe.from || "package.json"));
      if (!existsSync(anchorPath)) {
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: false,
          reason: "missing_path",
        });
        continue;
      }

      try {
        const resolvedSpecifier = resolvePackageRelativeImportPath({
          anchorPath,
          packageName: String(probe.package || ""),
          relativePath: String(probe.relativePath || ""),
        });
        if (!existsSync(resolvedSpecifier)) {
          results.push({
            id: probe.id,
            path: probe.path,
            from: probe.from,
            ok: false,
            reason: "missing_path",
          });
          continue;
        }
        await import(pathToFileURL(resolvedSpecifier).href);
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: true,
        });
      } catch (error) {
        results.push({
          id: probe.id,
          path: probe.path,
          from: probe.from,
          ok: false,
          reason: "specifier_import_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    if (probe.kind === "cli_help" || probe.kind === "cli_exec") {
      const run = spawnSync(process.execPath, [absolutePath, ...(probe.args || [])], {
        encoding: "utf8",
        env: probe.env ? { ...process.env, ...probe.env } : process.env,
      });
      results.push({
        id: probe.id,
        path: probe.path,
        ok: run.status === 0,
        reason: run.status === 0 ? "" : "cli_failed",
        detail: run.status === 0 ? "" : ((run.stderr || run.stdout).trim() || `exit=${run.status}`),
      });
      continue;
    }

    if (probe.kind === "repo_worktree") {
      const repoPath = resolve(String(probe.path || ""));
      if (!existsSync(repoPath)) {
        results.push({
          id: probe.id,
          path: probe.path,
          ok: false,
          reason: "repo_path_missing",
        });
        continue;
      }

      const run = spawnSync("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      });
      results.push({
        id: probe.id,
        path: probe.path,
        ok: run.status === 0,
        reason: run.status === 0 ? "" : "repo_not_git_worktree",
        detail: run.status === 0 ? "" : ((run.stderr || run.stdout).trim() || `exit=${run.status}`),
      });
      continue;
    }

    results.push({
      id: probe.id,
      path: probe.path,
      ok: false,
      reason: "unknown_probe_kind",
    });
  }

  return {
    result: results.every((probe) => probe.ok) ? "ok" : "fail",
    probes: results,
  };
}

async function main() {
  const json = process.argv.includes("--json");
  const result = await runRuntimeStartupProbe();

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(`[runtime-startup-probe] result=${result.result} probes=${result.probes.length}`);
    for (const probe of result.probes) {
      if (!probe.ok) {
        console.error(`[runtime-startup-probe] failure id=${probe.id} path=${probe.path} reason=${probe.reason}${probe.detail ? ` detail=${JSON.stringify(probe.detail)}` : ""}`);
      }
    }
  }

  if (result.result !== "ok") {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]?.endsWith("check-runtime-startup-probe.ts") || process.argv[1]?.endsWith("check-runtime-startup-probe.mjs") === true;

if (isDirectRun) {
  await main();
}
