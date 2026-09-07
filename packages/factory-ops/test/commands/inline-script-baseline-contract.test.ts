import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const baselinePath = "scripts/dot-inline-script-ignore-baseline.json";

test("inline-script baseline contains no stale merge_item/wave_issue integration markers", () => {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const markers = Array.isArray(baseline.markers) ? baseline.markers : [];

  assert.ok(
    !markers.some((m) => m.file === "factories/mothership/graphs/merge_item.dot" && m.node_id === "integration"),
    "merge_item integration marker must be removed from baseline",
  );
  assert.ok(
    !markers.some((m) => m.file === "docs/contracts/workflow-ir/mothership/wave_issue_execute.dot" && m.node_id === "integration"),
    "stale wave_issue_execute integration marker must be removed from baseline",
  );
});

test("inline-script baseline cannot reintroduce example-trading wave graph markers", () => {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const markers = Array.isArray(baseline.markers) ? baseline.markers : [];
  const forbiddenReplayLabWaveFiles = new Set([
    "factories/example-trading/graphs/wave_execute.dot",
    "factories/example-trading/graphs/wave_issue_execute.dot",
  ]);

  assert.ok(
    !markers.some((m) => forbiddenReplayLabWaveFiles.has(String(m.file || ""))),
    "example-trading wave graph baseline markers must remain absent",
  );
});

test("inline-script baseline diff is clean after merge integration commandization", () => {
  const run = spawnSync("node", ["scripts/dot-lint.mjs", "--inline-script-baseline-diff"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stderr, /inline_script_debt_diff_summary[\s\S]*added=0\b/);
});
