import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  normalizeRepoSlug,
  normalizeDestinationRepos,
  normalizeFactoryRepoRoleContext,
  hasFactoryRepoRoleContext,
  buildFactoryRepoRoleContext,
  buildFactoryRepoRoleContextFromFactory,
  readFactoryRepoRoleContextFromEnv,
  buildGuardRepoRoleOptions,
} = await import("../src/factory-repo-roles.ts");

describe("normalizeRepoSlug", () => {
  it("passes through owner/repo lowercase", () => {
    assert.equal(normalizeRepoSlug("owner/repo"), "owner/repo");
  });

  it("lowercases OWNER/REPO", () => {
    assert.equal(normalizeRepoSlug("OWNER/REPO"), "owner/repo");
  });

  it("strips git@ SSH prefix", () => {
    assert.equal(normalizeRepoSlug("git@github.com:owner/repo.git"), "owner/repo");
  });

  it("strips https prefix with .git", () => {
    assert.equal(normalizeRepoSlug("https://github.com/owner/repo.git"), "owner/repo");
  });

  it("strips https prefix without .git", () => {
    assert.equal(normalizeRepoSlug("https://github.com/owner/repo"), "owner/repo");
  });

  it("returns empty for empty string", () => {
    assert.equal(normalizeRepoSlug(""), "");
  });

  it("returns empty for undefined", () => {
    assert.equal(normalizeRepoSlug(), "");
  });

  it("rejects absolute paths", () => {
    assert.equal(normalizeRepoSlug("/absolute/path"), "");
  });

  it("rejects relative paths", () => {
    assert.equal(normalizeRepoSlug("./relative"), "");
  });

  it("rejects file:// URLs", () => {
    assert.equal(normalizeRepoSlug("file:///some/path"), "");
  });

  it("rejects too many segments", () => {
    assert.equal(normalizeRepoSlug("owner/repo/extra"), "");
  });

  it("rejects single segment", () => {
    assert.equal(normalizeRepoSlug("just-one"), "");
  });

  it("rejects backslash paths", () => {
    assert.equal(normalizeRepoSlug("owner\\repo"), "");
  });
});

describe("normalizeDestinationRepos", () => {
  it("normalizes and deduplicates an array of slugs", () => {
    const result = normalizeDestinationRepos(["Owner/Repo", "owner/repo", "other/repo"]);
    assert.deepEqual(result, ["owner/repo", "other/repo"]);
  });

  it("returns empty for empty array", () => {
    assert.deepEqual(normalizeDestinationRepos([]), []);
  });

  it("returns empty for non-array", () => {
    assert.deepEqual(normalizeDestinationRepos("not-array"), []);
  });

  it("returns empty for undefined", () => {
    assert.deepEqual(normalizeDestinationRepos(), []);
  });

  it("filters out invalid slugs", () => {
    const result = normalizeDestinationRepos(["owner/repo", "/bad/path", "good/one"]);
    assert.deepEqual(result, ["owner/repo", "good/one"]);
  });
});

describe("normalizeFactoryRepoRoleContext", () => {
  it("normalizes a full context", () => {
    const result = normalizeFactoryRepoRoleContext({
      targetRepo: "OWNER/HOME",
      controlPlaneRepo: "OWNER/CP",
      destinationRepos: ["OWNER/DEST"],
    });
    assert.deepEqual(result, {
      targetRepo: "owner/home",
      controlPlaneRepo: "owner/cp",
      destinationRepos: ["owner/dest"],
    });
  });

  it("returns empty for empty object", () => {
    const result = normalizeFactoryRepoRoleContext({});
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("returns empty for non-object", () => {
    const result = normalizeFactoryRepoRoleContext("not-object");
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("returns empty for undefined", () => {
    const result = normalizeFactoryRepoRoleContext();
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("returns empty for null", () => {
    const result = normalizeFactoryRepoRoleContext(null);
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });
});

describe("hasFactoryRepoRoleContext", () => {
  it("returns true when targetRepo present", () => {
    assert.equal(hasFactoryRepoRoleContext({ targetRepo: "owner/repo" }), true);
  });

  it("returns true when controlPlaneRepo present", () => {
    assert.equal(hasFactoryRepoRoleContext({ controlPlaneRepo: "owner/repo" }), true);
  });

  it("returns true when destinationRepos present", () => {
    assert.equal(hasFactoryRepoRoleContext({ destinationRepos: ["owner/repo"] }), true);
  });

  it("returns false when all empty", () => {
    assert.equal(hasFactoryRepoRoleContext({}), false);
  });

  it("returns false for undefined", () => {
    assert.equal(hasFactoryRepoRoleContext(), false);
  });
});

describe("buildFactoryRepoRoleContext", () => {
  it("normalizes targetRepo as the primary work repository", () => {
    const result = buildFactoryRepoRoleContext({ targetRepo: "OWNER/HOME" });
    assert.equal(result.targetRepo, "owner/home");
  });

  it("ignores the removed homeRepo alias", () => {
    const result = buildFactoryRepoRoleContext({ homeRepo: "owner/ignored", targetRepo: "owner/target" });
    assert.equal(result.targetRepo, "owner/target");
  });

  it("normalizes controlPlaneRepo", () => {
    const result = buildFactoryRepoRoleContext({ controlPlaneRepo: "OWNER/CP" });
    assert.equal(result.controlPlaneRepo, "owner/cp");
  });

  it("extracts destination repos from destinations object", () => {
    const result = buildFactoryRepoRoleContext({
      destinations: {
        primary: { repo: "owner/dest1" },
        secondary: { repo: "owner/dest2" },
      },
    });
    assert.deepEqual(result.destinationRepos, ["owner/dest1", "owner/dest2"]);
  });

  it("extracts destinations from JSON string", () => {
    const result = buildFactoryRepoRoleContext({
      destinations: JSON.stringify({
        primary: { repo: "owner/dest1" },
      }),
    });
    assert.deepEqual(result.destinationRepos, ["owner/dest1"]);
  });

  it("returns empty for defaults", () => {
    const result = buildFactoryRepoRoleContext();
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("throws on invalid destinations JSON string", () => {
    assert.throws(
      () => buildFactoryRepoRoleContext({ destinations: "[1,2]" }),
      { message: "invalid_factory_destinations_json" },
    );
  });

  it("throws on non-object non-string non-null destinations", () => {
    assert.throws(
      () => buildFactoryRepoRoleContext({ destinations: 42 }),
      { message: "invalid_factory_destinations" },
    );
  });

  it("skips non-object destination entries", () => {
    const result = buildFactoryRepoRoleContext({
      destinations: { a: { repo: "owner/dest" }, b: "just-a-string" },
    });
    assert.deepEqual(result.destinationRepos, ["owner/dest"]);
  });
});

describe("buildFactoryRepoRoleContextFromFactory", () => {
  it("reads target_repo from context", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: { target_repo: "owner/home" },
    });
    assert.equal(result.targetRepo, "owner/home");
  });

  it("reads target_repo from context", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: { target_repo: "owner/target" },
    });
    assert.equal(result.targetRepo, "owner/target");
  });

  it("falls back target_repo from config", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: {},
      config: { target_repo: "owner/cfg-target" },
    });
    assert.equal(result.targetRepo, "owner/cfg-target");
  });

  it("reads control_plane_repo from context", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: { control_plane_repo: "owner/cp" },
    });
    assert.equal(result.controlPlaneRepo, "owner/cp");
  });

  it("falls back control_plane_repo from config", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: {},
      config: { control_plane_repo: "owner/cp" },
    });
    assert.equal(result.controlPlaneRepo, "owner/cp");
  });

  it("parses destinations_json from context", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: {
        destinations_json: JSON.stringify({ d: { repo: "owner/dest" } }),
      },
    });
    assert.deepEqual(result.destinationRepos, ["owner/dest"]);
  });

  it("reads destinations from config when context has none", () => {
    const result = buildFactoryRepoRoleContextFromFactory({
      context: {},
      config: { destinations: { d: { repo: "owner/dest" } } },
    });
    assert.deepEqual(result.destinationRepos, ["owner/dest"]);
  });

  it("returns empty for defaults", () => {
    const result = buildFactoryRepoRoleContextFromFactory();
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("handles non-object context/config", () => {
    const result = buildFactoryRepoRoleContextFromFactory({ context: "bad", config: 42 });
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });
});

describe("readFactoryRepoRoleContextFromEnv", () => {
  it("returns empty context when env has no var", () => {
    const result = readFactoryRepoRoleContextFromEnv({ env: {} });
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("returns empty context for empty string value", () => {
    const result = readFactoryRepoRoleContextFromEnv({ env: { HATCH_FACTORY_REPO_ROLES_JSON: "" } });
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });

  it("parses valid JSON from env", () => {
    const ctx = { targetRepo: "owner/repo", controlPlaneRepo: "owner/cp", destinationRepos: ["owner/dest"] };
    const result = readFactoryRepoRoleContextFromEnv({
      env: { HATCH_FACTORY_REPO_ROLES_JSON: JSON.stringify(ctx) },
    });
    assert.deepEqual(result, ctx);
  });

  it("throws on invalid JSON", () => {
    assert.throws(
      () => readFactoryRepoRoleContextFromEnv({ env: { HATCH_FACTORY_REPO_ROLES_JSON: "not json{" } }),
      { message: "invalid_hatch_factory_repo_roles_json" },
    );
  });

  it("throws on non-object JSON (array)", () => {
    assert.throws(
      () => readFactoryRepoRoleContextFromEnv({ env: { HATCH_FACTORY_REPO_ROLES_JSON: "[1,2]" } }),
      { message: "invalid_hatch_factory_repo_roles_json" },
    );
  });

  it("returns empty for undefined env", () => {
    const result = readFactoryRepoRoleContextFromEnv({ env: undefined });
    assert.deepEqual(result, { targetRepo: "", controlPlaneRepo: "", destinationRepos: [] });
  });
});

describe("buildGuardRepoRoleOptions", () => {
  it("uses explicit context over env", () => {
    const result = buildGuardRepoRoleOptions({
      explicitContext: { targetRepo: "owner/explicit" },
      env: { HATCH_FACTORY_REPO_ROLES_JSON: JSON.stringify({ targetRepo: "owner/env" }) },
    });
    assert.equal(result.targetRepo, "owner/explicit");
    assert.equal(result.enforceRepoRoles, true);
  });

  it("falls back to env when no explicit context", () => {
    const result = buildGuardRepoRoleOptions({
      explicitContext: null,
      env: { HATCH_FACTORY_REPO_ROLES_JSON: JSON.stringify({ targetRepo: "owner/env" }) },
    });
    assert.equal(result.targetRepo, "owner/env");
    assert.equal(result.enforceRepoRoles, true);
  });

  it("uses repoSlug as primary", () => {
    const result = buildGuardRepoRoleOptions({
      repoSlug: "owner/primary",
      fallbackRepoSlug: "owner/fallback",
      env: {},
    });
    assert.equal(result.repoSlug, "owner/primary");
  });

  it("falls back to fallbackRepoSlug", () => {
    const result = buildGuardRepoRoleOptions({
      repoSlug: "",
      fallbackRepoSlug: "owner/fallback",
      env: {},
    });
    assert.equal(result.repoSlug, "owner/fallback");
  });

  it("falls back to controlPlaneRepo from context", () => {
    const result = buildGuardRepoRoleOptions({
      repoSlug: "",
      fallbackRepoSlug: "",
      explicitContext: { controlPlaneRepo: "owner/cp" },
      env: {},
    });
    assert.equal(result.repoSlug, "owner/cp");
  });

  it("falls back to targetRepo from context", () => {
    const result = buildGuardRepoRoleOptions({
      repoSlug: "",
      fallbackRepoSlug: "",
      explicitContext: { targetRepo: "owner/home" },
      env: {},
    });
    assert.equal(result.repoSlug, "owner/home");
  });

  it("enforceRepoRoles true when context present", () => {
    const result = buildGuardRepoRoleOptions({
      explicitContext: { targetRepo: "owner/repo" },
      env: {},
    });
    assert.equal(result.enforceRepoRoles, true);
  });

  it("enforceRepoRoles false when no context", () => {
    const result = buildGuardRepoRoleOptions({
      explicitContext: null,
      env: {},
    });
    assert.equal(result.enforceRepoRoles, false);
  });

  it("enforceRepoRoles false when enforceWhenContextPresent is false", () => {
    const result = buildGuardRepoRoleOptions({
      explicitContext: { targetRepo: "owner/repo" },
      enforceWhenContextPresent: false,
      env: {},
    });
    assert.equal(result.enforceRepoRoles, false);
  });

  it("returns defaults when called with no args", () => {
    const result = buildGuardRepoRoleOptions({ env: {} });
    assert.equal(result.targetRepo, "");
    assert.equal(result.controlPlaneRepo, "");
    assert.deepEqual(result.destinationRepos, []);
    assert.equal(result.repoSlug, "");
    assert.equal(result.enforceRepoRoles, false);
  });
});
