import assert from "node:assert/strict";
import test from "node:test";

import { fallbackJson, countJsonItems, resolveBootstrapAcceptanceCriteria } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";

test("buildFallbackFeatures returns judge reliability bootstrap slice for goal #213", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 213,
      title: "Goal: Judge Reliability Contract (scenario selection + verdict determinism)",
      body: "Need deterministic decomposition fallback for judge reliability contract continuity.",
    }),
  }));

  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "judge-reliability-contract-fallback-bootstrap");
  assert.equal(out[0].domain, "judge-reliability-contract");
  assert.match(out[0].summary, /scenario selection/i);
  assert.match(out[0].summary, /verdict determinism/i);
  assert.equal(out[0].acceptance_criteria.length, 4);
});

test("buildFallbackFeatures returns trust tuple bootstrap slice for goal #320", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 320,
      title: "Goal: Trust Tuple Identity fallback",
      body: "Need deterministic decomposition fallback for tuple identity.",
    }),
  }));

  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
  assert.match(out[0].summary, /intent release × model × agent type\/version/);
});

test("buildFallbackFeatures routes goal-number-only trust tuple fallback for goal #547", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: "{broken",
    goalNumber: "547",
  }));

  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
  assert.match(out[0].summary, /intent release × model × agent type\/version/);
});

test("buildFallbackFeatures judge reliability output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 213,
      title: "Goal: Judge Reliability Contract (scenario selection + verdict determinism)",
      body: "Need deterministic decomposition fallback for judge reliability contract continuity.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures trust tuple output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 320,
      title: "Goal: Trust Tuple Identity fallback",
      body: "Need deterministic decomposition fallback for tuple identity.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #547 trust tuple output is deterministic", () => {
  const input = {
    goalIssueRaw: "{broken",
    goalNumber: "547",
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures returns Layer 2 DOT conditional edge fallback slice for goal #484", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 484,
      title: "Goal: Layer 2 DOT Conditional Edge Path Coverage Gate",
      body: "Need deterministic decomposition fallback continuity when output is malformed or empty.",
    }),
  }));

  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "dot-conditional-edge-path-coverage-fallback-bootstrap");
  assert.equal(out[0].domain, "dot-conditional-edge-coverage");
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /malformed or empty/i.test(entry)),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /write_issues\/triage/i.test(entry)),
    true,
  );
});

test("buildFallbackFeatures Layer 2 DOT fallback output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 484,
      title: "Goal: Layer 2 DOT Conditional Edge Path Coverage Gate",
      body: "Need deterministic decomposition fallback continuity when output is malformed or empty.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures returns one deterministic executable fallback feature for goal #328", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 328, title: "Goal: decomposition continuity" }),
  }));

  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "decomposition continuity");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-328-decomposition-continuity");
  assert.match(out[0].summary, /goal #328/);
  assert.match(out[0].scope, /In scope:/);
  assert.deepEqual(out[0].dependencies, []);
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
});

test("buildFallbackFeatures emits bootstrap decomposition scaffold for goal #336 continuity", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 336, title: "Goal: decomposition continuity" }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].name, "decomposition continuity");
  assert.equal(out[0].slug, "goal-336-decomposition-continuity");
  assert.match(out[0].summary, /goal #336/);
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures emits goal #203 deterministic bootstrap decomposition scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 203, title: "Goal: Bootstrap decomposition continuity" }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #203)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-203-bootstrap-feature-1");
  assert.equal(out[0].acceptance_criteria.length, 4);
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures routes title/body-only goal #203 context to deterministic bootstrap scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap deterministic decomposition continuity for goal #203",
      body: "Goal #203 fallback must preserve write_issues/triage continuity.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #203)");
  assert.equal(out[0].slug, "goal-203-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures routes goal #214 scaffold from explicit goalNumber hint when goal issue payload is malformed", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: "{broken",
    goalNumber: "214",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #214)");
  assert.equal(out[0].slug, "goal-214-bootstrap-feature-1");
  assert.equal(out[0].acceptance_criteria.length, 4);
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("buildFallbackFeatures goalNumber override wins over conflicting payload number for deterministic routing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 999,
      title: "Goal: End-to-End Feedback Loop Harnesses (Review, Judge, Conflict, Artifact)",
      body: "Need deterministic continuity so review/judge/conflict/artifact loops still hand off to write_issues and triage.",
    }),
    goalNumber: "214",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #214)");
  assert.equal(out[0].slug, "goal-214-bootstrap-feature-1");
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("buildFallbackFeatures does not route goal #214 signature when explicit non-214 number is present", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 337,
      title: "Goal #337 follow-up references goal #203 fallback notes",
      body: "Contains context about goal #203 but should still route by explicit goal number.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "goal-337-bootstrap-feature-1");
  assert.match(out[0].summary, /This feature turns that scaffold into a single executable feature issue/i);
});

test("buildFallbackFeatures emits goal #337 deterministic bootstrap decomposition scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 337, title: "Goal: Bootstrap decomposition feature continuity" }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #337)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-337-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures emits goal #354 deterministic bootstrap decomposition scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 354, title: "Goal: Bootstrap decomposition continuity fallback scaffold" }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #354)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-354-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures emits goal #353 deterministic decomposition continuity scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 353,
      title: "Goal: Bootstrap decomposition deterministic continuity",
      body: "Need deterministic fallback scaffold when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #353)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.match(out[0].summary, /execution continuity/i);
  assert.equal(out[0].acceptance_criteria.length, 4);
});

test("buildFallbackFeatures routes to goal #354 scaffold when issue number is missing but title/body reference goal #354", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback scaffold continuity for goal #354",
      body: "Keep deterministic fallback scaffold behavior for goal #354 when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #354)");
  assert.equal(out[0].slug, "goal-354-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures routes to goal #353 scaffold when issue number is missing but title/body reference goal #353", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #353",
      body: "Keep fallback deterministic for goal #353 when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #353)");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures emits goal #321 deterministic decomposition continuity scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 321,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should keep deterministic downstream handoff.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.match(out[0].summary, /malformed or empty/i);
});

test("buildFallbackFeatures goal #321 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 321,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should keep deterministic downstream handoff.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures emits goal #322 deterministic decomposition continuity scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 322,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Malformed or empty decomposition output should not block downstream issue-writing and triage.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #322)");
  assert.equal(out[0].slug, "goal-322-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.match(out[0].summary, /deterministic fallback path/i);
  assert.equal(out[0].acceptance_criteria.length, 4);
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("buildFallbackFeatures goal #322 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 322,
      title: "Goal: Bootstrap deterministic decomposition continuity",
      body: "Fallback scaffold should preserve deterministic handoff when decomposition output is malformed or empty.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures routes to goal #322 scaffold when issue number is missing but title/body reference goal #322", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #322",
      body: "Keep fallback deterministic for goal #322 when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #322)");
  assert.equal(out[0].slug, "goal-322-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures routes to goal #321 scaffold when issue number is missing but title/body reference goal #321", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Keep fallback deterministic for goal #321 when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures does not override non-321 numeric goal routing when title references goal #321", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "This issue depends on goal #321 but is still goal #456.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures derives goal number hint from title/body when issue number is missing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Goal #329: bootstrap decomposition continuity",
      body: "Fallback continuity should stay deterministic for goal #329.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "bootstrap decomposition continuity");
  assert.equal(out[0].slug, "goal-329-bootstrap-decomposition-continuity");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures derives dashed goal-number hint from title/body when issue number is missing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Feature: bootstrap decomposition continuity for goal-321",
      body: "Fallback continuity should stay deterministic for goal-321.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures keeps numeric goal routing authoritative over dashed goal hint", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up references goal-321",
      body: "Numeric goal context must stay authoritative over dashed hint forms.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures ignores malformed issue number and derives goal hint deterministically", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: "not-a-number",
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Fallback path should still target goal #321 deterministically.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures ignores malformed goalNumber override and keeps numeric issue routing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "Numeric issue number should remain authoritative when override is malformed.",
    }),
    goalNumber: "goal-321",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures honors goalNumber override for deterministic goal #321 routing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "This issue depends on goal #321 but context issue number should drive routing.",
    }),
    goalNumber: "321",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

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

test("buildFallbackFeatures emits goal #456 deterministic bootstrap decomposition scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({ number: 456, title: "Goal: Bootstrap decomposition continuity" }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
});

test("buildFallbackFeatures emits goal #540 deterministic bootstrap decomposition continuity scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 540,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #540",
      body: "Goal #540 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #540)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-540-bootstrap-feature-1");
  assert.match(out[0].summary, /goal #540 produced malformed or empty decomposition output/i);
  assert.match(out[0].scope, /continuity and reliability of pipeline execution, not full decomposition quality refinement/i);
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
});

test("buildFallbackFeatures emits goal #543 deterministic bootstrap decomposition continuity scaffold", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 543,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #543",
      body: "Goal #543 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #543)");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug, "goal-543-bootstrap-feature-1");
  assert.match(out[0].summary, /goal #543 produced malformed or empty decomposition output/i);
  assert.match(out[0].scope, /fallback scaffold when decomposition output is malformed or empty/i);
  assert.equal(
    out[0].acceptance_criteria.includes("A single executable feature issue is created from fallback decomposition output."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );
});

test("buildFallbackFeatures routes numeric goal #1416 to deterministic example-factory bootstrap feature", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 1416,
      title: "Goal: Ship example factories with batteries, demo docs, and working tests",
      body: "Fallback decomposition must keep write_issues and triage continuity for example-factory deliverables.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "goal-1416-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention, preserving deterministic downstream handoff continuity."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /non-mothership control-plane relationship/i.test(entry)),
    true,
  );
});

test("buildFallbackFeatures routes title/body goal #1416 hints when numeric goal number is missing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      title: "Fallback bootstrap for goal #1416 example factories",
      body: "Need deterministic decomposition continuity for goal-1416 when decomposition output is malformed or empty.",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "goal-1416-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

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

test("buildFallbackFeatures goal #203 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 203,
      title: "Goal: Bootstrap decomposition continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures title/body-only goal #203 routing is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap deterministic decomposition continuity for goal #203",
      body: "Goal #203 fallback must preserve write_issues/triage continuity.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #337 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 337,
      title: "Goal: Bootstrap decomposition feature continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #354 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 354,
      title: "Goal: Bootstrap decomposition continuity fallback scaffold",
      body: "Fallback should preserve deterministic emit/resume/follow-up flow.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #353 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 353,
      title: "Goal: Bootstrap decomposition deterministic continuity",
      body: "Fallback should preserve deterministic handoff without manual intervention.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #540 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 540,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #540",
      body: "Goal #540 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures goal #543 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 543,
      title: "Goal: Bootstrap deterministic decomposition continuity for goal #543",
      body: "Goal #543 produced malformed or empty decomposition output and needs deterministic fallback continuity.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures uses --goal-number fallback when goal issue payload is malformed", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: "{broken",
    goalNumber: "353",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #353)");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures derives goal hint from malformed raw goal payload when explicit goal number is missing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: "Malformed decomposition context for goal #321 continuity",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures derives dashed goal hint from malformed raw goal payload when explicit goal number is missing", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: "Malformed decomposition context for goal-321 continuity",
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});
test("buildFallbackFeatures goal #456 output is deterministic", () => {
  const input = {
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal: Bootstrap decomposition continuity",
      body: "Fallback should stay machine-consumable.",
    }),
  };
  assert.equal(buildFallbackFeatures(input), buildFallbackFeatures(input));
});

test("buildFallbackFeatures handles invalid goal JSON and still emits one deterministic feature", () => {
  const out = JSON.parse(buildFallbackFeatures({ goalIssueRaw: "{broken" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(Array.isArray(out[0].acceptance_criteria), true);
  assert.equal(out[0].acceptance_criteria.length, 3);
});

test("buildFallbackFeatures keeps generic fallback path for non-trust goals", () => {
  const out = JSON.parse(buildFallbackFeatures({ goalIssueRaw: JSON.stringify({ number: 329, title: "Goal: Spec Coverage" }) }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Spec Coverage");
  assert.equal(out[0].slug, "goal-329-spec-coverage");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("buildFallbackFeatures generic fallback does not synthesize bootstrap-only issue titles", () => {
  const out = JSON.parse(buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 1392,
      title: "Goal: Launch a research-informed reward market-making capability in Example Trading",
    }),
  }));

  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Launch a research-informed reward market-making capability in Example Trading");
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
