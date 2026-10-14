import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolveCanonicalCheckoutPath,
  isCanonicalCheckout,
  resolveDisposableWorktreeRoot,
  resolveApprovedDisposableWorktreeRoots,
  classifyManagedWorktreePath,
  DEFAULT_DISPOSABLE_WORKTREE_KINDS,
} from "../src/canonical-worktree.ts";

const BASE = "/test/base";

describe("DEFAULT_DISPOSABLE_WORKTREE_KINDS", () => {
  it("is a frozen array of wave, merge, proposal", () => {
    assert.deepEqual([...DEFAULT_DISPOSABLE_WORKTREE_KINDS], ["wave", "merge", "proposal"]);
    assert.ok(Object.isFrozen(DEFAULT_DISPOSABLE_WORKTREE_KINDS));
  });
});

describe("resolveCanonicalCheckoutPath", () => {
  it("configuredPath takes priority", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "/explicit/path",
      config: { canonical_checkout_path: "/config/path" },
      env: { HATCH_CANONICAL_CHECKOUT_PATH: "/hatch/path" },
      baseDir: BASE,
    });
    assert.equal(result, "/explicit/path");
  });

  it("falls back to config.canonical_checkout_path", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "",
      config: { canonical_checkout_path: "/config/path" },
      env: { HATCH_CANONICAL_CHECKOUT_PATH: "/hatch/path" },
      baseDir: BASE,
    });
    assert.equal(result, "/config/path");
  });

  it("falls back to env.HATCH_CANONICAL_CHECKOUT_PATH", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "",
      config: {},
      env: { HATCH_CANONICAL_CHECKOUT_PATH: "/hatch/path", CANONICAL_CHECKOUT_PATH: "/canon/path" },
      baseDir: BASE,
    });
    assert.equal(result, "/hatch/path");
  });

  it("falls back to env.CANONICAL_CHECKOUT_PATH", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "",
      config: {},
      env: { CANONICAL_CHECKOUT_PATH: "/canon/path" },
      baseDir: BASE,
    });
    assert.equal(result, "/canon/path");
  });

  it("supports ${VAR} interpolation from env", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "${HOME}/projects/repo",
      env: { HOME: "/test-home/dev" },
      baseDir: BASE,
    });
    assert.equal(result, "/test-home/dev/projects/repo");
  });

  it("resolves relative path from baseDir", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "relative/repo",
      baseDir: BASE,
      env: {},
    });
    assert.equal(result, path.resolve(BASE, "relative/repo"));
  });

  it("returns empty string when nothing configured", () => {
    const result = resolveCanonicalCheckoutPath({
      configuredPath: "",
      config: {},
      env: {},
      baseDir: BASE,
    });
    assert.equal(result, "");
  });
});

describe("isCanonicalCheckout", () => {
  it("returns true for same paths", () => {
    assert.equal(isCanonicalCheckout("/repo/checkout", { canonicalCheckoutPath: "/repo/checkout", baseDir: BASE }), true);
  });

  it("returns false for different paths", () => {
    assert.equal(isCanonicalCheckout("/repo/a", { canonicalCheckoutPath: "/repo/b", baseDir: BASE }), false);
  });

  it("returns false for empty candidate", () => {
    assert.equal(isCanonicalCheckout("", { canonicalCheckoutPath: "/repo/checkout", baseDir: BASE }), false);
  });

  it("returns false for empty canonical", () => {
    assert.equal(isCanonicalCheckout("/repo/checkout", { canonicalCheckoutPath: "", baseDir: BASE }), false);
  });
});

describe("resolveDisposableWorktreeRoot", () => {
  it("returns <parent>/.hatch-worktrees/<kind>", () => {
    const result = resolveDisposableWorktreeRoot({ repoPath: "/projects/repo", kind: "wave" });
    assert.equal(result, "/projects/.hatch-worktrees/wave");
  });

  it("returns empty string for empty repoPath", () => {
    assert.equal(resolveDisposableWorktreeRoot({ repoPath: "", kind: "wave" }), "");
  });

  it("returns empty string for empty kind", () => {
    assert.equal(resolveDisposableWorktreeRoot({ repoPath: "/projects/repo", kind: "" }), "");
  });
});

describe("resolveApprovedDisposableWorktreeRoots", () => {
  it("returns array of resolved roots for default kinds", () => {
    const roots = resolveApprovedDisposableWorktreeRoots({ repoPath: "/projects/repo" });
    assert.deepEqual(roots, [
      "/projects/.hatch-worktrees/wave",
      "/projects/.hatch-worktrees/merge",
      "/projects/.hatch-worktrees/proposal",
    ]);
  });

  it("accepts custom kinds", () => {
    const roots = resolveApprovedDisposableWorktreeRoots({ repoPath: "/projects/repo", kinds: ["custom"] });
    assert.deepEqual(roots, ["/projects/.hatch-worktrees/custom"]);
  });

  it("deduplicates roots", () => {
    const roots = resolveApprovedDisposableWorktreeRoots({ repoPath: "/projects/repo", kinds: ["wave", "wave"] });
    assert.deepEqual(roots, ["/projects/.hatch-worktrees/wave"]);
  });

  it("returns empty array for empty repoPath", () => {
    const roots = resolveApprovedDisposableWorktreeRoots({ repoPath: "" });
    assert.deepEqual(roots, []);
  });
});

describe("classifyManagedWorktreePath", () => {
  const repoPath = "/projects/repo";
  const canonicalCheckoutPath = "/canonical/checkout";

  it("classifies canonical checkout", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: canonicalCheckoutPath,
      repoPath,
      canonicalCheckoutPath,
    });
    assert.equal(result.canonical, true);
    assert.equal(result.approvedDisposable, false);
  });

  it("classifies approved disposable worktree", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: "/projects/.hatch-worktrees/wave/branch-1",
      repoPath,
      canonicalCheckoutPath,
    });
    assert.equal(result.approvedDisposable, true);
    assert.equal(result.disposableKind, "wave");
  });

  it("classifies exact disposable root as approved", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: "/projects/.hatch-worktrees/merge",
      repoPath,
      canonicalCheckoutPath,
    });
    assert.equal(result.approvedDisposable, true);
    assert.equal(result.disposableKind, "merge");
  });

  it("classifies repo root", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: repoPath,
      repoPath,
      canonicalCheckoutPath,
    });
    assert.equal(result.repoRoot, true);
  });

  it("classifies unknown path as all false", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: "/some/random/path",
      repoPath,
      canonicalCheckoutPath,
    });
    assert.equal(result.canonical, false);
    assert.equal(result.approvedDisposable, false);
    assert.equal(result.repoRoot, false);
    assert.equal(result.disposableKind, "");
  });

  it("returns approvedRoots array", () => {
    const result = classifyManagedWorktreePath({
      candidatePath: "/some/path",
      repoPath,
      canonicalCheckoutPath,
    });
    assert.ok(Array.isArray(result.approvedRoots));
    assert.equal(result.approvedRoots.length, 3);
  });
});
