import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureRuntimeDirs, runPostinstallBootstrap } from "./postinstall-bootstrap.mjs";

function makeTempRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "astro-postinstall-"));
  mkdirSync(path.join(repoRoot, "scripts", "bin"), { recursive: true });
  mkdirSync(path.join(repoRoot, "apps", "hatch"), { recursive: true });
  writeFileSync(path.join(repoRoot, "scripts", "bin", "hatch"), "#!/bin/sh\nexit 0\n", "utf8");
  writeFileSync(path.join(repoRoot, "scripts", "bin", "hatch-ops"), "#!/bin/sh\nexit 0\n", "utf8");
  return repoRoot;
}

test("ensureRuntimeDirs creates gitignored runtime directories needed by fresh worktrees", () => {
  const repoRoot = makeTempRepo();

  ensureRuntimeDirs(repoRoot);

  assert.equal(existsSync(path.join(repoRoot, "apps", "hatch", "coverage", ".tmp")), true);
});

test("runPostinstallBootstrap creates workspace bin links and runtime directories together", () => {
  const repoRoot = makeTempRepo();

  runPostinstallBootstrap(repoRoot);

  const hatchLink = path.join(repoRoot, "node_modules", ".bin", "hatch");
  const hatchOpsLink = path.join(repoRoot, "node_modules", ".bin", "hatch-ops");

  assert.equal(existsSync(hatchLink), true);
  assert.equal(existsSync(hatchOpsLink), true);
  assert.equal(existsSync(path.join(repoRoot, "apps", "hatch", "coverage", ".tmp")), true);
  assert.equal(readlinkSync(hatchLink), path.join("..", "..", "scripts", "bin", "hatch"));
  assert.equal(readlinkSync(hatchOpsLink), path.join("..", "..", "scripts", "bin", "hatch-ops"));
});

test("runPostinstallBootstrap replaces pre-existing regular bin files with canonical workspace links", () => {
  const repoRoot = makeTempRepo();
  const binDir = path.join(repoRoot, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "hatch"), "stale-wrapper\n", "utf8");
  writeFileSync(path.join(binDir, "hatch-ops"), "stale-wrapper\n", "utf8");

  runPostinstallBootstrap(repoRoot);

  assert.equal(readlinkSync(path.join(binDir, "hatch")), path.join("..", "..", "scripts", "bin", "hatch"));
  assert.equal(readlinkSync(path.join(binDir, "hatch-ops")), path.join("..", "..", "scripts", "bin", "hatch-ops"));
});

test("declared workspace package bins preserve the canonical root launcher across bootstraps", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ dependencies: { hatch: "workspace:*" } }));
  writeFileSync(path.join(repoRoot, "apps", "hatch", "package.json"), JSON.stringify({ name: "hatch", bin: { hatch: "dist/cli.js" } }));
  mkdirSync(path.join(repoRoot, "apps", "hatch", "dist"), { recursive: true });
  writeFileSync(path.join(repoRoot, "apps", "hatch", "dist", "cli.js"), "#!/usr/bin/env node\n");
  mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  symlinkSync("../apps/hatch", path.join(repoRoot, "node_modules", "hatch"));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    runPostinstallBootstrap(repoRoot);
    assert.equal(readlinkSync(path.join(repoRoot, "node_modules", ".bin", "hatch")), path.join("..", "..", "scripts", "bin", "hatch"));
  }
});

test("runPostinstallBootstrap creates root workspace links for shared hatch packages used by scripts", () => {
  const repoRoot = makeTempRepo();
  mkdirSync(path.join(repoRoot, "packages", "eslint-config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "packages", "factory-core"), { recursive: true });
  mkdirSync(path.join(repoRoot, "packages", "tsconfig"), { recursive: true });

  runPostinstallBootstrap(repoRoot);

  const eslintConfigLink = path.join(repoRoot, "node_modules", "@hatch", "eslint-config");
  const factoryCoreLink = path.join(repoRoot, "node_modules", "@hatch", "factory-core");
  const tsconfigLink = path.join(repoRoot, "node_modules", "@hatch", "tsconfig");

  assert.equal(existsSync(eslintConfigLink), true);
  assert.equal(existsSync(factoryCoreLink), true);
  assert.equal(existsSync(tsconfigLink), true);
  assert.equal(readlinkSync(eslintConfigLink), path.join("..", "..", "packages", "eslint-config"));
  assert.equal(readlinkSync(factoryCoreLink), path.join("..", "..", "packages", "factory-core"));
  assert.equal(readlinkSync(tsconfigLink), path.join("..", "..", "packages", "tsconfig"));
});

test("runPostinstallBootstrap restores required root and runtime dependency links from the pnpm store", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(
    path.join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "astrochicken", devDependencies: { acorn: "^8.14.0", "@recallnet/codecontext-eslint-plugin": "^0.2.2", "@recallnet/docs-governance-preset": "^0.2.8", "@typescript-eslint/parser": "^8.26.1", eslint: "^9.22.0", "eslint-plugin-boundaries": "^5.0.1", "eslint-plugin-import-x": "^4.16.1", globals: "^16.0.0", "@resvg/resvg-wasm": "2.6.2", typescript: "^5.7.3", "@viz-js/viz": "^3.25.0", zod: "^4.3.6" } }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "packages", "factory-core"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "packages", "factory-core", "package.json"),
    `${JSON.stringify({ name: "@hatch/factory-core", dependencies: { zod: "^4.3.6" } }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+codecontext-eslint-plugin@0.2.2", "node_modules", "@recallnet", "codecontext-eslint-plugin"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@typescript-eslint+parser@8.26.1", "node_modules", "@typescript-eslint", "parser"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "acorn@8.14.0", "node_modules", "acorn"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "eslint@9.22.0", "node_modules", "eslint"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "eslint-plugin-boundaries@5.0.1", "node_modules", "eslint-plugin-boundaries"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "eslint-plugin-import-x@4.16.1", "node_modules", "eslint-plugin-import-x"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "globals@16.0.0", "node_modules", "globals"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@resvg+resvg-wasm@2.6.2", "node_modules", "@resvg", "resvg-wasm"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.7.3", "node_modules", "typescript"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@viz-js+viz@3.25.0", "node_modules", "@viz-js", "viz"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "ajv@8.18.0", "node_modules", "ajv"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "zod@4.3.6", "node_modules", "zod"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "package.json"),
    `${JSON.stringify({
      name: "@recallnet/docs-governance-preset",
      bin: {
        "recall-docs-governance": "./src/cli.js",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "src", "cli.js"),
    "#!/usr/bin/env node\n",
    "utf8",
  );

  runPostinstallBootstrap(repoRoot);

  const rootCodecontextPluginLink = path.join(repoRoot, "node_modules", "@recallnet", "codecontext-eslint-plugin");
  const rootDocsGovernancePresetLink = path.join(repoRoot, "node_modules", "@recallnet", "docs-governance-preset");
  const rootTsParserLink = path.join(repoRoot, "node_modules", "@typescript-eslint", "parser");
  const rootAcornLink = path.join(repoRoot, "node_modules", "acorn");
  const rootEslintLink = path.join(repoRoot, "node_modules", "eslint");
  const rootBoundariesLink = path.join(repoRoot, "node_modules", "eslint-plugin-boundaries");
  const rootImportXLink = path.join(repoRoot, "node_modules", "eslint-plugin-import-x");
  const rootGlobalsLink = path.join(repoRoot, "node_modules", "globals");
  const rootResvgLink = path.join(repoRoot, "node_modules", "@resvg", "resvg-wasm");
  const rootTypescriptLink = path.join(repoRoot, "node_modules", "typescript");
  const rootVizLink = path.join(repoRoot, "node_modules", "@viz-js", "viz");
  const rootAjvLink = path.join(repoRoot, "node_modules", "ajv");
  const rootZodLink = path.join(repoRoot, "node_modules", "zod");
  const rootDocsGovernanceBinLink = path.join(repoRoot, "node_modules", ".bin", "recall-docs-governance");
  const packageZodLink = path.join(repoRoot, "packages", "factory-core", "node_modules", "zod");

  assert.equal(existsSync(rootCodecontextPluginLink), true);
  assert.equal(existsSync(rootDocsGovernancePresetLink), true);
  assert.equal(existsSync(rootTsParserLink), true);
  assert.equal(existsSync(rootAcornLink), true);
  assert.equal(existsSync(rootEslintLink), true);
  assert.equal(existsSync(rootBoundariesLink), true);
  assert.equal(existsSync(rootImportXLink), true);
  assert.equal(existsSync(rootGlobalsLink), true);
  assert.equal(existsSync(rootResvgLink), true);
  assert.equal(existsSync(rootTypescriptLink), true);
  assert.equal(existsSync(rootVizLink), true);
  assert.equal(existsSync(rootAjvLink), true);
  assert.equal(existsSync(rootZodLink), true);
  assert.equal(existsSync(rootDocsGovernanceBinLink), true);
  assert.equal(existsSync(packageZodLink), true);
  assert.equal(readlinkSync(rootCodecontextPluginLink), path.join("..", ".pnpm", "@recallnet+codecontext-eslint-plugin@0.2.2", "node_modules", "@recallnet", "codecontext-eslint-plugin"));
  assert.equal(readlinkSync(rootDocsGovernancePresetLink), path.join("..", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset"));
  assert.equal(readlinkSync(rootTsParserLink), path.join("..", ".pnpm", "@typescript-eslint+parser@8.26.1", "node_modules", "@typescript-eslint", "parser"));
  assert.equal(readlinkSync(rootAcornLink), path.join(".pnpm", "acorn@8.14.0", "node_modules", "acorn"));
  assert.equal(readlinkSync(rootEslintLink), path.join(".pnpm", "eslint@9.22.0", "node_modules", "eslint"));
  assert.equal(readlinkSync(rootBoundariesLink), path.join(".pnpm", "eslint-plugin-boundaries@5.0.1", "node_modules", "eslint-plugin-boundaries"));
  assert.equal(readlinkSync(rootImportXLink), path.join(".pnpm", "eslint-plugin-import-x@4.16.1", "node_modules", "eslint-plugin-import-x"));
  assert.equal(readlinkSync(rootGlobalsLink), path.join(".pnpm", "globals@16.0.0", "node_modules", "globals"));
  assert.equal(readlinkSync(rootResvgLink), path.join("..", ".pnpm", "@resvg+resvg-wasm@2.6.2", "node_modules", "@resvg", "resvg-wasm"));
  assert.equal(readlinkSync(rootTypescriptLink), path.join(".pnpm", "typescript@5.7.3", "node_modules", "typescript"));
  assert.equal(readlinkSync(rootVizLink), path.join("..", ".pnpm", "@viz-js+viz@3.25.0", "node_modules", "@viz-js", "viz"));
  assert.equal(readlinkSync(rootAjvLink), path.join(".pnpm", "ajv@8.18.0", "node_modules", "ajv"));
  assert.equal(readlinkSync(rootZodLink), path.join(".pnpm", "zod@4.3.6", "node_modules", "zod"));
  assert.equal(
    readlinkSync(rootDocsGovernanceBinLink),
    path.join("..", "@recallnet", "docs-governance-preset", "src", "cli.js"),
  );
  assert.equal(readlinkSync(packageZodLink), path.join("..", "..", "..", "node_modules", ".pnpm", "zod@4.3.6", "node_modules", "zod"));
});

test("runPostinstallBootstrap prefers the declared dependency version when multiple pnpm zod entries exist", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(
    path.join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "astrochicken", devDependencies: { zod: "^4.3.6" } }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "packages", "factory-core"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "packages", "factory-core", "package.json"),
    `${JSON.stringify({ name: "@hatch/factory-core", dependencies: { zod: "^4.3.6" } }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "zod@3.25.0", "node_modules", "zod"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "zod@4.3.6", "node_modules", "zod"), { recursive: true });

  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "node_modules", "zod")),
    path.join(".pnpm", "zod@4.3.6", "node_modules", "zod"),
  );
});

test("runPostinstallBootstrap is idempotent when recall-docs-governance bin already exists", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(
    path.join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "astrochicken", devDependencies: { "@recallnet/docs-governance-preset": "^0.2.8" } }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "package.json"),
    `${JSON.stringify({
      name: "@recallnet/docs-governance-preset",
      bin: {
        "recall-docs-governance": "./src/cli.js",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset", "src", "cli.js"),
    "#!/usr/bin/env node\n",
    "utf8",
  );

  runPostinstallBootstrap(repoRoot);
  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "node_modules", ".bin", "recall-docs-governance")),
    path.join("..", "@recallnet", "docs-governance-preset", "src", "cli.js"),
  );
});

test("runPostinstallBootstrap preserves an equivalent pre-existing recall-docs-governance symlink", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(
    path.join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "astrochicken", devDependencies: { "@recallnet/docs-governance-preset": "^0.2.8" } }, null, 2)}\n`,
    "utf8",
  );
  const presetDir = path.join(repoRoot, "node_modules", ".pnpm", "@recallnet+docs-governance-preset@0.2.8", "node_modules", "@recallnet", "docs-governance-preset");
  mkdirSync(path.join(presetDir, "src"), { recursive: true });
  writeFileSync(
    path.join(presetDir, "package.json"),
    `${JSON.stringify({
      name: "@recallnet/docs-governance-preset",
      bin: {
        "recall-docs-governance": "./src/cli.js",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(presetDir, "src", "cli.js"), "#!/usr/bin/env node\n", "utf8");

  runPostinstallBootstrap(repoRoot);

  const binDir = path.join(repoRoot, "node_modules", ".bin");
  const binPath = path.join(binDir, "recall-docs-governance");
  const absoluteTarget = path.join(repoRoot, "node_modules", "@recallnet", "docs-governance-preset", "src", "cli.js");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(repoRoot, "scratch.txt"), "scratch\n", "utf8");
  symlinkSync(absoluteTarget, path.join(repoRoot, "scratch-link"));
  unlinkSync(binPath);
  symlinkSync(absoluteTarget, binPath);

  runPostinstallBootstrap(repoRoot);

  assert.equal(existsSync(binPath), true);
  assert.equal(readlinkSync(binPath), absoluteTarget);
});

test("runPostinstallBootstrap restores factory telemetry runtime dependency links from the declared pnpm versions", () => {
  const repoRoot = makeTempRepo();
  mkdirSync(path.join(repoRoot, "packages", "factory-telemetry"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "packages", "factory-telemetry", "package.json"),
    `${JSON.stringify({
      name: "@recallnet/factory-telemetry",
      dependencies: {
        "@opentelemetry/api-logs": "^0.206.0",
        "@opentelemetry/exporter-logs-otlp-http": "^0.206.0",
        "@opentelemetry/sdk-logs": "^0.206.0",
        langfuse: "^3.38.6",
      },
      devDependencies: {
        "@types/node": "^22.0.0",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(
    path.join(
      repoRoot,
      "node_modules",
      ".pnpm",
      "@opentelemetry+api-logs@0.206.0",
      "node_modules",
      "@opentelemetry",
      "api-logs",
    ),
    { recursive: true },
  );
  mkdirSync(
    path.join(
      repoRoot,
      "node_modules",
      ".pnpm",
      "@opentelemetry+exporter-logs-otlp-http@0.206.0",
      "node_modules",
      "@opentelemetry",
      "exporter-logs-otlp-http",
    ),
    { recursive: true },
  );
  mkdirSync(
    path.join(
      repoRoot,
      "node_modules",
      ".pnpm",
      "@opentelemetry+sdk-logs@0.206.0",
      "node_modules",
      "@opentelemetry",
      "sdk-logs",
    ),
    { recursive: true },
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "langfuse@3.38.6", "node_modules", "langfuse"), { recursive: true });
  mkdirSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@types+node@22.0.0", "node_modules", "@types", "node"),
    { recursive: true },
  );

  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-telemetry", "node_modules", "@opentelemetry", "sdk-logs")),
    path.join("..", "..", "..", "..", "node_modules", ".pnpm", "@opentelemetry+sdk-logs@0.206.0", "node_modules", "@opentelemetry", "sdk-logs"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-telemetry", "node_modules", "langfuse")),
    path.join("..", "..", "..", "node_modules", ".pnpm", "langfuse@3.38.6", "node_modules", "langfuse"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-telemetry", "node_modules", "@types", "node")),
    path.join("..", "..", "..", "..", "node_modules", ".pnpm", "@types+node@22.0.0", "node_modules", "@types", "node"),
  );
});

test("runPostinstallBootstrap restores factory ops and github adapter package-local deps for plain node runtime", () => {
  const repoRoot = makeTempRepo();
  mkdirSync(path.join(repoRoot, "packages", "factory-core"), { recursive: true });
  mkdirSync(path.join(repoRoot, "packages", "github-adapter"), { recursive: true });
  mkdirSync(path.join(repoRoot, "packages", "factory-ops"), { recursive: true });
  mkdirSync(path.join(repoRoot, "packages", "factory-telemetry"), { recursive: true });
  writeFileSync(path.join(repoRoot, "packages", "factory-core", "package.json"), `${JSON.stringify({ name: "@hatch/factory-core", dependencies: { zod: "^4.3.6" } }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(repoRoot, "packages", "github-adapter", "package.json"), `${JSON.stringify({ name: "@hatch/github-adapter", dependencies: { "@hatch/factory-core": "workspace:*", zod: "^4.3.6" } }, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(repoRoot, "packages", "factory-ops", "package.json"),
    `${JSON.stringify({
      name: "@hatch/factory-ops",
      dependencies: {
        "@hatch/github-adapter": "workspace:*",
        "@recallnet/factory-telemetry": "workspace:*",
        clipanion: "^4.0.0-rc.4",
        hatch: "workspace:*",
        pg: "^8.16.3",
      },
      devDependencies: {
        "@hatch/factory-core": "workspace:*",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(repoRoot, "packages", "factory-telemetry", "package.json"), `${JSON.stringify({ name: "@recallnet/factory-telemetry", dependencies: {} }, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(repoRoot, "apps", "hatch", "package.json"),
    `${JSON.stringify({
      name: "hatch",
      dependencies: {
        "@hatch/factory-core": "workspace:*",
        "@recallnet/factory-telemetry": "workspace:*",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "clipanion@4.0.0-rc.4", "node_modules", "clipanion"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "pg@8.16.3", "node_modules", "pg"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "zod@4.3.6", "node_modules", "zod"), { recursive: true });

  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-ops", "node_modules", "clipanion")),
    path.join("..", "..", "..", "node_modules", ".pnpm", "clipanion@4.0.0-rc.4", "node_modules", "clipanion"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-ops", "node_modules", "pg")),
    path.join("..", "..", "..", "node_modules", ".pnpm", "pg@8.16.3", "node_modules", "pg"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-ops", "node_modules", "hatch")),
    path.join("..", "..", "..", "apps", "hatch"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "factory-ops", "node_modules", "@hatch", "github-adapter")),
    path.join("..", "..", "..", "github-adapter"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "github-adapter", "node_modules", "@hatch", "factory-core")),
    path.join("..", "..", "..", "factory-core"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "apps", "hatch", "node_modules", "@recallnet", "factory-telemetry")),
    path.join("..", "..", "..", "..", "packages", "factory-telemetry"),
  );
});

test("runPostinstallBootstrap restores capability foreman package-local deps needed by hook-local builds", () => {
  const repoRoot = makeTempRepo();
  mkdirSync(path.join(repoRoot, "packages", "capability-foreman"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "packages", "capability-foreman", "package.json"),
    `${JSON.stringify({
      name: "@hatch/capability-foreman",
      dependencies: {
        "@mariozechner/pi-coding-agent": "^0.56.2",
      },
      devDependencies: {
        "@hatch/tsconfig": "workspace:*",
        "@types/node": "^22.0.0",
        typescript: "^5.7.3",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "packages", "tsconfig"), { recursive: true });
  writeFileSync(path.join(repoRoot, "packages", "tsconfig", "package.json"), `${JSON.stringify({ name: "@hatch/tsconfig" }, null, 2)}\n`, "utf8");
  mkdirSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@types+node@22.0.0", "node_modules", "@types", "node"),
    { recursive: true },
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.7.3", "node_modules", "typescript"), { recursive: true });
  mkdirSync(
    path.join(repoRoot, "node_modules", ".pnpm", "@mariozechner+pi-coding-agent@0.56.2", "node_modules", "@mariozechner", "pi-coding-agent"),
    { recursive: true },
  );

  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "capability-foreman", "node_modules", "@hatch", "tsconfig")),
    path.join("..", "..", "..", "tsconfig"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "capability-foreman", "node_modules", "@types", "node")),
    path.join("..", "..", "..", "..", "node_modules", ".pnpm", "@types+node@22.0.0", "node_modules", "@types", "node"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "capability-foreman", "node_modules", "typescript")),
    path.join("..", "..", "..", "node_modules", ".pnpm", "typescript@5.7.3", "node_modules", "typescript"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "packages", "capability-foreman", "node_modules", "@mariozechner", "pi-coding-agent")),
    path.join("..", "..", "..", "..", "node_modules", ".pnpm", "@mariozechner+pi-coding-agent@0.56.2", "node_modules", "@mariozechner", "pi-coding-agent"),
  );
});

test("runPostinstallBootstrap restores apps hatch local bin shims needed by pnpm exec vitest", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(
    path.join(repoRoot, "apps", "hatch", "package.json"),
    `${JSON.stringify({
      name: "hatch",
      devDependencies: {
        vitest: "^3.2.4",
        typescript: "^5.9.3",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "vitest@3.2.4", "node_modules", "vitest"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "vitest@3.2.4", "node_modules", "vitest", "package.json"),
    `${JSON.stringify({ name: "vitest", bin: { vitest: "vitest.mjs" } }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(repoRoot, "node_modules", ".pnpm", "vitest@3.2.4", "node_modules", "vitest", "vitest.mjs"), "", "utf8");
  mkdirSync(path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.9.3", "node_modules", "typescript", "bin"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.9.3", "node_modules", "typescript", "package.json"),
    `${JSON.stringify({ name: "typescript", bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" } }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.9.3", "node_modules", "typescript", "bin", "tsc"), "", "utf8");
  writeFileSync(path.join(repoRoot, "node_modules", ".pnpm", "typescript@5.9.3", "node_modules", "typescript", "bin", "tsserver"), "", "utf8");

  runPostinstallBootstrap(repoRoot);

  assert.equal(
    readlinkSync(path.join(repoRoot, "apps", "hatch", "node_modules", "vitest")),
    path.join("..", "..", "..", "node_modules", ".pnpm", "vitest@3.2.4", "node_modules", "vitest"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "apps", "hatch", "node_modules", ".bin", "vitest")),
    path.join("..", "vitest", "vitest.mjs"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "apps", "hatch", "node_modules", ".bin", "tsc")),
    path.join("..", "typescript", "bin", "tsc"),
  );
  assert.equal(
    readlinkSync(path.join(repoRoot, "apps", "hatch", "node_modules", ".bin", "tsserver")),
    path.join("..", "typescript", "bin", "tsserver"),
  );
});
