import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { runRuntimeStartupProbe } from "./check-runtime-startup-probe.ts";

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

test("runRuntimeStartupProbe passes for importable modules and executable cli entrypoints", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-startup-probe-"));
  const modulePath = write(root, "dist/index.js", "export const ok = true;\n");
  const cliPath = write(root, "dist/cli.js", "#!/usr/bin/env node\nprocess.exit(0)\n");

  const result = await runRuntimeStartupProbe({
    manifest: [
      { id: "module", kind: "module_import", path: modulePath },
      { id: "cli", kind: "cli_help", path: cliPath, args: ["--help"] },
    ],
  });

  assert.equal(result.result, "ok");
  assert.ok(result.probes.every((probe) => probe.ok));
});

test("runRuntimeStartupProbe reports missing paths deterministically", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-startup-probe-missing-"));
  const missingPath = join(root, "dist", "missing.js");

  const result = await runRuntimeStartupProbe({
    manifest: [
      { id: "missing", kind: "module_import", path: missingPath },
    ],
  });

  assert.equal(result.result, "fail");
  assert.deepEqual(result.probes, [
    {
      id: "missing",
      path: missingPath,
      ok: false,
      reason: "missing_path",
    },
  ]);
});

test("runRuntimeStartupProbe reports missing repo paths deterministically", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-startup-probe-missing-repo-"));
  const missingRepo = join(root, "destroyed-checkout");

  const result = await runRuntimeStartupProbe({
    manifest: [
      { id: "repo", kind: "repo_worktree", path: missingRepo },
    ],
  });

  assert.equal(result.result, "fail");
  assert.deepEqual(result.probes, [
    {
      id: "repo",
      path: missingRepo,
      ok: false,
      reason: "repo_path_missing",
    },
  ]);
});

test("runRuntimeStartupProbe imports package specifiers from a package anchor", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-startup-probe-specifier-"));
  write(root, "apps/hatch/package.json", "{\"name\":\"fixture-hatch\"}\n");
  write(
    root,
    "node_modules/pi-ai-provider/index.js",
    "import './transitive.js';\nexport const ok = true;\n",
  );
  write(root, "node_modules/pi-ai-provider/package.json", "{\"name\":\"pi-ai-provider\",\"type\":\"module\",\"exports\":\"./index.js\"}\n");
  write(root, "node_modules/pi-ai-provider/transitive.js", "export const transitive = true;\n");

  const result = await runRuntimeStartupProbe({
    manifest: [
      {
        id: "provider",
        kind: "module_specifier",
        path: "pi-ai-provider",
        from: join(root, "apps/hatch/package.json"),
      },
    ],
  });

  assert.equal(result.result, "ok");
  assert.deepEqual(result.probes, [
    {
      from: join(root, "apps/hatch/package.json"),
      id: "provider",
      ok: true,
      path: "pi-ai-provider",
    },
  ]);
});

test("runRuntimeStartupProbe imports package-relative modules from a package anchor", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-startup-probe-package-relative-"));
  write(root, "apps/hatch/package.json", "{\"name\":\"fixture-hatch\"}\n");
  write(root, "node_modules/pi-ai-provider/package.json", "{\"name\":\"pi-ai-provider\",\"type\":\"module\",\"exports\":\"./index.js\"}\n");
  write(root, "node_modules/pi-ai-provider/index.js", "export const entry = true;\n");
  write(
    root,
    "node_modules/pi-ai-provider/dist/providers/azure-openai-responses.js",
    "import '../transitive.js';\nexport const ok = true;\n",
  );
  write(root, "node_modules/pi-ai-provider/dist/transitive.js", "export const transitive = true;\n");

  const result = await runRuntimeStartupProbe({
    manifest: [
      {
        id: "provider-private-subpath",
        kind: "package_relative_import",
        package: "pi-ai-provider",
        relativePath: "dist/providers/azure-openai-responses.js",
        path: "pi-ai-provider/dist/providers/azure-openai-responses.js",
        from: join(root, "apps/hatch/package.json"),
      },
    ],
  });

  assert.equal(result.result, "ok");
  assert.deepEqual(result.probes, [
    {
      from: join(root, "apps/hatch/package.json"),
      id: "provider-private-subpath",
      ok: true,
      path: "pi-ai-provider/dist/providers/azure-openai-responses.js",
    },
  ]);
});
