import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoPath = "factories/example-web/skills/code_review/REPO.md";
const repoRules = readFileSync(repoPath, "utf8");

test("example-web code review addendum defines design-authority escalation", () => {
  assert.match(repoRules, /^## Design authority and escalation/m);
  assert.match(repoRules, /AGENTS\.md/);
  assert.match(repoRules, /AGENT-LEARNINGS\.md/);
  assert.match(repoRules, /Human design-owner escalation/);
});

test("example-web code review addendum keeps visual/refinement adversarial checks", () => {
  assert.match(repoRules, /^## Visual\/refinement non-regression requirements/m);
  assert.match(repoRules, /Framer Motion \/ pan-zoom/);
  assert.match(repoRules, /scenario alignment to shrink-wrapped visual scenarios/);
  assert.match(repoRules, /^## Adversarial review persistence/m);
  assert.match(repoRules, /Do not waive adversarial checks/);
});

test("example-web code review addendum requires QA command and generated artifact evidence", () => {
  assert.match(repoRules, /^## Generated artifact checklist \(mandatory when touched\)/m);
  assert.match(repoRules, /`npm run qa`/);
  assert.match(repoRules, /generated API bundle outputs/);
  assert.match(repoRules, /data\//);
});
