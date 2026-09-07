import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot";

test("goal_issue_execute routes build failures to report_build_failed (not commit_push)", () => {
  const dot = readFileSync(dotPath, "utf8");

  // The build node MUST have a conditional success edge to assert_main_after_build
  assert.match(
    dot,
    /build\s*->\s*assert_main_after_build\s*\[condition="outcome=success"\]/,
    "build -> assert_main_after_build must be conditioned on outcome=success",
  );

  // The build node MUST have a failure edge to report_build_failed
  assert.match(
    dot,
    /build\s*->\s*report_build_failed\s*\[condition="outcome!=success"\]/,
    "build -> report_build_failed must exist for outcome!=success",
  );
});

test("goal_issue_execute assert_main_after_build still routes failures to report_build_failed", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(
    dot,
    /assert_main_after_build\s*->\s*commit_push\s*\[condition="ok=true"\]/,
    "assert_main_after_build -> commit_push conditioned on ok=true",
  );
  assert.match(
    dot,
    /assert_main_after_build\s*->\s*report_build_failed\s*\[condition="ok!=true"\]/,
    "assert_main_after_build -> report_build_failed conditioned on ok!=true",
  );
});
