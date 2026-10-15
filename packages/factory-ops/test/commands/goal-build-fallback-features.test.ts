import assert from "node:assert/strict";
import test from "node:test";

import { fallbackJson, countJsonItems, resolveBootstrapAcceptanceCriteria } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";

const BOOTSTRAP_CRITERIA_1 = [
  "A single executable feature issue is created from fallback decomposition output.",
  "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."
];

const BOOTSTRAP_CRITERIA_2 = [
  "A single executable feature issue is created from fallback decomposition output.",
  "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
  "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
  "Goal processing continues into write_issues/triage without manual intervention."
];

const BOOTSTRAP_CRITERIA_3 = [
  "A single executable feature issue is created from fallback decomposition output.",
  "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
  "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."
];

function registerFallbackDeterminismCase(name, input) {
  test(name, () => {
    assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
  });
}

function registerFallbackIdentityCase(name, input, expectedIdentity, verifyAdditional = () => {}) {
  test(name, () => {
    const out = JSON.parse(buildFallbackFeatures(input));
    assertFallbackIdentity(out, expectedIdentity);
    verifyAdditional(out);
  });
}

registerFallbackIdentityCase("buildFallbackFeatures returns judge reliability bootstrap slice for goal #213", {
    goalIssueRaw: JSON.stringify({
      number: 213,
      title: "Goal: Judge Reliability Contract (scenario selection + verdict determinism)",
      body: "Need deterministic decomposition fallback for judge reliability contract continuity.",
    }),
  }, { array: true, length: 1, id: "F-1", slug: "judge-reliability-contract-fallback-bootstrap", domain: "judge-reliability-contract" }, (out) => {
assert.match(out[0].summary, /scenario selection/i);
assert.match(out[0].summary, /verdict determinism/i);
assert.equal(out[0].acceptance_criteria.length, 4);
});

registerFallbackIdentityCase("buildFallbackFeatures returns trust tuple bootstrap slice for goal #320", {
    goalIssueRaw: JSON.stringify({
      number: 320,
      title: "Goal: Trust Tuple Identity fallback",
      body: "Need deterministic decomposition fallback for tuple identity.",
    }),
  }, { array: true, length: 1, id: "F-1", slug: "trust-tuple-identity-fallback-bootstrap", domain: "trust-tuple-identity" }, (out) => {
assert.match(out[0].summary, /intent release × model × agent type\/version/);
});

registerFallbackIdentityCase("buildFallbackFeatures routes goal-number-only trust tuple fallback for goal #547", {
    goalIssueRaw: "{broken",
    goalNumber: "547",
  }, { array: true, length: 1, id: "F-1", slug: "trust-tuple-identity-fallback-bootstrap", domain: "trust-tuple-identity" }, (out) => {
assert.match(out[0].summary, /intent release × model × agent type\/version/);
});

registerFallbackDeterminismCase("buildFallbackFeatures judge reliability output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 213,
      title: "Goal: Judge Reliability Contract (scenario selection + verdict determinism)",
      body: "Need deterministic decomposition fallback for judge reliability contract continuity.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures trust tuple output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 320,
      title: "Goal: Trust Tuple Identity fallback",
      body: "Need deterministic decomposition fallback for tuple identity.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #547 trust tuple output is deterministic", {
    goalIssueRaw: "{broken",
    goalNumber: "547",
  });

registerFallbackIdentityCase("buildFallbackFeatures returns Layer 2 DOT conditional edge fallback slice for goal #484", {
    goalIssueRaw: JSON.stringify({
      number: 484,
      title: "Goal: Layer 2 DOT Conditional Edge Path Coverage Gate",
      body: "Need deterministic decomposition fallback continuity when output is malformed or empty.",
    }),
  }, { array: true, length: 1, id: "F-1", slug: "dot-conditional-edge-path-coverage-fallback-bootstrap", domain: "dot-conditional-edge-coverage" }, (out) => {
assert.equal(
    out[0].acceptance_criteria.some((entry) => /malformed or empty/i.test(entry)),
    true,
  );
assert.equal(
    out[0].acceptance_criteria.some((entry) => /write_issues\/triage/i.test(entry)),
    true,
  );
});

registerFallbackDeterminismCase("buildFallbackFeatures Layer 2 DOT fallback output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 484,
      title: "Goal: Layer 2 DOT Conditional Edge Path Coverage Gate",
      body: "Need deterministic decomposition fallback continuity when output is malformed or empty.",
    }),
  });

registerFallbackIdentityCase("buildFallbackFeatures returns one deterministic executable fallback feature for goal #328", {
    goalIssueRaw: JSON.stringify({ number: 328, title: "Goal: decomposition continuity" }),
  }, { array: true, length: 1, id: "F-1", name: "decomposition continuity", domain: "goal-decomposition", slug: "goal-328-decomposition-continuity" }, (out) => {
assert.match(out[0].summary, /goal #328/);
assert.match(out[0].scope, /In scope:/);
assert.deepEqual(out[0].dependencies, []);
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_1);
});

registerFallbackIdentityCase("buildFallbackFeatures emits bootstrap decomposition scaffold for goal #336 continuity", {
    goalIssueRaw: JSON.stringify({ number: 336, title: "Goal: decomposition continuity" }),
  }, { length: 1, name: "decomposition continuity", slug: "goal-336-decomposition-continuity" }, (out) => {
assert.match(out[0].summary, /goal #336/);
assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #203 deterministic bootstrap decomposition scaffold", {
    goalIssueRaw: JSON.stringify({ number: 203, title: "Goal: Bootstrap decomposition continuity" }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #203)", domain: "goal-decomposition", slug: "goal-203-bootstrap-feature-1" }, (out) => {
assert.equal(out[0].acceptance_criteria.length, 4);
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_2);
});

registerFallbackIdentityCase("buildFallbackFeatures routes title/body-only goal #203 context to deterministic bootstrap scaffold", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap deterministic decomposition continuity for goal #203",
      body: "Goal #203 fallback must preserve write_issues/triage continuity.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #203)", slug: "goal-203-bootstrap-feature-1", domain: "goal-decomposition" }, (out) => {
assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

registerFallbackIdentityCase("buildFallbackFeatures routes goal #214 scaffold from explicit goalNumber hint when goal issue payload is malformed", {
    goalIssueRaw: "{broken",
    goalNumber: "214",
  }, { length: 1, name: "Bootstrap decomposition feature 1 (goal #214)", slug: "goal-214-bootstrap-feature-1" }, (out) => {
assert.equal(out[0].acceptance_criteria.length, 4);
assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

registerFallbackIdentityCase("buildFallbackFeatures goalNumber override wins over conflicting payload number for deterministic routing", {
    goalIssueRaw: JSON.stringify({
      number: 999,
      title: "Goal: End-to-End Feedback Loop Harnesses (Review, Judge, Conflict, Artifact)",
      body: "Need deterministic continuity so review/judge/conflict/artifact loops still hand off to write_issues and triage.",
    }),
    goalNumber: "214",
  }, { length: 1, name: "Bootstrap decomposition feature 1 (goal #214)", slug: "goal-214-bootstrap-feature-1" }, (out) => {
assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

registerFallbackIdentityCase("buildFallbackFeatures does not route goal #214 signature when explicit non-214 number is present", {
    goalIssueRaw: JSON.stringify({
      number: 337,
      title: "Goal #337 follow-up references goal #203 fallback notes",
      body: "Contains context about goal #203 but should still route by explicit goal number.",
    }),
  }, { length: 1, id: "F-1", slug: "goal-337-bootstrap-feature-1" }, (out) => {
assert.match(out[0].summary, /This feature turns that scaffold into a single executable feature issue/i);
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #337 deterministic bootstrap decomposition scaffold", {
    goalIssueRaw: JSON.stringify({ number: 337, title: "Goal: Bootstrap decomposition feature continuity" }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #337)", domain: "goal-decomposition", slug: "goal-337-bootstrap-feature-1" }, (out) => {
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_2);
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #354 deterministic bootstrap decomposition scaffold", {
    goalIssueRaw: JSON.stringify({ number: 354, title: "Goal: Bootstrap decomposition continuity fallback scaffold" }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #354)", domain: "goal-decomposition", slug: "goal-354-bootstrap-feature-1" }, (out) => {
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_2);
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #353 deterministic decomposition continuity scaffold", {
    goalIssueRaw: JSON.stringify({
      number: 353,
      title: "Goal: Bootstrap decomposition deterministic continuity",
      body: "Need deterministic fallback scaffold when decomposition output is malformed or empty.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #353)", domain: "goal-decomposition", slug: "goal-353-bootstrap-feature-1" }, (out) => {
assert.match(out[0].summary, /execution continuity/i);
assert.equal(out[0].acceptance_criteria.length, 4);
});

registerFallbackIdentityCase("buildFallbackFeatures routes to goal #354 scaffold when issue number is missing but title/body reference goal #354", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback scaffold continuity for goal #354",
      body: "Keep deterministic fallback scaffold behavior for goal #354 when decomposition output is malformed or empty.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #354)", slug: "goal-354-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures routes to goal #353 scaffold when issue number is missing but title/body reference goal #353", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #353",
      body: "Keep fallback deterministic for goal #353 when decomposition output is malformed or empty.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #353)", slug: "goal-353-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures emits goal #321 deterministic decomposition continuity scaffold", {
    goalIssueRaw: JSON.stringify({
      number: 321,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should keep deterministic downstream handoff.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", domain: "goal-decomposition", slug: "goal-321-bootstrap-feature-1" }, (out) => {
assert.match(out[0].summary, /malformed or empty/i);
});

registerFallbackDeterminismCase("buildFallbackFeatures goal #321 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 321,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should keep deterministic downstream handoff.",
    }),
  });

registerFallbackIdentityCase("buildFallbackFeatures emits goal #322 deterministic decomposition continuity scaffold", {
    goalIssueRaw: JSON.stringify({
      number: 322,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Malformed or empty decomposition output should not block downstream issue-writing and triage.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #322)", slug: "goal-322-bootstrap-feature-1", domain: "goal-decomposition" }, (out) => {
assert.match(out[0].summary, /deterministic fallback path/i);
assert.equal(out[0].acceptance_criteria.length, 4);
assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

registerFallbackDeterminismCase("buildFallbackFeatures goal #322 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 322,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should preserve deterministic handoff when decomposition output is malformed or empty.",
    }),
  });

registerFallbackIdentityCase("buildFallbackFeatures routes to goal #322 scaffold when issue number is missing but title/body reference goal #322", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #322",
      body: "Keep fallback deterministic for goal #322 when decomposition output is malformed or empty.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #322)", slug: "goal-322-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures routes to goal #321 scaffold when issue number is missing but title/body reference goal #321", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Keep fallback deterministic for goal #321 when decomposition output is malformed or empty.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures does not override non-321 numeric goal routing when title references goal #321", {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "This issue depends on goal #321 but is still goal #456.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #456)", slug: "goal-456-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures derives goal number hint from title/body when issue number is missing", {
    goalIssueRaw: JSON.stringify({
      title: "Goal #329: bootstrap decomposition continuity",
      body: "Fallback continuity should stay deterministic for goal #329.",
    }),
  }, { length: 1, id: "F-1", name: "bootstrap decomposition continuity", slug: "goal-329-bootstrap-decomposition-continuity", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures derives dashed goal-number hint from title/body when issue number is missing", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: bootstrap decomposition continuity for goal-321",
      body: "Fallback continuity should stay deterministic for goal-321.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures keeps numeric goal routing authoritative over dashed goal hint", {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up references goal-321",
      body: "Numeric goal context must stay authoritative over dashed hint forms.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #456)", slug: "goal-456-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures ignores malformed issue number and derives goal hint deterministically", {
    goalIssueRaw: JSON.stringify({
      number: "not-a-number",
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Fallback path should still target goal #321 deterministically.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures ignores malformed goalNumber override and keeps numeric issue routing", {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "Numeric issue number should remain authoritative when override is malformed.",
    }),
    goalNumber: "goal-321",
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #456)", slug: "goal-456-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures honors goalNumber override for deterministic goal #321 routing", {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "This issue depends on goal #321 but context issue number should drive routing.",
    }),
    goalNumber: "321",
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });

test("buildFallbackFeatures canonicalizes zero-padded goal numbers for deterministic goal #321 routing", () => {
  const byOverride = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 456, title: "Goal #456" }),
    goalNumber: "00321",
  }));
  const byIssue = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: "00321",
      title: "Goal: Bootstrap deterministic decomposition continuity",
    }),
  }));

  assert.equal(byOverride[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(byOverride[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(byIssue[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(byIssue[0].slug, "goal-321-bootstrap-feature-1");
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #456 deterministic bootstrap decomposition scaffold", {
    goalIssueRaw: JSON.stringify({ number: 456, title: "Goal: Bootstrap decomposition continuity" }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #456)", domain: "goal-decomposition", slug: "goal-456-bootstrap-feature-1" }, (out) => {
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_3);
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #540 deterministic bootstrap decomposition continuity scaffold", {
    goalIssueRaw: JSON.stringify({
      number: 540,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #540",
      body: "Goal #540 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #540)", domain: "goal-decomposition", slug: "goal-540-bootstrap-feature-1" }, (out) => {
assert.match(out[0].summary, /goal #540 produced malformed or empty decomposition output/i);
assert.match(out[0].scope, /continuity and reliability of pipeline execution, not full decomposition quality refinement/i);
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_3);
});

registerFallbackIdentityCase("buildFallbackFeatures emits goal #543 deterministic bootstrap decomposition continuity scaffold", {
    goalIssueRaw: JSON.stringify({
      number: 543,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #543",
      body: "Goal #543 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #543)", domain: "goal-decomposition", slug: "goal-543-bootstrap-feature-1" }, (out) => {
assert.match(out[0].summary, /goal #543 produced malformed or empty decomposition output/i);
assert.match(out[0].scope, /fallback scaffold when decomposition output is malformed or empty/i);
assertRequiredAcceptanceCriteria(out[0], BOOTSTRAP_CRITERIA_3);
});

registerFallbackIdentityCase("buildFallbackFeatures routes numeric goal #1416 to deterministic example-factory bootstrap feature", {
    goalIssueRaw: JSON.stringify({
      number: 1416,
      title: "Goal: Ship example factories with batteries, demo docs, and working tests",
      body: "Fallback decomposition must keep write_issues and triage continuity for example-factory deliverables.",
    }),
  }, { length: 1, id: "F-1", slug: "goal-1416-bootstrap-feature-1", domain: "goal-decomposition" }, (out) => {
assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention, preserving deterministic downstream handoff continuity."),
    true,
  );
assert.equal(
    out[0].acceptance_criteria.some((entry) => /non-mothership control-plane relationship/i.test(entry)),
    true,
  );
});

registerFallbackIdentityCase("buildFallbackFeatures routes title/body goal #1416 hints when numeric goal number is missing", {
    goalIssueRaw: JSON.stringify({
      title: "Fallback bootstrap for goal #1416 example factories",
      body: "Need deterministic decomposition continuity for goal-1416 when decomposition output is malformed or empty.",
    }),
  }, { length: 1, slug: "goal-1416-bootstrap-feature-1", domain: "goal-decomposition" });

test("buildFallbackFeatures goal #1416 output is byte-for-byte deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 1416,
      title: "Goal: Ship example factories with batteries, demo docs, and working tests",
      body: "Fallback decomposition continuity for goal #1416.",
    }),
  };

  const runA = buildFallbackFeatures(input);
  const runB = buildFallbackFeatures(input);
  assert.equal(runA, runB);
});

registerFallbackDeterminismCase("buildFallbackFeatures goal #203 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 203,
      title: "Goal: Bootstrap decomposition continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures title/body-only goal #203 routing is deterministic", {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap deterministic decomposition continuity for goal #203",
      body: "Goal #203 fallback must preserve write_issues/triage continuity.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #337 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 337,
      title: "Goal: Bootstrap decomposition feature continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #354 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 354,
      title: "Goal: Bootstrap decomposition continuity fallback scaffold",
      body: "Fallback should preserve deterministic emit/resume/follow-up flow.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #353 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 353,
      title: "Goal: Bootstrap decomposition deterministic continuity",
      body: "Fallback should preserve deterministic handoff without manual intervention.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #540 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 540,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #540",
      body: "Goal #540 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  });

registerFallbackDeterminismCase("buildFallbackFeatures goal #543 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 543,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #543",
      body: "Goal #543 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  });

registerFallbackIdentityCase("buildFallbackFeatures uses --goal-number fallback when goal issue payload is malformed", {
    goalIssueRaw: "{broken",
    goalNumber: "353",
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #353)", slug: "goal-353-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures derives goal hint from malformed raw goal payload when explicit goal number is missing", {
    goalIssueRaw: "Malformed decomposition context for goal #321 continuity",
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures derives dashed goal hint from malformed raw goal payload when explicit goal number is missing", {
    goalIssueRaw: "Malformed decomposition context for goal-321 continuity",
  }, { length: 1, id: "F-1", name: "Bootstrap decomposition feature 1 (goal #321)", slug: "goal-321-bootstrap-feature-1", domain: "goal-decomposition" });
registerFallbackDeterminismCase("buildFallbackFeatures goal #456 output is deterministic", {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal: Bootstrap decomposition continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  });

registerFallbackIdentityCase("buildFallbackFeatures handles invalid goal JSON and still emits one deterministic feature", { goalIssueRaw: "{broken" }, { length: 1, id: "F-1", domain: "goal-decomposition" }, (out) => {
assert.equal(Array.isArray(out[0].acceptance_criteria), true);
assert.equal(out[0].acceptance_criteria.length, 3);
});

registerFallbackIdentityCase("buildFallbackFeatures keeps generic fallback path for non-trust goals", { goalIssueRaw: JSON.stringify({ number: 329, title: "Goal: Spec Coverage" }) }, { length: 1, id: "F-1", name: "Spec Coverage", slug: "goal-329-spec-coverage", domain: "goal-decomposition" });

registerFallbackIdentityCase("buildFallbackFeatures generic fallback does not synthesize bootstrap-only issue titles", {
    goalIssueRaw: JSON.stringify({
      number: 1392,
      title: "Goal: Launch a research-informed reward market-making capability in Example Trading",
    }),
  }, { length: 1, id: "F-1", name: "Launch a research-informed reward market-making capability in Example Trading" }, (out) => {
assert.equal(/^bootstrap decomposition feature/i.test(out[0].name), false);
assert.equal(out[0].slug, "goal-1392-launch-a-research-informed-reward-market-making-capability-in-example-");
});

test("fallback output remains parser-valid and countable for write_issues/triage handoff", () => {
  const rawFallback = buildFallbackFeatures({ goalIssueRaw: "{broken" });
  const normalized = fallbackJson(rawFallback, "", { goalNumber: "320" });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(typeof out[0].name, "string");
  assert.equal(Array.isArray(out[0].acceptance_criteria), true);
});

test("buildFallbackFeatures includes downstream continuity acceptance criteria", () => {
  const out = JSON.parse(buildFallbackFeatures({ goalIssueRaw: JSON.stringify({ number: 206, title: "Goal: Deterministic fallback" }) }));
  assert.equal(
    out[0].acceptance_criteria.some((entry) => entry.includes("write_issues/triage")),
    true,
  );
});

function assertFallbackIdentity(out, expected) {
  for (const [key, value] of Object.entries(expected)) {
    const actual = key === "array" ? Array.isArray(out) : key === "length" ? out.length : out[0][key];
    assert.equal(actual, value, `fallback identity field: ${key}`);
  }
}

function assertRequiredAcceptanceCriteria(feature, expected) {
  for (const criterion of expected) assert.equal(feature.acceptance_criteria.includes(criterion), true);
}
