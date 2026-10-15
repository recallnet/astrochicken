import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const skillsRoot = new URL("../skills/", import.meta.url).pathname;

// --- Red Strategist ---

test("red strategist skill has identity, decision criteria, and termination rules", () => {
  const skill = read(`${skillsRoot}/red_strategist/SKILL.md`);

  // Identity section
  assert.match(skill, /identity|purpose/i, "should have identity/purpose section");

  // Decision criteria for challenging proposals
  assert.match(
    skill,
    /decision.criteria|evaluation.criteria|challenge.criteria|how.to.evaluate/i,
    "should have explicit decision/evaluation criteria"
  );

  // Termination decision rules
  assert.match(
    skill,
    /when.to.terminate|termination.criteria|terminate.*true|convergence/i,
    "should have termination decision guidance"
  );

  // Anti-patterns or boundaries
  assert.match(
    skill,
    /anti.?pattern|do.not|avoid|boundar/i,
    "should have anti-patterns or boundaries"
  );
});

test("red strategist skill has output contract with field descriptions", () => {
  const skill = read(`${skillsRoot}/red_strategist/SKILL.md`);
  assert.match(skill, /position/, "output contract should describe position field");
  assert.match(skill, /recommended_changes/, "output contract should describe recommended_changes field");
  assert.match(skill, /risks/, "output contract should describe risks field");
  assert.match(skill, /terminate/, "output contract should describe terminate field");
});

// --- Blue Strategist ---

test("blue strategist skill has identity, synthesis criteria, and termination rules", () => {
  const skill = read(`${skillsRoot}/blue_strategist/SKILL.md`);

  assert.match(skill, /identity|purpose/i, "should have identity/purpose section");

  assert.match(
    skill,
    /decision.criteria|synthesis.criteria|how.to.synthesize|evaluation/i,
    "should have synthesis/decision criteria"
  );

  assert.match(
    skill,
    /when.to.terminate|termination.criteria|terminate.*true|convergence/i,
    "should have termination decision guidance"
  );

  assert.match(
    skill,
    /anti.?pattern|do.not|avoid|boundar/i,
    "should have anti-patterns or boundaries"
  );
});

test("blue strategist skill has output contract with field descriptions", () => {
  const skill = read(`${skillsRoot}/blue_strategist/SKILL.md`);
  assert.match(skill, /proposal/, "output contract should describe proposal field");
  assert.match(skill, /success_criteria/, "output contract should describe success_criteria field");
  assert.match(skill, /scope_in/, "output contract should describe scope_in field");
  assert.match(skill, /scope_out/, "output contract should describe scope_out field");
  assert.match(skill, /terminate/, "output contract should describe terminate field");
});

// --- Brainstorm Supervisor ---

test("brainstorm supervisor skill has error handling and failure routing", () => {
  const skill = read(`${skillsRoot}/runtime/brainstorm_supervisor_review/SKILL.md`);

  assert.match(
    skill,
    /error|failure|malformed|missing|invalid/i,
    "should describe error/failure handling"
  );

  assert.match(
    skill,
    /context.*fail|resolve.*fail|missing.*context|context.*missing/i,
    "should handle context resolution failures"
  );
});

test("brainstorm supervisor skill has deterministic routing decision tree", () => {
  const skill = read(`${skillsRoot}/runtime/brainstorm_supervisor_review/SKILL.md`);

  // Should have clear decision routing
  assert.match(
    skill,
    /no.issue|issue.present|no.*brainstorm|zero/i,
    "should describe no-issue routing"
  );

  assert.match(
    skill,
    /preflight|validation|check/i,
    "should describe preflight validation"
  );
});

test("brainstorm supervisor skill references ops commands it uses", () => {
  const skill = read(`${skillsRoot}/runtime/brainstorm_supervisor_review/SKILL.md`);
  assert.match(skill, /resolve-.*context|resolve-intent-stack/i, "should reference context resolution commands");
  assert.match(skill, /next-issue|brainstorm.*next/i, "should reference brainstorm intake command");
});

// --- Research Supervisor (stub check) ---

test("research supervisor skill is an acknowledged placeholder", () => {
  const skill = read(`${skillsRoot}/runtime/research_supervisor_review/SKILL.md`);
  // It's a known stub - just verify it exists and states it's a placeholder
  assert.match(skill, /placeholder|stub|bootstrap/i, "should acknowledge placeholder status");
});
