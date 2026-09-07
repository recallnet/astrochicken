import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDestinationRoute,
  resolveTargetRepoFromConfig,
  resolveTargetRepoFromContext,
  resolvePrimaryOpsRepo,
} from "../../src/lib/factory-repo-identity.ts";

test("resolveTargetRepoFromContext soft-degrades to target_repo for non-mothership when requireResolved=false", () => {
  assert.equal(
    resolveTargetRepoFromContext(
      { factory_id: "alpha", target_repo: "acme/alpha" },
      { requireResolved: false },
    ),
    "acme/alpha",
  );
});

test("resolveTargetRepoFromContext resolves target_repo for any factory", () => {
  assert.equal(
    resolveTargetRepoFromContext(
      { factory_id: "alpha", target_repo: "acme/alpha" },
      { requireResolved: true },
    ),
    "acme/alpha",
  );
});

test("resolveTargetRepoFromConfig soft-degrades to target_repo for non-mothership when requireResolved=false", () => {
  assert.equal(
    resolveTargetRepoFromConfig(
      { factory_id: "beta", target_repo: "acme/beta" },
      { requireResolved: false },
    ),
    "acme/beta",
  );
});

test("resolvePrimaryOpsRepo does not throw for legacy target_repo-only context when requireResolved=false", () => {
  const identity = resolvePrimaryOpsRepo({
    context: { factory_id: "alpha", target_repo: "acme/alpha" },
    factoryId: "alpha",
    requireResolved: false,
  });

  assert.equal(identity.target_repo, "acme/alpha");
  assert.equal(identity.primary_repo, "acme/alpha");
  assert.equal("home_repo" in identity, false);
});

test("resolveDestinationRoute returns destination repo and normalized labels", () => {
  const route = resolveDestinationRoute(
    {
      destinations_json: JSON.stringify({
        goal_issues: {
          repo: " recallnet/astrochicken ",
          labels: ["goal", "source:brainstorm", "managed", "managed"],
        },
      }),
    },
    "goal_issues",
  );

  assert.equal(route.destination_key, "goal_issues");
  assert.equal(route.repo, "recallnet/astrochicken");
  assert.deepEqual(route.labels.sort(), ["goal", "managed", "source:brainstorm"].sort());
});

test("resolveDestinationRoute fails closed on missing destination repo", () => {
  assert.throws(
    () => resolveDestinationRoute(
      {
        destinations_json: JSON.stringify({ goal_issues: {} }),
      },
      "goal_issues",
    ),
    /destinations\.goal_issues\.repo is required/,
  );
});

test("resolveDestinationRoute fails closed on invalid destination labels type", () => {
  assert.throws(
    () => resolveDestinationRoute(
      {
        destinations_json: JSON.stringify({ goal_issues: { repo: "recallnet/astrochicken", labels: "goal" } }),
      },
      "goal_issues",
    ),
    /destinations\.goal_issues\.labels must be an array/,
  );
});
