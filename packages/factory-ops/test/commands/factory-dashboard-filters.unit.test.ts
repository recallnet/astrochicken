import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compactGraphLabel,
  normalizeDashboardFilters,
  normalizeRunIdentity,
  withRunIdentity,
  applyDashboardFiltersToTabs,
} from "../../src/commands/factory-dashboard-filters.ts";

describe("compactGraphLabel", () => {
  it("extracts filename from full path", () => {
    assert.equal(compactGraphLabel("factories/mothership/graphs/tick.dot"), "tick.dot");
  });

  it("returns already-compact label unchanged", () => {
    assert.equal(compactGraphLabel("tick.dot"), "tick.dot");
  });

  it("returns empty string for empty input", () => {
    assert.equal(compactGraphLabel(""), "");
  });

  it("normalizes backslashes and extracts filename", () => {
    assert.equal(compactGraphLabel("path\\with\\backslashes\\file.dot"), "file.dot");
  });

  it("handles null/undefined gracefully", () => {
    assert.equal(compactGraphLabel(null), "");
    assert.equal(compactGraphLabel(undefined), "");
  });
});

describe("normalizeDashboardFilters", () => {
  it("returns defaults for empty input", () => {
    assert.deepEqual(normalizeDashboardFilters(), {
      run_id: "",
      graph: "",
      node: "",
      issue: null,
    });
  });

  it("returns defaults for null input", () => {
    assert.deepEqual(normalizeDashboardFilters(null), {
      run_id: "",
      graph: "",
      node: "",
      issue: null,
    });
  });

  it("populates all fields and compacts graph", () => {
    const result = normalizeDashboardFilters({
      run_id: "abc-123",
      graph: "factories/mothership/graphs/tick.dot",
      node: "build",
      issue: "42",
    });
    assert.deepEqual(result, {
      run_id: "abc-123",
      graph: "tick.dot",
      node: "build",
      issue: 42,
    });
  });

  it("strips # from issue number", () => {
    const result = normalizeDashboardFilters({ issue: "#42" });
    assert.equal(result.issue, 42);
  });

  it("returns null for invalid issue", () => {
    const result = normalizeDashboardFilters({ issue: "invalid" });
    assert.equal(result.issue, null);
  });

  it("accepts runId as camelCase alias for run_id", () => {
    const result = normalizeDashboardFilters({ runId: "my-run" });
    assert.equal(result.run_id, "my-run");
  });

  it("trims whitespace from string fields", () => {
    const result = normalizeDashboardFilters({
      run_id: "  abc  ",
      graph: "  tick.dot  ",
      node: "  build  ",
    });
    assert.equal(result.run_id, "abc");
    assert.equal(result.graph, "tick.dot");
    assert.equal(result.node, "build");
  });
});

describe("normalizeRunIdentity", () => {
  it("returns null when no fields are set", () => {
    assert.equal(normalizeRunIdentity({}), null);
    assert.equal(normalizeRunIdentity(), null);
  });

  it("returns null for null/non-object input", () => {
    assert.equal(normalizeRunIdentity(null), null);
    assert.equal(normalizeRunIdentity("string"), null);
  });

  it("returns full identity with compacted graph", () => {
    const result = normalizeRunIdentity({
      run_id: "run-1",
      graph: "factories/mothership/graphs/tick.dot",
      node: "build",
      issue_number: "42",
    });
    assert.deepEqual(result, {
      run_id: "run-1",
      graph: "tick.dot",
      node: "build",
      issue_number: 42,
    });
  });

  it("returns non-null with only run_id set", () => {
    const result = normalizeRunIdentity({ run_id: "run-1" });
    assert.deepEqual(result, {
      run_id: "run-1",
      graph: "",
      node: "",
      issue_number: null,
    });
  });

  it("returns null issue_number for zero or negative", () => {
    assert.equal(normalizeRunIdentity({ run_id: "r", issue_number: "0" }).issue_number, null);
    assert.equal(normalizeRunIdentity({ run_id: "r", issue_number: "-5" }).issue_number, null);
  });

  it("accepts issue as alias for issue_number", () => {
    const result = normalizeRunIdentity({ run_id: "r", issue: "99" });
    assert.equal(result.issue_number, 99);
  });

  it("accepts runId camelCase alias", () => {
    const result = normalizeRunIdentity({ runId: "camel-run" });
    assert.equal(result.run_id, "camel-run");
  });
});

describe("withRunIdentity", () => {
  it("attaches runIdentity to row", () => {
    const row = { status: "ok" };
    const identity = { run_id: "run-1", graph: "tick.dot" };
    const result = withRunIdentity(row, identity);
    assert.equal(result.status, "ok");
    assert.deepEqual(result.runIdentity, {
      run_id: "run-1",
      graph: "tick.dot",
      node: "",
      issue_number: null,
    });
  });

  it("sets runIdentity to null when identity is null", () => {
    const result = withRunIdentity({ x: 1 }, null);
    assert.equal(result.runIdentity, null);
  });

  it("preserves existing row fields", () => {
    const row = { a: 1, b: 2, c: 3 };
    const result = withRunIdentity(row, null);
    assert.equal(result.a, 1);
    assert.equal(result.b, 2);
    assert.equal(result.c, 3);
  });
});

describe("applyDashboardFiltersToTabs", () => {
  const makeTabs = (rows) => [{ name: "tab1", rows }];

  it("returns tabs unchanged when no filters active", () => {
    const tabs = makeTabs([{ issue: "10" }, { issue: "20" }]);
    const result = applyDashboardFiltersToTabs(tabs, {});
    assert.equal(result[0].rows.length, 2);
  });

  it("filters by run_id", () => {
    const tabs = makeTabs([
      { runIdentity: { run_id: "run-a", graph: "", node: "" } },
      { runIdentity: { run_id: "run-b", graph: "", node: "" } },
    ]);
    const result = applyDashboardFiltersToTabs(tabs, { run_id: "run-a" });
    assert.equal(result[0].rows.length, 1);
    assert.equal(result[0].rows[0].runIdentity.run_id, "run-a");
  });

  it("filters by graph", () => {
    const tabs = makeTabs([
      { runIdentity: { run_id: "r", graph: "factories/m/tick.dot", node: "" } },
      { runIdentity: { run_id: "r", graph: "factories/m/wave.dot", node: "" } },
    ]);
    const result = applyDashboardFiltersToTabs(tabs, { graph: "tick.dot" });
    assert.equal(result[0].rows.length, 1);
  });

  it("filters by issue matching across ref fields", () => {
    const tabs = makeTabs([
      { issue: "42" },
      { refs: { issue_number: "42" } },
      { refs: { goal_number: "42" } },
      { refs: { goal_issue_number: "99" } },
      { issue: "10" },
    ]);
    const result = applyDashboardFiltersToTabs(tabs, { issue: 42 });
    assert.equal(result[0].rows.length, 3);
  });

  it("applies AND logic for multiple filters", () => {
    const tabs = makeTabs([
      { runIdentity: { run_id: "run-a", graph: "tick.dot", node: "" }, issue: "42" },
      { runIdentity: { run_id: "run-a", graph: "wave.dot", node: "" }, issue: "42" },
      { runIdentity: { run_id: "run-b", graph: "tick.dot", node: "" }, issue: "42" },
    ]);
    const result = applyDashboardFiltersToTabs(tabs, { run_id: "run-a", graph: "tick.dot" });
    assert.equal(result[0].rows.length, 1);
    assert.equal(result[0].rows[0].runIdentity.run_id, "run-a");
  });

  it("returns empty rows for empty tabs", () => {
    const result = applyDashboardFiltersToTabs([], { run_id: "x" });
    assert.deepEqual(result, []);
  });

  it("preserves tab structure while filtering rows", () => {
    const tabs = [
      { name: "t1", rows: [{ issue: "10" }] },
      { name: "t2", rows: [{ issue: "20" }] },
    ];
    const result = applyDashboardFiltersToTabs(tabs, { issue: 10 });
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "t1");
    assert.equal(result[0].rows.length, 1);
    assert.equal(result[1].name, "t2");
    assert.equal(result[1].rows.length, 0);
  });
});
