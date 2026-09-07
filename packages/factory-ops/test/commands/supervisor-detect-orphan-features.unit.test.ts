import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyFeatureOwnership,
  identifyOrphanFeatures,
  fixOrphanFeatures,
} from "../../src/commands/supervisor-detect-orphan-features.ts";

describe("classifyFeatureOwnership", () => {
  it("returns goal_sub_issue when feature number is in goalSubIssueNumbers", () => {
    const feature = { number: 2463, title: "Some feature", body: "" };
    const result = classifyFeatureOwnership(feature, {
      goalSubIssueNumbers: new Set([2463, 2464, 2465]),
    });
    assert.equal(result.orphaned, false);
    assert.equal(result.classification, "goal_sub_issue");
  });

  it("returns missing_parent_evidence when feature has no body text and is NOT in goalSubIssueNumbers", () => {
    const feature = { number: 2463, title: "Some feature", body: "" };
    const result = classifyFeatureOwnership(feature, {
      goalSubIssueNumbers: new Set(),
    });
    assert.equal(result.orphaned, true);
    assert.equal(result.classification, "missing_parent_evidence");
  });
});

describe("identifyOrphanFeatures", () => {
  it("excludes features that are native sub-issues via goalSubIssueNumbers", () => {
    const features = [
      { number: 2463, title: "Feature A", body: "", url: "u1" },
      { number: 2464, title: "Feature B", body: "", url: "u2" },
      { number: 9999, title: "True orphan", body: "", url: "u3" },
    ];
    const orphans = identifyOrphanFeatures(features, {
      goalSubIssueNumbers: new Set([2463, 2464]),
    });
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].number, 9999);
  });

  it("flags all features as orphans when goalSubIssueNumbers is empty and no body evidence", () => {
    const features = [
      { number: 2463, title: "Feature A", body: "", url: "u1" },
      { number: 2464, title: "Feature B", body: "", url: "u2" },
    ];
    const orphans = identifyOrphanFeatures(features);
    assert.equal(orphans.length, 2);
  });
});

describe("fixOrphanFeatures — goalSubIssueNumbers integration", () => {
  it("uses goalSubIssueNumbers from goal sub-issues API to avoid false positive orphans", () => {
    const ghJsonFn = (args) => {
      const cmd = args.join(" ");
      if (cmd.includes("feature") && cmd.includes("--state") && cmd.includes("open")) {
        return [
          { number: 2463, title: "Feature A", body: "", url: "u1", labels: [] },
          { number: 2464, title: "Feature B", body: "", url: "u2", labels: [] },
          { number: 9999, title: "True orphan", body: "", url: "u3", labels: [] },
        ];
      }
      if (cmd.includes("goal") && cmd.includes("--state") && cmd.includes("open")) {
        return [{ number: 100, title: "Goal 100", body: "" }];
      }
      if (cmd.includes("goal") && cmd.includes("--state") && cmd.includes("closed")) {
        return [];
      }
      if (cmd.includes("milestones")) return [];
      return [];
    };

    const ghPaginatedFn = (url) => {
      if (url.includes("/issues/100/sub_issues")) {
        return [
          { number: 2463, title: "Feature A", state: "open", labels: [] },
          { number: 2464, title: "Feature B", state: "open", labels: [] },
        ];
      }
      return [];
    };

    const ghFn = () => ({ ok: true, stdout: "", stderr: "" });

    const result = fixOrphanFeatures({
      repo: "test/repo",
      ghJsonFn,
      ghFn,
      ghPaginatedFn,
    });

    // With the fix: only #9999 should be an orphan (2463/2464 are sub-issues of goal #100)
    assert.equal(result.ok, true);
    assert.equal(result.orphan_count, 1);
    assert.equal(result.bugs.length, 1);
    assert.equal(result.bugs[0].number, 9999);
  });

  it("includes sub-issues of closed goals to avoid false orphan classification", () => {
    const ghJsonFn = (args) => {
      const cmd = args.join(" ");
      if (cmd.includes("feature") && cmd.includes("--state") && cmd.includes("open")) {
        return [
          { number: 1484, title: "Recovery feature", body: "", url: "u1", labels: [] },
          { number: 1485, title: "Parity feature", body: "", url: "u2", labels: [] },
        ];
      }
      // No open goals
      if (cmd.includes("goal") && cmd.includes("--state") && cmd.includes("open")) {
        return [];
      }
      // One closed goal that owns these features
      if (cmd.includes("goal") && cmd.includes("--state") && cmd.includes("closed")) {
        return [{ number: 1403, title: "Goal 1403", body: "" }];
      }
      if (cmd.includes("milestones")) return [];
      return [];
    };

    const ghPaginatedFn = (url) => {
      if (url.includes("/issues/1403/sub_issues")) {
        return [
          { number: 1484, title: "Recovery feature", state: "open", labels: [] },
          { number: 1485, title: "Parity feature", state: "open", labels: [] },
        ];
      }
      return [];
    };

    const ghFn = () => ({ ok: true, stdout: "", stderr: "" });

    const result = fixOrphanFeatures({
      repo: "test/repo",
      ghJsonFn,
      ghFn,
      ghPaginatedFn,
    });

    // Both features are sub-issues of closed goal #1403 — NOT orphans
    assert.equal(result.ok, true);
    assert.equal(result.orphan_count, 0,
      "features of closed goals must not be classified as orphans");
  });
});
