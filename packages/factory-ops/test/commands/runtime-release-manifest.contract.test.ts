import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateRuntimeExternalEntrypointsContract,
} from "../../../../scripts/check-runtime-external-entrypoints-contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");

test("runtime-release-manifest: external entrypoints contract passes for checked-in manifest", () => {
  const result = validateRuntimeExternalEntrypointsContract({
    repoRoot,
    manifestPath: "docs/contracts/runtime-release-manifest.json",
  });

  assert.equal(result.ok, true, result.diagnostics.join("\n"));
  assert.match(result.telemetry, /^\[runtime-external-entrypoints-contract\] result=ok packages=\d+ stable_entrypoints=\d+$/);
});

test("runtime-release-manifest: fails when package ownership drifts", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runtime-release-manifest-ownership-"));
  try {
    const manifestPath = join(tempRoot, "runtime-release-manifest.json");
    const brokenManifest = {
      schema_version: "runtime-release-manifest/v1",
      description: "test",
      hatch: "0.1.0",
      "@hatch/factory-ops": "0.1.0",
      "@recallnet/factory-telemetry": "1.0.0",
      supported_node: ">=20",
      supported_entrypoints: {
        cli: ["hatch run <file.dot>"],
        js_api: [],
      },
      externalSurface: {
        packages: [
          {
            name: "hatch",
            version: "0.1.0",
            ownership: "optional",
            packageRepo: "apps/hatch",
            binEntrypoints: [
              {
                name: "hatch",
                packageBinPath: "dist/cli.js",
                sourcePath: "src/cli.ts",
              },
            ],
          },
        ],
        stableEntryPoints: {
          "hatch run <file.dot>": {
            packageName: "hatch",
            binEntrypoint: "hatch",
            smokeCheck: "hatch run --help",
            persona: "external-adopter",
          },
        },
      },
    };

    writeFileSync(manifestPath, `${JSON.stringify(brokenManifest, null, 2)}\n`, "utf8");

    const result = validateRuntimeExternalEntrypointsContract({
      repoRoot,
      manifestPath: relative(repoRoot, manifestPath),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.diagnostics.some((line) =>
        line.includes("field=externalSurface.packages[0].ownership")
        && line.includes("expected required")),
      true,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runtime-release-manifest: fails when stable entrypoint map drifts from supported_entrypoints.cli", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "runtime-release-manifest-stable-entrypoints-"));
  try {
    const manifestPath = join(tempRoot, "runtime-release-manifest.json");
    const brokenManifest = {
      schema_version: "runtime-release-manifest/v1",
      description: "test",
      hatch: "0.1.0",
      supported_node: ">=20",
      supported_entrypoints: {
        cli: ["hatch validate <file.dot>"],
        js_api: [],
      },
      externalSurface: {
        packages: [
          {
            name: "hatch",
            version: "0.1.0",
            ownership: "required",
            packageRepo: "apps/hatch",
            binEntrypoints: [
              {
                name: "hatch",
                packageBinPath: "dist/cli.js",
                sourcePath: "src/cli.ts",
              },
            ],
          },
        ],
        stableEntryPoints: {
          "hatch run <file.dot>": {
            packageName: "hatch",
            binEntrypoint: "hatch",
            smokeCheck: "hatch run --help",
            persona: "external-adopter",
          },
        },
      },
    };

    writeFileSync(manifestPath, `${JSON.stringify(brokenManifest, null, 2)}\n`, "utf8");

    const result = validateRuntimeExternalEntrypointsContract({
      repoRoot,
      manifestPath: relative(repoRoot, manifestPath),
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.diagnostics.some((line) =>
        line.includes("stable entrypoint command 'hatch run <file.dot>' missing from supported_entrypoints.cli")),
      true,
    );
    assert.equal(
      result.diagnostics.some((line) =>
        line.includes("supported CLI entrypoint 'hatch validate <file.dot>' missing from externalSurface.stableEntryPoints")),
      true,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
