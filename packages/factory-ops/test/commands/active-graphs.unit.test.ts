import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_INTENTS_GRAPH_BASENAMES,
  ACTIVE_INTENTS_GRAPH_PATHS,
  listActiveIntentGraphPaths,
} from "../../src/lib/active-graphs.ts";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..", "..");

describe("ACTIVE_INTENTS_GRAPH_BASENAMES", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(ACTIVE_INTENTS_GRAPH_BASENAMES));
    assert.ok(Array.isArray(ACTIVE_INTENTS_GRAPH_BASENAMES));
  });

  it("contains at least one entry", () => {
    assert.ok(ACTIVE_INTENTS_GRAPH_BASENAMES.length > 0);
  });

  it("all entries end with .workflow-source.mjs", () => {
    for (const name of ACTIVE_INTENTS_GRAPH_BASENAMES) {
      assert.ok(name.endsWith(".workflow-source.mjs"), `"${name}" should end with .workflow-source.mjs`);
    }
  });

  it("all entries are plain basenames (no path separators)", () => {
    for (const name of ACTIVE_INTENTS_GRAPH_BASENAMES) {
      assert.equal(name, basename(name), `"${name}" should be a basename without path separators`);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(ACTIVE_INTENTS_GRAPH_BASENAMES);
    assert.equal(unique.size, ACTIVE_INTENTS_GRAPH_BASENAMES.length);
  });

  it("contains the expected basenames", () => {
    const names = new Set(ACTIVE_INTENTS_GRAPH_BASENAMES);
    assert.ok(names.has("factory_supervisor_tick.workflow-source.mjs"));
    assert.ok(names.has("goal_execute.workflow-source.mjs"));
    assert.ok(names.has("goal_issue_execute.workflow-source.mjs"));
  });
});

describe("ACTIVE_INTENTS_GRAPH_PATHS", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(ACTIVE_INTENTS_GRAPH_PATHS));
    assert.ok(Array.isArray(ACTIVE_INTENTS_GRAPH_PATHS));
  });

  it("contains more entries than basenames (includes capability graphs)", () => {
    assert.ok(
      ACTIVE_INTENTS_GRAPH_PATHS.length > ACTIVE_INTENTS_GRAPH_BASENAMES.length,
      `paths (${ACTIVE_INTENTS_GRAPH_PATHS.length}) should exceed basenames (${ACTIVE_INTENTS_GRAPH_BASENAMES.length})`
    );
  });

  it("all entries end with .workflow-source.mjs", () => {
    for (const p of ACTIVE_INTENTS_GRAPH_PATHS) {
      assert.ok(p.endsWith(".workflow-source.mjs"), `"${p}" should end with .workflow-source.mjs`);
    }
  });

  it("includes the mothership graph paths derived from basenames", () => {
    for (const name of ACTIVE_INTENTS_GRAPH_BASENAMES) {
      const family = name.startsWith("factory_supervisor_tick.") ? "dispatch-control" : "goal-execution";
      const expected = `factories/mothership/workflows/${family}/${name}`;
      assert.ok(
        ACTIVE_INTENTS_GRAPH_PATHS.includes(expected),
        `paths should contain "${expected}"`
      );
    }
  });

  it("includes capability-graph paths", () => {
    const capabilityPaths = ACTIVE_INTENTS_GRAPH_PATHS.filter((p) => p.startsWith("packages/"));
    assert.ok(capabilityPaths.length > 0, "should include at least one capability graph path");
  });

  it("has no duplicates", () => {
    const unique = new Set(ACTIVE_INTENTS_GRAPH_PATHS);
    assert.equal(unique.size, ACTIVE_INTENTS_GRAPH_PATHS.length);
  });

  it("all paths are relative (no leading slash)", () => {
    for (const p of ACTIVE_INTENTS_GRAPH_PATHS) {
      assert.ok(!p.startsWith("/"), `"${p}" should be a relative path`);
    }
  });

  it("graph files exist on disk (relative to repo root)", () => {
    for (const p of ACTIVE_INTENTS_GRAPH_PATHS) {
      const abs = resolve(REPO_ROOT, p);
      assert.ok(existsSync(abs), `graph file "${p}" should exist at ${abs}`);
    }
  });
});

describe("listActiveIntentGraphPaths", () => {
  it("returns a mutable copy of ACTIVE_INTENTS_GRAPH_PATHS with default args", () => {
    const result = listActiveIntentGraphPaths();
    assert.deepEqual(result, [...ACTIVE_INTENTS_GRAPH_PATHS]);
    assert.ok(!Object.isFrozen(result), "returned array should be mutable");
  });

  it("returned array is not the same reference as the constant", () => {
    const result = listActiveIntentGraphPaths();
    assert.notEqual(result, ACTIVE_INTENTS_GRAPH_PATHS);
  });

  it("returns default paths when graphsDir is explicitly the default", () => {
    const result = listActiveIntentGraphPaths({ graphsDir: "factories/mothership/workflows" });
    assert.deepEqual(result, [...ACTIVE_INTENTS_GRAPH_PATHS]);
  });

  it("uses custom graphsDir to construct paths from basenames only", () => {
    const result = listActiveIntentGraphPaths({ graphsDir: "custom/graphs/dir" });
    assert.equal(result.length, ACTIVE_INTENTS_GRAPH_BASENAMES.length);
    for (let i = 0; i < ACTIVE_INTENTS_GRAPH_BASENAMES.length; i++) {
      assert.equal(result[i], `custom/graphs/dir/${ACTIVE_INTENTS_GRAPH_BASENAMES[i]}`);
    }
  });

  it("custom graphsDir does NOT include capability paths", () => {
    const result = listActiveIntentGraphPaths({ graphsDir: "other/dir" });
    const capabilityPaths = result.filter((p) => p.startsWith("packages/"));
    assert.equal(capabilityPaths.length, 0, "custom graphsDir should not include capability paths");
  });

  it("handles empty string graphsDir by prepending empty prefix", () => {
    const result = listActiveIntentGraphPaths({ graphsDir: "" });
    for (const p of result) {
      assert.ok(p.startsWith("/") || p.includes("/"), `path "${p}" should have basename`);
    }
    assert.equal(result.length, ACTIVE_INTENTS_GRAPH_BASENAMES.length);
  });

  it("returns all basenames when using a custom dir", () => {
    const result = listActiveIntentGraphPaths({ graphsDir: "my-factory/graphs" });
    const returnedBasenames = result.map((p) => basename(p));
    assert.deepEqual(returnedBasenames, [...ACTIVE_INTENTS_GRAPH_BASENAMES]);
  });

  it("called with no arguments returns same as called with empty object", () => {
    const a = listActiveIntentGraphPaths();
    const b = listActiveIntentGraphPaths({});
    assert.deepEqual(a, b);
  });
});
