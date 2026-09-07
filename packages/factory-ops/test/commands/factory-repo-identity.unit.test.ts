import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTargetRepoFromContext,
  resolveTargetRepoFromConfig,
  resolveDestinationsFromContext,
  resolveDestinationRoute,
  resolveDestinationRepo,
  resolvePrimaryOpsRepo,
} from "../../src/lib/factory-repo-identity.ts";

// ---------------------------------------------------------------------------
// resolveTargetRepoFromContext
// ---------------------------------------------------------------------------
describe("resolveTargetRepoFromContext", () => {
  it("returns target_repo when present", () => {
    assert.equal(
      resolveTargetRepoFromContext({ target_repo: "owner/repo" }),
      "owner/repo",
    );
  });

  it("trims whitespace from target_repo", () => {
    assert.equal(
      resolveTargetRepoFromContext({ target_repo: "  owner/repo  " }),
      "owner/repo",
    );
  });

  it("returns target_repo regardless of factory_id", () => {
    assert.equal(
      resolveTargetRepoFromContext(
        { target_repo: "owner/repo", factory_id: "mothership" },
      ),
      "owner/repo",
    );
    assert.equal(
      resolveTargetRepoFromContext(
        { target_repo: "owner/repo", factory_id: "other" },
      ),
      "owner/repo",
    );
  });

  it("returns target_repo when factoryId option is provided", () => {
    assert.equal(
      resolveTargetRepoFromContext(
        { target_repo: "owner/repo" },
        { factoryId: "mothership" },
      ),
      "owner/repo",
    );
  });

  it("returns target_repo for any factory when requireResolved is false", () => {
    assert.equal(
      resolveTargetRepoFromContext(
        { target_repo: "owner/repo", factory_id: "other" },
        { requireResolved: false },
      ),
      "owner/repo",
    );
  });

  it("returns empty string when nothing resolved and requireResolved is false", () => {
    assert.equal(
      resolveTargetRepoFromContext({}, { requireResolved: false }),
      "",
    );
  });

  it("throws when nothing resolved and requireResolved is true (default)", () => {
    assert.throws(
      () => resolveTargetRepoFromContext({}),
      /unable to resolve target_repo/,
    );
  });

  it("handles null/undefined context gracefully with requireResolved false", () => {
    assert.equal(
      resolveTargetRepoFromContext(null, { requireResolved: false }),
      "",
    );
    assert.equal(
      resolveTargetRepoFromContext(undefined, { requireResolved: false }),
      "",
    );
  });

  it("handles non-object context with requireResolved false", () => {
    assert.equal(
      resolveTargetRepoFromContext("not-an-object", { requireResolved: false }),
      "",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveTargetRepoFromConfig
// ---------------------------------------------------------------------------
describe("resolveTargetRepoFromConfig", () => {
  it("returns target_repo when present", () => {
    assert.equal(
      resolveTargetRepoFromConfig({ target_repo: "owner/repo" }),
      "owner/repo",
    );
  });

  it("returns target_repo regardless of factory_id", () => {
    assert.equal(
      resolveTargetRepoFromConfig(
        { target_repo: "owner/repo", factory_id: "mothership" },
      ),
      "owner/repo",
    );
    assert.equal(
      resolveTargetRepoFromConfig(
        { target_repo: "owner/repo", factory_id: "other" },
      ),
      "owner/repo",
    );
  });

  it("returns target_repo for any factory when requireResolved is false", () => {
    assert.equal(
      resolveTargetRepoFromConfig(
        { target_repo: "owner/repo", factory_id: "other" },
        { requireResolved: false },
      ),
      "owner/repo",
    );
  });

  it("returns empty string when nothing resolved and requireResolved is false", () => {
    assert.equal(
      resolveTargetRepoFromConfig({}, { requireResolved: false }),
      "",
    );
  });

  it("throws when nothing resolved and requireResolved is true", () => {
    assert.throws(
      () => resolveTargetRepoFromConfig({}),
      /unable to resolve target_repo/,
    );
  });

  it("error message says 'declare target_repo in config'", () => {
    assert.throws(
      () => resolveTargetRepoFromConfig({}),
      /declare target_repo in config/,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDestinationsFromContext
// ---------------------------------------------------------------------------
describe("resolveDestinationsFromContext", () => {
  it("returns destinations object when present", () => {
    const destinations = { ext: { repo: "owner/ext" } };
    assert.deepStrictEqual(
      resolveDestinationsFromContext({ destinations }),
      destinations,
    );
  });

  it("parses destinations_json string", () => {
    const expected = { ext: { repo: "owner/ext" } };
    assert.deepStrictEqual(
      resolveDestinationsFromContext({
        destinations_json: JSON.stringify(expected),
      }),
      expected,
    );
  });

  it("prefers destinations_json over destinations", () => {
    const fromJson = { a: { repo: "owner/a" } };
    const fromObj = { b: { repo: "owner/b" } };
    assert.deepStrictEqual(
      resolveDestinationsFromContext({
        destinations_json: JSON.stringify(fromJson),
        destinations: fromObj,
      }),
      fromJson,
    );
  });

  it("returns empty object for empty/null context", () => {
    assert.deepStrictEqual(resolveDestinationsFromContext({}), {});
    assert.deepStrictEqual(resolveDestinationsFromContext(null), {});
    assert.deepStrictEqual(resolveDestinationsFromContext(), {});
  });

  it("throws for invalid JSON string", () => {
    assert.throws(
      () =>
        resolveDestinationsFromContext({ destinations_json: "not-json" }),
      /destinations must be a JSON object/,
    );
  });

  it("throws for JSON that is not an object", () => {
    assert.throws(
      () =>
        resolveDestinationsFromContext({ destinations_json: "[1,2,3]" }),
      /destinations must be a JSON object/,
    );
  });

  it("returns empty object for empty JSON string", () => {
    assert.deepStrictEqual(
      resolveDestinationsFromContext({ destinations_json: "  " }),
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDestinationRoute
// ---------------------------------------------------------------------------
describe("resolveDestinationRoute", () => {
  const ctx = {
    destinations: {
      ext: { repo: "owner/ext", labels: ["bug"] },
      minimal: { repo: "owner/minimal" },
    },
  };

  it("returns destination_key, repo, and labels", () => {
    const result = resolveDestinationRoute(ctx, "ext");
    assert.equal(result.destination_key, "ext");
    assert.equal(result.repo, "owner/ext");
    assert.ok(Array.isArray(result.labels));
  });

  it("always includes 'goal' in labels", () => {
    const result = resolveDestinationRoute(ctx, "ext");
    assert.ok(result.labels.includes("goal"));
  });

  it("merges custom labels with 'goal'", () => {
    const result = resolveDestinationRoute(ctx, "ext");
    assert.ok(result.labels.includes("bug"));
    assert.ok(result.labels.includes("goal"));
  });

  it("deduplicates 'goal' if already in custom labels", () => {
    const ctx2 = {
      destinations: {
        ext: { repo: "owner/ext", labels: ["goal", "bug"] },
      },
    };
    const result = resolveDestinationRoute(ctx2, "ext");
    const goalCount = result.labels.filter((l) => l === "goal").length;
    assert.equal(goalCount, 1);
  });

  it("works with no custom labels", () => {
    const result = resolveDestinationRoute(ctx, "minimal");
    assert.deepStrictEqual(result.labels, ["goal"]);
  });

  it("throws for empty destination key", () => {
    assert.throws(
      () => resolveDestinationRoute(ctx, ""),
      /destination key is required/,
    );
  });

  it("throws for missing destination key", () => {
    assert.throws(
      () => resolveDestinationRoute(ctx, "nonexistent"),
      /missing destinations\.nonexistent route/,
    );
  });

  it("throws when repo is missing from route", () => {
    const ctx2 = { destinations: { broken: { labels: ["x"] } } };
    assert.throws(
      () => resolveDestinationRoute(ctx2, "broken"),
      /destinations\.broken\.repo is required/,
    );
  });

  it("throws when labels is not an array", () => {
    const ctx2 = {
      destinations: { bad: { repo: "owner/bad", labels: "not-array" } },
    };
    assert.throws(
      () => resolveDestinationRoute(ctx2, "bad"),
      /labels must be an array/,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveDestinationRepo
// ---------------------------------------------------------------------------
describe("resolveDestinationRepo", () => {
  const ctx = {
    destinations: { ext: { repo: "owner/ext" } },
  };

  it("returns repo string for valid destination", () => {
    assert.equal(resolveDestinationRepo(ctx, "ext"), "owner/ext");
  });

  it("returns empty string for missing destination", () => {
    assert.equal(resolveDestinationRepo(ctx, "nonexistent"), "");
  });

  it("returns empty string for empty key", () => {
    assert.equal(resolveDestinationRepo(ctx, ""), "");
  });

  it("returns empty string when no destinations", () => {
    assert.equal(resolveDestinationRepo({}, "ext"), "");
  });
});

// ---------------------------------------------------------------------------
// resolvePrimaryOpsRepo
// ---------------------------------------------------------------------------
describe("resolvePrimaryOpsRepo", () => {
  it("uses target_repo as primary_repo", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo" },
      factoryId: "mothership",
    });
    assert.equal(result.target_repo, "owner/repo");
    assert.equal(result.primary_repo, "owner/repo");
    assert.equal(result.factory_id, "mothership");
  });

  it("does not include home_repo in result", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo" },
      factoryId: "mothership",
    });
    assert.equal("home_repo" in result, false);
    assert.equal("used_legacy_target_repo_fallback" in result, false);
  });

  it("returns factory_id from option", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo" },
      factoryId: "custom-factory",
    });
    assert.equal(result.factory_id, "custom-factory");
  });

  it("returns factory_id from context when not provided as option", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo", factory_id: "from-context" },
    });
    assert.equal(result.factory_id, "from-context");
  });

  it("includes destinations in result", () => {
    const destinations = { ext: { repo: "owner/ext" } };
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo", destinations },
      factoryId: "mothership",
    });
    assert.deepStrictEqual(result.destinations, destinations);
  });

  it("target_repo is set from context", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo" },
      factoryId: "mothership",
    });
    assert.equal(result.target_repo, "owner/repo");
  });

  it("returns empty target_repo when requireResolved is false and nothing set", () => {
    const result = resolvePrimaryOpsRepo({
      context: {},
      factoryId: "mothership",
      requireResolved: false,
    });
    assert.equal(result.target_repo, "");
    assert.equal(result.primary_repo, "");
  });

  it("throws when nothing resolved and requireResolved is true", () => {
    assert.throws(
      () =>
        resolvePrimaryOpsRepo({
          context: {},
          factoryId: "mothership",
          requireResolved: true,
        }),
      /unable to resolve target_repo/,
    );
  });

  it("handles default (no arguments)", () => {
    const result = resolvePrimaryOpsRepo({
      context: { target_repo: "owner/repo" },
    });
    assert.equal(result.primary_repo, "owner/repo");
  });
});
