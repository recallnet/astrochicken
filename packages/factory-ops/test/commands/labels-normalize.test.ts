import assert from "node:assert/strict";
import test from "node:test";

import {
  hasEscalationMarker,
  computeLabelsToRemove,
  normalizeIssueLabelList,
  normalizeAndEnsureIssueLabels,
} from "../../src/commands/labels-normalize.ts";

test("hasEscalationMarker detects explicit escalation markers", () => {
  assert.equal(hasEscalationMarker("INSTRUCTION_CONFLICT: blocked"), true);
  assert.equal(hasEscalationMarker("THRASH_NO_PROGRESS after retries"), true);
  assert.equal(hasEscalationMarker("normal blocked note"), false);
});

test("computeLabelsToRemove strips human labels by default", () => {
  const out = computeLabelsToRemove({
    labels: ["feature", "human", "awaiting-human"],
    allow: new Set(["feature", "human", "awaiting-human"]),
    markerText: "no escalation marker",
  });
  assert.deepEqual(out.sort(), ["awaiting-human", "human"]);
});

test("computeLabelsToRemove keeps human labels when escalation marker is present", () => {
  const out = computeLabelsToRemove({
    labels: ["feature", "human", "awaiting-human"],
    allow: new Set(["feature"]),
    markerText: "INSTRUCTION_CONFLICT unresolved",
  });
  assert.deepEqual(out, []);
});

test("computeLabelsToRemove removes non-allowlisted labels", () => {
  const out = computeLabelsToRemove({
    labels: ["feature", "noise"],
    allow: new Set(["feature"]),
    markerText: "",
  });
  assert.deepEqual(out, ["noise"]);
});

test("normalizeIssueLabelList trims, drops blanks, and preserves first-seen order", () => {
  const out = normalizeIssueLabelList(" bug, ,feature,bug,triaged,feature ");
  assert.deepEqual(out, ["bug", "feature", "triaged"]);
});

test("normalizeIssueLabelList handles null/malformed input safely", () => {
  assert.deepEqual(normalizeIssueLabelList(null), []);
  assert.deepEqual(normalizeIssueLabelList(undefined), []);
  assert.deepEqual(normalizeIssueLabelList(""), []);
});

test("normalizeIssueLabelList preserves unknown non-empty labels without denylist filtering", () => {
  const out = normalizeIssueLabelList("feature, custom-taxonomy-label ,feature");
  assert.deepEqual(out, ["feature", "custom-taxonomy-label"]);
});

test("computeLabelsToRemove preserves ready when in allowlist", () => {
  const allow = new Set(["goal", "feature", "ready"]);
  const out = computeLabelsToRemove({
    labels: ["goal", "ready"],
    allow,
    markerText: "",
  });
  assert.deepEqual(out, []);
});

test("computeLabelsToRemove strips ready when NOT in allowlist", () => {
  const allow = new Set(["goal", "feature"]);
  const out = computeLabelsToRemove({
    labels: ["goal", "ready"],
    allow,
    markerText: "",
  });
  assert.deepEqual(out, ["ready"]);
});

test("computeLabelsToRemove handles non-array labels input safely", () => {
  const out = computeLabelsToRemove({
    labels: "feature",
    allow: new Set(["feature"]),
    markerText: "",
  });
  assert.deepEqual(out, []);
});

test("normalizeAndEnsureIssueLabels supports non-function createLabel when no labels are provided", () => {
  const out = normalizeAndEnsureIssueLabels({
    repo: "recallnet/astrochicken",
    labelsRaw: "",
    createLabel: null,
  });
  assert.equal(out, "");
});

test("normalizeAndEnsureIssueLabels returns deterministic comma-joined output and non-fatal create parity", () => {
  const calls = [];
  const out = normalizeAndEnsureIssueLabels({
    repo: "recallnet/astrochicken",
    labelsRaw: "bug,bug,feature",
    createLabel: ({ label }) => {
      calls.push(label);
      if (label === "feature") throw new Error("simulated create error");
      return false;
    },
  });

  assert.equal(out, "bug,feature");
  assert.deepEqual(calls, ["bug", "feature"]);
});
