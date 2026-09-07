import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapWorkspace,
  inspectBootstrapArtifacts,
  repairWorkspaceBootstrap,
} from "../src/workspace-package-manager.ts";

test("bootstrapWorkspace forces CI=true for non-interactive pnpm bootstrap", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-ci-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  const calls = [];
  const runFn = (command, args, options = {}) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  };

  const out = bootstrapWorkspace({
    repoRoot: repoDir,
    workspaceDir: repoDir,
    runFn,
    inspectArtifactsFn: () => ({ ok: true, diagnostics: [] }),
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "pnpm");
  assert.deepEqual(calls[0].args, ["install", "--frozen-lockfile"]);
  assert.equal(calls[0].options.env.CI, "true");
  assert.equal(calls[1].options.env.CI, "true");
});

test("bootstrapWorkspace repairs missing hatch dist artifacts after a cached workspace build", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-repair-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  const calls = [];
  let inspectPass = 0;
  const runFn = (command, args, options = {}) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  };

  const out = bootstrapWorkspace({
    repoRoot: repoDir,
    workspaceDir: repoDir,
    runFn,
    inspectArtifactsFn: () => {
      inspectPass += 1;
      if (inspectPass === 1) return { ok: false, diagnostics: ["empty:apps/hatch/dist/pipeline/handler/worktree.js"] };
      return { ok: true, diagnostics: [] };
    },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["install", "--frozen-lockfile"],
    ["--silent", "build"],
    ["--filter", "hatch", "build"],
  ]);
});

test("bootstrapWorkspace fails closed when hatch dist artifacts remain broken after repair build", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-fail-closed-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  const calls = [];
  const runFn = (command, args, options = {}) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  };

  const out = bootstrapWorkspace({
    repoRoot: repoDir,
    workspaceDir: repoDir,
    runFn,
    inspectArtifactsFn: () => ({ ok: false, diagnostics: ["empty:apps/hatch/dist/pipeline/handler/worktree.js"] }),
  });

  assert.equal(out.ok, false);
  assert.match(out.reason, /empty:apps\/hatch\/dist\/pipeline\/handler\/worktree\.js/);
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["install", "--frozen-lockfile"],
    ["--silent", "build"],
    ["--filter", "hatch", "build"],
  ]);
});

test("bootstrapWorkspace skips artifact enforcement when requiredArtifacts is empty", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-no-artifacts-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

  const calls = [];
  const runFn = (command, args, options = {}) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  };

  const out = bootstrapWorkspace({
    repoRoot: repoDir,
    workspaceDir: repoDir,
    runFn,
    requiredArtifacts: [],
    inspectArtifactsFn: () => ({ ok: false, diagnostics: ["missing:apps/hatch/dist/cli.js"] }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.reason, "workspace_bootstrapped");
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["install", "--frozen-lockfile"],
    ["--silent", "build"],
  ]);
});

test("repairWorkspaceBootstrap uses the lightweight checked-in bootstrap script before artifact repair", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-repair-lightweight-"));
  writeFileSync(join(repoDir, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
  writeFileSync(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  mkdirSync(join(repoDir, "scripts"), { recursive: true });
  writeFileSync(join(repoDir, "scripts", "postinstall-bootstrap.mjs"), "console.log('ok');\n", "utf8");

  const calls = [];
  let inspectPass = 0;
  const runFn = (command, args, options = {}) => {
    calls.push({ command, args, options });
    return {
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    };
  };

  const out = repairWorkspaceBootstrap({
    repoRoot: repoDir,
    workspaceDir: repoDir,
    runFn,
    inspectArtifactsFn: () => {
      inspectPass += 1;
      if (inspectPass === 1) return { ok: false, diagnostics: ["missing:apps/hatch/dist/cli.js"] };
      return { ok: true, diagnostics: [] };
    },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(calls.map((entry) => entry.args), [
    [join(repoDir, "scripts", "postinstall-bootstrap.mjs")],
    ["--filter", "hatch", "build"],
  ]);
});

test("inspectBootstrapArtifacts reports missing and empty required hatch runtime outputs", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "workspace-bootstrap-artifacts-"));
  mkdirSync(join(repoDir, "apps", "hatch", "dist", "pipeline", "handler"), { recursive: true });
  mkdirSync(join(repoDir, "apps", "hatch", "dist"), { recursive: true });
  writeFileSync(join(repoDir, "apps", "hatch", "dist", "cli.js"), "#!/usr/bin/env node\n", "utf8");
  writeFileSync(join(repoDir, "apps", "hatch", "dist", "pipeline", "handler", "worktree.js"), "", "utf8");

  const out = inspectBootstrapArtifacts(repoDir);

  assert.equal(out.ok, false);
  assert.deepEqual(out.diagnostics, [
    "missing:apps/hatch/dist/index.js",
    "empty:apps/hatch/dist/pipeline/handler/worktree.js",
  ]);
});
