import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/write_issues.dot";

test("write_issues sanitizes collected issue URLs before exporting them", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /typed_action_transport_mode = "enforced"/);
  assert.match(dot, /sanitize_issue_urls\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.normalize_issue_urls"/);
  assert.match(dot, /action_value="\$\{issue_urls\}"/);
  assert.match(dot, /start -> fan_out -> fan_in -> sanitize_issue_urls -> done/);
});
