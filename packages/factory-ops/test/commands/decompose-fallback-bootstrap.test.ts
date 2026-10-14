import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";


import test from "node:test";


import { fallbackJsonPair, fallbackJson, inspectJson, countJsonItems, countFeatureObjects, resolveBootstrapAcceptanceCriteria } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";

const goal213Issue = {
  number: 213,
  title: "Goal: Judge Reliability Contract (scenario selection + verdict determinism)",
  body: "Need deterministic decomposition fallback for judge reliability contract continuity.",
};

const goal321Issue = {
  number: 321,
  title: "Goal: Bootstrap deterministic decomposition continuity",
  body: "Fallback scaffold should preserve deterministic handoff.",
};

const goal354Issue = {
  number: 354,
  title: "Goal: Bootstrap decomposition continuity fallback scaffold",
  body: "Fallback scaffold should preserve deterministic emit/resume/follow-up handoff.",
};

const goal353Issue = {
  number: 353,
  title: "Goal: Bootstrap deterministic decomposition continuity",
  body: "Fallback scaffold should preserve execution continuity when decomposition output is malformed or empty.",
};

const goal484Issue = {
  number: 484,
  title: "Goal: Layer 2 DOT Conditional Edge Path Coverage Gate",
  body: "Need deterministic decomposition fallback continuity for malformed/empty decomposition output.",
};

const goal203Issue = {
  number: 203,
  title: "Goal: Bootstrap decomposition continuity",
  body: "Fallback scaffold must preserve deterministic handoff.",
};

function b64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function normalizeApprovedPath({ approvedFeaturesRaw = "[]", goalIssueRaw = "{}", goalNumber = "" } = {}) {
  const approvedObjectCount = countFeatureObjects(approvedFeaturesRaw);
  const routed = approvedObjectCount === "0"
    ? buildFallbackFeatures({ goalIssueRaw })
    : approvedFeaturesRaw;
  return fallbackJson(routed, "", { goalNumber });
}

function runOpsCli(args = []) {
  const run = spawnOpsCli([
      ...args
    ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return String(run.stdout || "").trim();
}

function runGoal321FallbackFlowViaCli({ approvedFeaturesRaw = "[]", proposedFeaturesRaw = "[]", issueNumber = 701 } = {}) {
  const candidate = runOpsCli([
    "common",
    "fallback-json-pair",
    "--primary-b64",
    b64(approvedFeaturesRaw),
    "--secondary-b64",
    b64(proposedFeaturesRaw),
  ]);

  const candidateObjectCount = runOpsCli([
    "common",
    "count-feature-objects",
    "--raw-b64",
    b64(candidate),
  ]);

  const fallbackOrCandidate = candidateObjectCount === "0"
    ? runOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      b64(JSON.stringify(goal321Issue)),
      "--goal-number",
      "321",
    ])
    : candidate;

  const normalized = runOpsCli([
    "common",
    "fallback-json",
    "--raw-b64",
    b64(fallbackOrCandidate),
    "--goal-number",
    "321",
  ]);

  const triage = runOpsCli([
    "triage",
    "zip-features",
    "--approved-features",
    normalized,
    "--issue-index",
    JSON.stringify([{ issue_number: issueNumber, url: `https://example.test/issues/${issueNumber}` }]),
  ]);

  const featureCount = runOpsCli(["common", "count-json", "--raw", normalized]);
  const issueCount = runOpsCli(["common", "count-json", "--raw", triage]);
  const shouldClose = runOpsCli([
    "goal",
    "compute-close-condition",
    "--issue-count",
    issueCount,
    "--approved-feature-count",
    featureCount,
  ]);

  return { normalized, triage, featureCount, issueCount, shouldClose };
}

test("decompose fallback bootstrap yields one valid feature and preserves write_issues/triage handoff", () => {
  const selected = fallbackJsonPair("{broken", "also-broken");
  assert.equal(selected, "[]");

  const fallback = buildFallbackFeatures({
    goalIssueRaw: JSON.stringify({
      number: 320,
      title: "Goal: Trust Tuple Identity fallback",
    }),
  });

  const normalized = fallbackJson(fallback, "", { goalNumber: "320", goalTitle: "Trust Tuple Identity fallback" });
  const parse = JSON.parse(inspectJson(normalized));

  assert.equal(parse.decompose_parse_status, "valid_json");
  assert.equal(countJsonItems(normalized), "1");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 500, url: "https://example.test/issues/500" }]),
  });

  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 500);
  assert.equal(triageItems[0].feature?.id, "F-1");
});

test("parser diagnostics for malformed/empty decomposition output are deterministic", () => {
  const malformed = JSON.parse(inspectJson("{broken"));
  const empty = JSON.parse(inspectJson("[]"));

  assert.equal(malformed.decompose_parse_status, "invalid_json");
  assert.equal(empty.decompose_parse_status, "empty_array");
  assert.equal(empty.decompose_parse_error, "decomposition array is empty");
});

test("bootstrap acceptance criteria helper remains deterministic", () => {
  const criteria = resolveBootstrapAcceptanceCriteria("214");
  assert.equal(Array.isArray(criteria), true);
  assert.equal(criteria.length, 4);
  assert.equal(criteria.some((entry) => /write_issues\/triage/i.test(entry)), true);
});

test("goal #213 fallback emits one feature and stays triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal213Issue),
    goalNumber: "213",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "judge-reliability-contract-fallback-bootstrap");
  assert.equal(out[0].domain, "judge-reliability-contract");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 502, url: "https://example.test/issues/502" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].feature?.slug, "judge-reliability-contract-fallback-bootstrap");
});

test("goal #203 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #203)");
  assert.equal(out[0].slug, "goal-203-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 503, url: "https://example.test/issues/503" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 503);
  assert.equal(triageItems[0].feature?.slug, "goal-203-bootstrap-feature-1");
});

test("goal #203 approved=true malformed non-array decomposition routes to deterministic bootstrap scaffold", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "goal-203-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal #203 approved=true empty decomposition routes to deterministic bootstrap scaffold", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].slug, "goal-203-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("goal #203 fallback scaffold output is deterministic across malformed/non-array/empty decomposition inputs", () => {
  const malformed = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });
  const nonArray = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });
  const empty = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal203Issue),
    goalNumber: "203",
  });

  assert.equal(malformed, nonArray);
  assert.equal(nonArray, empty);
});

test("goal #337 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify({
      number: 337,
      title: "Goal: Bootstrap decomposition feature continuity",
      body: "Fallback scaffold must preserve deterministic handoff.",
    }),
    goalNumber: "337",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #337)");
  assert.equal(out[0].slug, "goal-337-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 503, url: "https://example.test/issues/503" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 503);
  assert.equal(triageItems[0].feature?.slug, "goal-337-bootstrap-feature-1");
});

test("goal #354 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #354)");
  assert.equal(out[0].slug, "goal-354-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 507, url: "https://example.test/issues/507" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 507);
  assert.equal(triageItems[0].feature?.slug, "goal-354-bootstrap-feature-1");
});

test("goal #354 empty decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #354)");
  assert.equal(out[0].slug, "goal-354-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 508, url: "https://example.test/issues/508" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 508);
  assert.equal(triageItems[0].feature?.slug, "goal-354-bootstrap-feature-1");
});

test("goal #354 fallback path is deterministic across reruns for malformed and empty decomposition", () => {
  const malformedA = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });
  const malformedB = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });

  const emptyA = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });
  const emptyB = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal354Issue),
    goalNumber: "354",
  });

  assert.equal(malformedA, malformedB);
  assert.equal(emptyA, emptyB);
});

test("goal #354 routing remains stable when goal issue payload references #354 but omits number", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback scaffold continuity for goal #354",
      body: "Keep fallback deterministic for goal #354 when decomposition output is malformed or empty.",
    }),
    goalNumber: "354",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #354)");
  assert.equal(out[0].slug, "goal-354-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 509, url: "https://example.test/issues/509" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 509);
  assert.equal(triageItems[0].feature?.slug, "goal-354-bootstrap-feature-1");
});

test("goal #353 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #353)");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.match(out[0].summary, /execution continuity/i);
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 506, url: "https://example.test/issues/506" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 506);
  assert.equal(triageItems[0].feature?.slug, "goal-353-bootstrap-feature-1");
});

test("goal #353 empty decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 507, url: "https://example.test/issues/507" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 507);
  assert.equal(triageItems[0].feature?.slug, "goal-353-bootstrap-feature-1");
});

test("goal #321 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 503, url: "https://example.test/issues/503" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 503);
  assert.equal(triageItems[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #321 empty decomposition routes to deterministic bootstrap scaffold and stays triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 504, url: "https://example.test/issues/504" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 504);
  assert.equal(triageItems[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #321 routing remains stable when goal issue payload references #321 but omits number", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Keep fallback deterministic for goal #321 when decomposition output is malformed or empty.",
    }),
    goalNumber: "321",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 505, url: "https://example.test/issues/505" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 505);
  assert.equal(triageItems[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #321 routing remains deterministic from payload hint when goal number context is missing", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify({
      title: "Feature: Bootstrap decomposition fallback continuity for goal #321",
      body: "Keep fallback deterministic for goal #321 when decomposition output is malformed or empty.",
    }),
    goalNumber: "",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal #321 textual references do not override non-321 numeric goal routing", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal #456 follow-up that references goal #321",
      body: "This issue depends on goal #321 but is still goal #456.",
    }),
    goalNumber: "456",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal #321 fallback path is deterministic across reruns for malformed and empty decomposition", () => {
  const malformedA = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const malformedB = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });

  const emptyA = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const emptyB = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });

  assert.equal(malformedA, malformedB);
  assert.equal(emptyA, emptyB);
});

test("goal #321 malformed and empty decomposition share one deterministic scaffold payload for downstream artifact handoff", () => {
  const malformed = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const empty = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });

  assert.equal(malformed, empty);
  assert.equal(countJsonItems(malformed), "1");

  const out = JSON.parse(malformed);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.includes("Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold."),
    true,
  );

  const malformedTriageItems = zipFeaturesToIssues({
    featuresRaw: malformed,
    issueIndexRaw: JSON.stringify([{ issue_number: 611, url: "https://example.test/issues/611" }]),
  });
  const emptyTriageItems = zipFeaturesToIssues({
    featuresRaw: empty,
    issueIndexRaw: JSON.stringify([{ issue_number: 611, url: "https://example.test/issues/611" }]),
  });

  assert.deepEqual(malformedTriageItems, emptyTriageItems);
  assert.equal(malformedTriageItems.length, 1);
  assert.equal(malformedTriageItems[0].issue_number, 611);
  assert.equal(malformedTriageItems[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #321 malformed/empty fallback reruns remain byte-identical and triage-equivalent", () => {
  const malformedRunA = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const malformedRunB = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const emptyRunA = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });
  const emptyRunB = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal321Issue),
    goalNumber: "321",
  });

  assert.equal(malformedRunA, malformedRunB);
  assert.equal(emptyRunA, emptyRunB);
  assert.equal(malformedRunA, emptyRunA);

  const triageA = zipFeaturesToIssues({
    featuresRaw: malformedRunA,
    issueIndexRaw: JSON.stringify([{ issue_number: 612, url: "https://example.test/issues/612" }]),
  });
  const triageB = zipFeaturesToIssues({
    featuresRaw: emptyRunB,
    issueIndexRaw: JSON.stringify([{ issue_number: 612, url: "https://example.test/issues/612" }]),
  });

  assert.deepEqual(triageA, triageB);
  assert.equal(triageA.length, 1);
  assert.equal(triageA[0].issue_number, 612);
  assert.equal(triageA[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #321 CLI fallback flow keeps malformed/empty decomposition deterministic and closes when triaged", () => {
  const malformed = runGoal321FallbackFlowViaCli({
    approvedFeaturesRaw: "{broken",
    proposedFeaturesRaw: "[]",
    issueNumber: 613,
  });
  const empty = runGoal321FallbackFlowViaCli({
    approvedFeaturesRaw: "[]",
    proposedFeaturesRaw: "[]",
    issueNumber: 613,
  });

  assert.equal(malformed.featureCount, "1");
  assert.equal(empty.featureCount, "1");
  assert.equal(malformed.issueCount, "1");
  assert.equal(empty.issueCount, "1");
  // Close only after every approved fallback feature has a materialized issue.
  assert.equal(malformed.shouldClose, "true");
  assert.equal(empty.shouldClose, "true");

  assert.equal(malformed.normalized, empty.normalized);
  assert.equal(malformed.triage, empty.triage);

  const triageItems = JSON.parse(malformed.triage);
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 613);
  assert.equal(triageItems[0].feature?.slug, "goal-321-bootstrap-feature-1");
});

test("goal #353 fallback path is deterministic across reruns for malformed and empty decomposition", () => {
  const malformedA = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });
  const malformedB = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });

  const emptyA = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });
  const emptyB = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });

  assert.equal(malformedA, malformedB);
  assert.equal(emptyA, emptyB);
});

test("goal #456 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify({
      number: 456,
      title: "Goal: Bootstrap decomposition continuity",
      body: "Fallback scaffold must preserve deterministic handoff.",
    }),
    goalNumber: "456",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 503, url: "https://example.test/issues/503" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 503);
  assert.equal(triageItems[0].feature?.slug, "goal-456-bootstrap-feature-1");
});

test("goal #484 fallback emits one feature and stays triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal484Issue),
    goalNumber: "484",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "dot-conditional-edge-path-coverage-fallback-bootstrap");
  assert.equal(out[0].domain, "dot-conditional-edge-coverage");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 504, url: "https://example.test/issues/504" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].feature?.slug, "dot-conditional-edge-path-coverage-fallback-bootstrap");
});

test("goal build-fallback-features accepts quote-safe --goal-issue-b64 payload", () => {
  const goalIssue = {
    number: 320,
    title: "Goal: Trust Tuple Identity fallback for O'Hare transport",
    body: "Apostrophe in payload should not break fallback routing.",
  };
  const encoded = b64(JSON.stringify(goalIssue));

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "320"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
});

test("goal build-fallback-features respects --goal-number override and remains deterministic for goal #321", () => {
  const goalIssue = {
    number: 456,
    title: "Goal #456 follow-up references goal #321",
    body: "Fallback continuity should still target goal #321 when context issue number is 321.",
  };
  const encoded = b64(JSON.stringify(goalIssue));

  const runA = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "321"
    ]);

  const runB = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "321"
    ]);

  assert.equal(runA.status, 0, runA.stderr || runA.stdout);
  assert.equal(runB.status, 0, runB.stderr || runB.stdout);
  assert.equal(runA.stdout, runB.stdout);

  const out = JSON.parse(runA.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal build-fallback-features canonicalizes zero-padded --goal-number for deterministic goal #321 routing", () => {
  const goalIssue = {
    number: 456,
    title: "Goal #456 follow-up references goal #321",
    body: "Zero-padded goal-number override should still route deterministically.",
  };
  const encoded = b64(JSON.stringify(goalIssue));

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "00321"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal build-fallback-features canonicalizes zero-padded goal issue number for deterministic goal #321 routing", () => {
  const goalIssue = {
    number: "00321",
    title: "Goal: Bootstrap deterministic decomposition continuity",
    body: "Goal issue payload number normalization should stay deterministic.",
  };
  const encoded = b64(JSON.stringify(goalIssue));

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal build-fallback-features ignores malformed --goal-number override and preserves numeric issue routing", () => {
  const goalIssue = {
    number: 456,
    title: "Goal #456 follow-up references goal #321",
    body: "Malformed override should not break deterministic routing.",
  };
  const encoded = b64(JSON.stringify(goalIssue));

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "goal-321"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #456)");
  assert.equal(out[0].slug, "goal-456-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal build-fallback-features uses --goal-number hint for deterministic goal #214 continuity when payload is malformed", () => {
  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "{broken",
      "--goal-number",
      "214"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "goal-214-bootstrap-feature-1");
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("goal build-fallback-features goal #214 scaffold is triage-ready for downstream write_issues/triage handoff", () => {
  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "{broken",
      "--goal-number",
      "214"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(countJsonItems(run.stdout || "[]"), "1");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: run.stdout || "[]",
    issueIndexRaw: JSON.stringify([{ issue_number: 5240, url: "https://example.test/issues/5240" }]),
  });

  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 5240);
  assert.equal(triageItems[0].feature?.slug, "goal-214-bootstrap-feature-1");
  assert.deepEqual(
    triageItems[0].feature?.acceptance_criteria,
    resolveBootstrapAcceptanceCriteria("214"),
  );
});

test("goal build-fallback-features prioritizes --goal-number #214 over conflicting payload number", () => {
  const encoded = b64(JSON.stringify({
    number: 456,
    title: "Goal #456 conflicting payload",
    body: "Fallback continuity should still route to goal #214 when context goal number is authoritative.",
  }));

  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue-b64",
      encoded,
      "--goal-number",
      "214"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #214)");
  assert.equal(out[0].slug, "goal-214-bootstrap-feature-1");
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("goal build-fallback-features yields identical goal #214 scaffold for malformed and empty payloads when goal-number hint is provided", () => {
  const runMalformed = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "{broken",
      "--goal-number",
      "214"
    ]);

  const runEmpty = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "{}",
      "--goal-number",
      "214"
    ]);

  assert.equal(runMalformed.status, 0, runMalformed.stderr || runMalformed.stdout);
  assert.equal(runEmpty.status, 0, runEmpty.stderr || runEmpty.stdout);
  assert.equal(runMalformed.stdout, runEmpty.stdout);

  const out = JSON.parse(runMalformed.stdout || "[]");
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "goal-214-bootstrap-feature-1");
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("goal build-fallback-features accepts --goal-number fallback when goal issue payload is malformed", () => {
  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "{broken",
      "--goal-number",
      "353"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("goal build-fallback-features derives malformed raw goal hint for deterministic goal #321 routing", () => {
  const run = spawnOpsCli([
      "goal",
      "build-fallback-features",
      "--goal-issue",
      "Malformed payload references goal-321 continuity"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #321)");
  assert.equal(out[0].slug, "goal-321-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("common inspect-json accepts --raw-b64 for objectless decomposition payloads", () => {
  const payload = JSON.stringify(["can't", null, 17]);
  const run = spawnOpsCli([
      "common",
      "inspect-json",
      "--raw-b64",
      b64(payload)
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.decompose_parse_status, "empty_feature_objects");
  assert.equal(out.decompose_parse_error, "decomposition array has no feature objects");
});

test("common fallback-json-pair accepts b64 payload transport with apostrophes", () => {
  const primary = "{broken";
  const secondary = JSON.stringify([{ id: "F-2", name: "Don't break transport" }]);
  const run = spawnOpsCli([
      "common",
      "fallback-json-pair",
      "--primary-b64",
      b64(primary),
      "--secondary-b64",
      b64(secondary)
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.trim(), '[{"id":"F-2","name":"Don\'t break transport"}]');
});

test("common fallback-json via --raw-b64 enforces deterministic goal #214 continuity defaults", () => {
  const partial = JSON.stringify([{ id: "F-1", acceptance_criteria: ["A single executable feature issue is created from fallback decomposition output."] }]);
  const run = spawnOpsCli([
      "common",
      "fallback-json",
      "--raw-b64",
      b64(partial),
      "--goal-number",
      "214"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("approved=true malformed non-array decomposition routes to goal #353 fallback", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal353Issue),
    goalNumber: "353",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "goal-353-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
});

test("approved=true malformed non-array decomposition routes to goal #213 fallback", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal213Issue),
    goalNumber: "213",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "judge-reliability-contract-fallback-bootstrap");
  assert.equal(out[0].domain, "judge-reliability-contract");
});

test("approved=true malformed non-array decomposition routes to goal #484 fallback", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal484Issue),
    goalNumber: "484",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "dot-conditional-edge-path-coverage-fallback-bootstrap");
  assert.equal(out[0].domain, "dot-conditional-edge-coverage");
});

test("approved=true malformed non-array decomposition routes to trust tuple fallback", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify({ number: 320, title: "Goal: Trust Tuple Identity fallback" }),
    goalNumber: "320",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
});

test("approved=true empty decomposition routes to trust tuple fallback", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify({ number: 320, title: "Goal: Trust Tuple Identity fallback" }),
    goalNumber: "320",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
});

test("approved=true objectless array routes to trust tuple fallback and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: '["oops", null, 17]',
    goalIssueRaw: JSON.stringify({ number: 320, title: "Goal: Trust Tuple Identity fallback" }),
    goalNumber: "320",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 501, url: "https://example.test/issues/501" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].feature?.slug, "trust-tuple-identity-fallback-bootstrap");
});
