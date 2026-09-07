import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const timeoutLog = readFileSync("packages/factory-ops/test/fixtures/regressions/supervisor-review-timeout.log", "utf8");
const scopeMismatchComment = readFileSync("packages/factory-ops/test/fixtures/regressions/review-scope-mismatch.comment.txt", "utf8");

test("regression fixture: detects supervisor fast-review timeout signature", () => {
  assert.match(timeoutLog, /supervisor_review_bug_fast/);
  assert.match(timeoutLog, /timed out after 600000ms/);
});

test("regression fixture: detects scope mismatch signature for wave issue review", () => {
  assert.match(scopeMismatchComment, /Scope mismatch for #560/);
  assert.match(scopeMismatchComment, /wiring remediation into the supervisor tick graph/);
});
