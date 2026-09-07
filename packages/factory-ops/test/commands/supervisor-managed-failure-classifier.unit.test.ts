import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyManagedFailure } from "../../src/commands/supervisor-managed-failure-classifier.ts";

describe("classifyManagedFailure", () => {
  it("returns none when no errors and gate is run", () => {
    const result = classifyManagedFailure({ domainError: "", parseError: "", gate: "run" });
    assert.strictEqual(result.failure_classification, "none");
    assert.strictEqual(result.failure_reason, "");
  });

  it("returns none when all inputs are empty", () => {
    const result = classifyManagedFailure({});
    assert.strictEqual(result.failure_classification, "none");
  });

  it("returns infrastructure for upstream error with run gate", () => {
    const result = classifyManagedFailure({ domainError: "upstream_failed", gate: "run" });
    assert.strictEqual(result.failure_classification, "infrastructure");
  });

  it("returns local for domain_graph error", () => {
    const result = classifyManagedFailure({ domainError: "domain_graph_failed" });
    assert.strictEqual(result.failure_classification, "local");
  });

  it("returns ambiguous for unknown domain error", () => {
    const result = classifyManagedFailure({ domainError: "child_failed" });
    assert.strictEqual(result.failure_classification, "ambiguous");
  });

  it("returns infrastructure for gh_issue_list_failed", () => {
    const result = classifyManagedFailure({ domainError: "gh_issue_list_failed" });
    assert.strictEqual(result.failure_classification, "infrastructure");
  });

  it("includes gate in failure_reason when domain error is present", () => {
    const result = classifyManagedFailure({ domainError: "child_failed", gate: "run" });
    assert.ok(result.failure_reason.includes("run"));
    assert.ok(result.failure_reason.includes("child_failed"));
  });
});
