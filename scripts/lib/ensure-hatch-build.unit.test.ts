import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHatchBuildInvocation } from "./ensure-hatch-build.ts";

test("resolveHatchBuildInvocation uses pnpm filter build in pnpm workspaces", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "ensure-hatch-build-pnpm-"));
  try {
    writeFileSync(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const invocation = resolveHatchBuildInvocation({ repoRoot, silent: true });

    assert.equal(invocation.command, "pnpm");
    assert.deepEqual(invocation.args, ["--filter", "hatch", "--silent", "build"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resolveHatchBuildInvocation falls back to npm workspace build without pnpm markers", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "ensure-hatch-build-npm-"));
  try {
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2));

    const invocation = resolveHatchBuildInvocation({ repoRoot, silent: false });

    assert.equal(invocation.command, "npm");
    assert.deepEqual(invocation.args, ["run", "build", "--workspace=hatch"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
