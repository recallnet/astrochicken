import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const codeReviewRepoPath = join("factories", "example-web", "skills", "code_review", "REPO.md");
const supervisorRulesPath = join("factories", "example-web", "skills", "supervisor_rules.md");

// @context:regression !critical issue #2574 removes example-web-local supervisor rules so shared supervisor skill remains the single owner; code-review REPO addendum must still exist.
test("example-web keeps repo-specific code review guidance and has no local supervisor rules addendum", () => {
  assert.equal(existsSync(codeReviewRepoPath), true, "factories/example-web/skills/code_review/REPO.md must exist");
  assert.equal(existsSync(supervisorRulesPath), false, "factories/example-web/skills/supervisor_rules.md must not exist");

  const repoRules = readFileSync(codeReviewRepoPath, "utf8");
  assert.match(repoRules, /^# Repo-Specific Code Review Addendum \(example-web\)/m);
  assert.match(repoRules, /Human design-owner escalation/);
  assert.match(repoRules, /Do not waive adversarial checks/);
});
