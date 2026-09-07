import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGhRepo } from "../src/commands/common-resolve-gh-repo.ts";
import { fetchGoalIssue } from "../src/commands/milestone-fetch-goal-issue.ts";
import { resolveGoalNumberFromMilestoneTitle } from "../src/commands/milestone-resolve-goal-number.ts";
import {
  inspectJson,
  fallbackJson,
  inspectJsonPair,
  fallbackJsonPair,
  normalizeApproved,
  normalizeDecision,
  incrementCounter,
  countJsonItems,
  countFeatureObjects,
  resolveBootstrapAcceptanceCriteria,
  fallbackIssueSpec,
  fallbackIssueSpecBundle,
  normalizeFeatureIssueSpec,
  normalizeFeatureIssueSpecBundle,
  resolveFactoryConfigValue,
  buildRetrySignal,
  resolveCapabilityCodingSkillsPath,
  resolveCapabilityMergeSkillsPath,
  resolveCapabilityGoalDecompositionSkillsPath,
  resolveCapabilityBrainstormingSkillsPath,
  resolveGoalDecompositionTimeout,
  loadGoalDecompositionTimeoutDefaults,
  validateIssueSpecDraft,
} from "../src/commands/common-resolve-default.ts";
import { normalizeIssueUrlArray } from "@hatch/factory-core/issue-url-normalization";

test("resolveGhRepo prefers explicit value", () => {
  assert.equal(resolveGhRepo("owner/repo"), "owner/repo");
});

test("resolveCapabilityCodingSkillsPath resolves capability skills root", () => {
  const resolved = resolveCapabilityCodingSkillsPath();
  assert.match(resolved, /packages\/capability-coding\/skills$/);
});

test("resolveGoalNumberFromMilestoneTitle parses goal number", () => {
  assert.equal(resolveGoalNumberFromMilestoneTitle("goal-187-wave-3"), "187");
  assert.equal(resolveGoalNumberFromMilestoneTitle("not-a-goal"), "");
  assert.equal(resolveGoalNumberFromMilestoneTitle(null), "");
});

test("fetchGoalIssue returns parsed goal issue JSON", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "taxi-gh-bin-"));
  const fakeGh = join(fakeBinDir, "gh");
  writeFileSync(fakeGh, "#!/bin/sh\nprintf '%s' '{\"number\":187,\"title\":\"Goal\",\"body\":\"Ship it\"}'\n", "utf8");
  chmodSync(fakeGh, 0o755);
  const originalPath = process.env.PATH || "";
  process.env.PATH = `${fakeBinDir}:${originalPath}`;
  try {
    const out = fetchGoalIssue({ repo: "recallnet/astrochicken", goalNumber: "187" });
    assert.deepEqual(out, { number: 187, title: "Goal", body: "Ship it" });
  } finally {
    process.env.PATH = originalPath;
  }
});

test("fetchGoalIssue returns empty object when goal number missing", () => {
  assert.deepEqual(fetchGoalIssue({ repo: "recallnet/astrochicken", goalNumber: "" }), {});
});

test("resolveFactoryConfigValue reads value from factory config", () => {
  const tmp = "/tmp/taxi-test-factory-config.json";
  writeFileSync(tmp, JSON.stringify({ max_concurrent_waves: 7 }), "utf8");
  assert.equal(resolveFactoryConfigValue({ key: "max_concurrent_waves", fallback: "3", configPath: tmp }), "7");
  unlinkSync(tmp);
});

test("resolveFactoryConfigValue reads example-trading work_dir from shipped config", () => {
  assert.equal(
    resolveFactoryConfigValue({
      key: "work_dir",
      fallback: ".",
      configPath: "factories/example-trading/factory.config.json",
    }),
    "/path/to/example-trading",
  );
});

test("resolveFactoryConfigValue falls back when key missing or file invalid", () => {
  const tmp = "/tmp/taxi-test-factory-config-invalid.json";
  writeFileSync(tmp, "{broken", "utf8");
  assert.equal(resolveFactoryConfigValue({ key: "max_goal_runs_per_tick", fallback: "2", configPath: tmp }), "2");
  unlinkSync(tmp);
  assert.equal(resolveFactoryConfigValue({ key: "max_goal_runs_per_tick", fallback: "2", configPath: "/tmp/does-not-exist.json" }), "2");
});

test("resolveFactoryConfigValue falls back when config path is omitted", () => {
  assert.equal(resolveFactoryConfigValue({ key: "max_goal_runs_per_tick", fallback: "2" }), "2");
  assert.equal(resolveFactoryConfigValue({ key: "max_goal_runs_per_tick", fallback: "2", configPath: "" }), "2");
});

test("resolveFactoryConfigValue env override wins over config file", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "taxi-test-factory-config-env-"));
  const tmp = join(tmpDir, "factory.config.json");
  try {
    writeFileSync(tmp, JSON.stringify({ control_plane_repo: "recallnet/astrochicken" }), "utf8");
    const env = { HATCH_CONTROL_PLANE_REPO: "dtb/my-research" };
    assert.equal(resolveFactoryConfigValue({ key: "control_plane_repo", fallback: "fallback/repo", configPath: tmp, env }), "dtb/my-research");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveFactoryConfigValue env override is skipped when empty", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "taxi-test-factory-config-env-empty-"));
  const tmp = join(tmpDir, "factory.config.json");
  try {
    writeFileSync(tmp, JSON.stringify({ control_plane_repo: "recallnet/astrochicken" }), "utf8");
    const env = { HATCH_CONTROL_PLANE_REPO: "" };
    assert.equal(resolveFactoryConfigValue({ key: "control_plane_repo", fallback: "fallback/repo", configPath: tmp, env }), "recallnet/astrochicken");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveFactoryConfigValue env override wins when config path is omitted", () => {
  const env = { HATCH_CONTROL_PLANE_REPO: "dtb/my-research" };
  assert.equal(resolveFactoryConfigValue({ key: "control_plane_repo", fallback: "fallback/repo", env }), "dtb/my-research");
  assert.equal(resolveFactoryConfigValue({ key: "control_plane_repo", fallback: "fallback/repo", configPath: "", env }), "dtb/my-research");
});

test("loadGoalDecompositionTimeoutDefaults loads all six stages from capability artifact", () => {
  const defaults = loadGoalDecompositionTimeoutDefaults();
  assert.deepEqual(defaults, {
    issue_draft: "30m",
    issue_repair: "30m",
    issue_judge: "30m",
    issue_revise: "30m",
    triage_plan: "30m",
    triage_repair: "30m",
  });
});

test("resolveGoalDecompositionTimeout resolves default when override absent", () => {
  const timeout = resolveGoalDecompositionTimeout({
    stage: "issue_draft",
    factoryConfig: {},
  });
  assert.equal(timeout, "30m");
});

test("resolveGoalDecompositionTimeout applies factory override precedence", () => {
  const timeout = resolveGoalDecompositionTimeout({
    stage: "issue_draft",
    factoryConfig: {
      capabilities: {
        goal_decomposition: {
          timeouts: {
            issue_draft: "45m",
          },
        },
      },
    },
  });
  assert.equal(timeout, "45m");
});

test("resolveGoalDecompositionTimeout fails closed on invalid override duration", () => {
  assert.throws(() => resolveGoalDecompositionTimeout({
    stage: "issue_draft",
    factoryConfig: {
      capabilities: {
        goal_decomposition: {
          timeouts: {
            issue_draft: "45minutes",
          },
        },
      },
    },
  }), /must match \/\^\\d\+\(ms\|s\|m\|h\|d\)\$\//);
});

test("resolveGoalDecompositionTimeout fails closed on unknown stage", () => {
  assert.throws(() => resolveGoalDecompositionTimeout({
    stage: "unknown_stage",
    factoryConfig: {},
  }), /unknown stage/);
});

test("resolveCapabilityCodingSkillsPath resolves package skills directory from graph export", () => {
  const out = resolveCapabilityCodingSkillsPath();
  assert.match(out, /packages\/capability-coding\/skills$/);
});

test("resolveCapabilityCodingSkillsPath supports explicit graph export override", () => {
  const out = resolveCapabilityCodingSkillsPath({
    graphExport: "packages/capability-coding/workflows/issue_execute_item/issue_execute_item.workflow-source.mjs",
  });
  assert.match(out, /packages\/capability-coding\/skills$/);
});

test("resolveCapabilityMergeSkillsPath resolves capability skills root", () => {
  const resolved = resolveCapabilityMergeSkillsPath();
  assert.match(resolved, /packages\/capability-merge\/skills$/);
});

test("resolveCapabilityMergeSkillsPath supports explicit graph export override", () => {
  const out = resolveCapabilityMergeSkillsPath({
    graphExport: "packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
  });
  assert.match(out, /packages\/capability-merge\/skills$/);
});

test("resolveCapabilityGoalDecompositionSkillsPath resolves capability skills root", () => {
  const resolved = resolveCapabilityGoalDecompositionSkillsPath();
  assert.match(resolved, /packages\/capability-goal-decomposition\/skills$/);
});

test("resolveCapabilityGoalDecompositionSkillsPath supports explicit graph export override", () => {
  const out = resolveCapabilityGoalDecompositionSkillsPath({
    graphExport: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
  });
  assert.match(out, /packages\/capability-goal-decomposition\/skills$/);
});

test("resolveCapabilityBrainstormingSkillsPath resolves capability skills root", () => {
  const resolved = resolveCapabilityBrainstormingSkillsPath();
  assert.match(resolved, /packages\/capability-brainstorming\/skills$/);
});

test("resolveCapabilityBrainstormingSkillsPath supports explicit graph export override", () => {
  const out = resolveCapabilityBrainstormingSkillsPath({
    graphExport: "packages/capability-brainstorming/workflows/brainstorm/brainstorm.workflow-source.mjs",
  });
  assert.match(out, /packages\/capability-brainstorming\/skills$/);
});

test("resolveCapabilityTriageSkillsPath resolves capability skills root", () => {
  const resolved = resolveCapabilityTriageSkillsPath();
  assert.match(resolved, /packages\/capability-triage\/skills$/);
});

test("resolveCapabilityTriageSkillsPath supports explicit graph export override", () => {
  const out = resolveCapabilityTriageSkillsPath({
    graphExport: "@hatch/capability-triage/graphs/triage.dot",
  });
  assert.match(out, /packages\/capability-triage\/skills$/);
});

test("buildRetrySignal returns corrective retry feedback with attempt and status", () => {
  const signal = buildRetrySignal({
    decomposeParseStatus: "empty_array",
    decomposeParseError: "",
    decomposeAttempts: "1",
  });
  assert.match(signal, /attempt 1/i);
  assert.match(signal, /empty_array/);
  assert.match(signal, /non-empty JSON array/);
});

test("inspectJson reports valid JSON from --raw", () => {
  const result = JSON.parse(inspectJson('[{"id":"F-1"}]'));
  assert.equal(result.decompose_parse_status, "valid_json");
  assert.equal(result.decompose_parse_error, "");
});

test("inspectJson reports invalid JSON from --raw", () => {
  const result = JSON.parse(inspectJson("{broken"));
  assert.equal(result.decompose_parse_status, "invalid_json");
  assert.ok(result.decompose_parse_error.length > 0);
});

test("inspectJson reports non-array JSON deterministically", () => {
  const result = JSON.parse(inspectJson('{"id":"F-1"}'));
  assert.equal(result.decompose_parse_status, "non_array_json");
  assert.equal(result.decompose_parse_error, "decomposition output must be a JSON array");
});

test("inspectJson reports empty decomposition arrays deterministically", () => {
  const result = JSON.parse(inspectJson("[]"));
  assert.equal(result.decompose_parse_status, "empty_array");
  assert.equal(result.decompose_parse_error, "decomposition array is empty");
});

test("inspectJson reports objectless decomposition arrays deterministically", () => {
  const result = JSON.parse(inspectJson('["oops",null,17]'));
  assert.equal(result.decompose_parse_status, "empty_feature_objects");
  assert.equal(result.decompose_parse_error, "decomposition array has no feature objects");
});

test("inspectJson reports empty decomposition output deterministically", () => {
  const result = JSON.parse(inspectJson(""));
  assert.equal(result.decompose_parse_status, "invalid_json");
  assert.equal(result.decompose_parse_error, "decomposition output is empty");
});

test("inspectJson reads from --file", () => {
  const tmp = "/tmp/taxi-test-inspect.json";
  writeFileSync(tmp, '[{"id":"F-1","note":"has \\\"escaped\\\" quotes"}]');
  const result = JSON.parse(inspectJson("", tmp));
  assert.equal(result.decompose_parse_status, "valid_json");
  unlinkSync(tmp);
});

test("fallbackJson normalizes valid feature arrays to stable schema", () => {
  const raw = JSON.stringify([
    {
      id: "F-7",
      name: "Build event bus",
      summary: "Ship event bus",
      scope: "In scope only",
      acceptance_criteria: ["events published"],
      domain: "runtime",
      slug: "event-bus",
      dependencies: ["queue"],
      risks: ["ordering"],
    },
  ]);

  const out = JSON.parse(fallbackJson(raw));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-7");
  assert.equal(out[0].slug, "event-bus");
  assert.deepEqual(out[0].acceptance_criteria, ["events published"]);
});

test("fallbackJson emits bootstrap feature for malformed decomposition output", () => {
  const out = JSON.parse(fallbackJson("{broken", "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(typeof out[0].name, "string");
  assert.ok(out[0].summary.includes("goal #331"));
  assert.equal(Array.isArray(out[0].acceptance_criteria), true);
  assert.ok(out[0].acceptance_criteria.length >= 1);
});

test("fallbackJson emits bootstrap feature for empty decomposition arrays", () => {
  const out = JSON.parse(fallbackJson("[]", "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(out[0].slug.includes("bootstrap"), true);
});

test("fallbackJson emits bootstrap feature for non-array decomposition output", () => {
  const out = JSON.parse(fallbackJson('{"id":"F-1"}', "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.ok(out[0].summary.includes("goal #331"));
});

test("fallbackJson ignores malformed non-object entries when valid objects exist", () => {
  const raw = JSON.stringify([
    { id: "F-9", name: "Keep me", summary: "valid object" },
    "oops",
    null,
    17,
  ]);
  const out = JSON.parse(fallbackJson(raw, "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-9");
  assert.equal(out[0].name, "Keep me");
});

test("fallbackJson emits one bootstrap feature when array has no object entries", () => {
  const raw = JSON.stringify(["oops", null, 17, true]);
  const out = JSON.parse(fallbackJson(raw, "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.ok(out[0].summary.includes("goal #331"));
});

test("fallbackJson bootstrap acceptance criteria includes artifact flow continuity", () => {
  const out = JSON.parse(fallbackJson("{broken", "", { goalNumber: "331" }));
  assert.equal(
    out[0].acceptance_criteria.some((item) => item.includes("Artifact emit/resume/follow-up")),
    true,
  );
});

test("fallbackJson goal #214 defaults include explicit write_issues/triage continuity contract", () => {
  const out = JSON.parse(fallbackJson('{"id":"F-1"}', "", { goalNumber: "214" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].acceptance_criteria.length, 4);
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("validateIssueSpecDraft accepts valid issue-spec JSON", () => {
  const parsed = JSON.parse(validateIssueSpecDraft(
    JSON.stringify({ issue_title: "Ship it", issue_body: "Body", issue_labels: "feature,ready" }),
    JSON.stringify({ id: "F-1", name: "Feature" }),
  ));
  assert.equal(parsed.ok, true);
  assert.match(parsed.issue_spec, /"issue_title":"Ship it"/);
  assert.match(parsed.issue_spec_b64, /\S/);
});

test("validateIssueSpecDraft returns repair instructions for invalid drafts", () => {
  const parsed = JSON.parse(validateIssueSpecDraft(
    JSON.stringify({ issue_title: "", issue_body: "" }),
    JSON.stringify({ id: "F-7", name: "Registry validation" }),
  ));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /issue_title and issue_body/);
  assert.match(parsed.retry_prompt, /Feature context:/);
  assert.match(parsed.retry_prompt, /Registry validation/);
});

test("fallbackJson goal #214 merges missing continuity criteria when partial acceptance_criteria are supplied", () => {
  const out = JSON.parse(fallbackJson('[{"id":"F-1","acceptance_criteria":["A single executable feature issue is created from fallback decomposition output."]}]', "", { goalNumber: "214" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].acceptance_criteria.length, 4);
  assert.deepEqual(out[0].acceptance_criteria, resolveBootstrapAcceptanceCriteria("214"));
});

test("fallbackJson goal #214 canonicalizes required continuity criteria ordering and de-duplicates extras", () => {
  const required = resolveBootstrapAcceptanceCriteria("214");
  const out = JSON.parse(fallbackJson(
    `[{"id":"F-1","acceptance_criteria":["${required[2]}","${required[0]}","${required[2]}","Extra continuity verification is captured.","Extra continuity verification is captured."]}]`,
    "",
    { goalNumber: "214" },
  ));

  assert.equal(out.length, 1);
  assert.equal(out[0].acceptance_criteria.length, 5);
  assert.deepEqual(out[0].acceptance_criteria.slice(0, 4), required);
  assert.equal(out[0].acceptance_criteria[4], "Extra continuity verification is captured.");
});

test("fallbackJson non-214 defaults remain stable", () => {
  const out = JSON.parse(fallbackJson('{"id":"F-1"}', "", { goalNumber: "331" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].acceptance_criteria.length, 3);
});

test("resolveBootstrapAcceptanceCriteria returns goal #214 continuity defaults", () => {
  const out = resolveBootstrapAcceptanceCriteria("214");
  assert.equal(out.length, 4);
  assert.equal(
    out.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );
});

test("resolveBootstrapAcceptanceCriteria returns baseline defaults for non-214 goals", () => {
  const out = resolveBootstrapAcceptanceCriteria("331");
  assert.equal(out.length, 3);
  assert.equal(
    out.includes("Goal processing continues into write_issues/triage without manual intervention."),
    false,
  );
});

test("fallbackJson reads from --file", () => {
  const tmp = "/tmp/taxi-test-fallback.json";
  writeFileSync(tmp, '[{"id":"F-1","name":"N"}]');
  const out = JSON.parse(fallbackJson("", tmp));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "N");
  unlinkSync(tmp);
});

test("fallback scaffold keeps downstream goal handoff countable", () => {
  const out = fallbackJson("{broken", "", { goalNumber: "331" });
  assert.equal(countJsonItems(out), "1");
});

test("fallbackJson output is deterministic for malformed decomposition input", () => {
  const first = fallbackJson("{broken", "", { goalNumber: "331", goalTitle: "Trust Tuple Identity" });
  const second = fallbackJson("{broken", "", { goalNumber: "331", goalTitle: "Trust Tuple Identity" });
  assert.equal(first, second);
});

test("countFeatureObjects counts only object entries in array payloads", () => {
  assert.equal(countFeatureObjects('[{"id":"F-1"},{"id":"F-2"}]'), "2");
  assert.equal(countFeatureObjects('["oops",null,7]'), "0");
  assert.equal(countFeatureObjects('{"id":"oops"}'), "0");
  assert.equal(countFeatureObjects("{broken"), "0");
});

test("inspectJson accepts markdown fenced json", () => {
  const fenced = "```json\n[{\"id\":\"F-1\"}]\n```";
  const result = JSON.parse(inspectJson(fenced));
  assert.equal(result.decompose_parse_status, "valid_json");
});

test("fallbackJson strips markdown fences", () => {
  const fenced = "```json\n[{\"id\":\"F-1\"}]\n```";
  const out = JSON.parse(fallbackJson(fenced));
  assert.equal(Array.isArray(out), true);
});

test("fallbackIssueSpec returns existing valid issue spec unchanged", () => {
  const raw = JSON.stringify({ issue_title: "T", issue_body: "B", issue_labels: ["feature", "ready"] });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, { issue_title: "T", issue_body: "B", issue_labels: "feature,ready" });
});

test("fallbackIssueSpec preserves existing fallback provenance metadata when present", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "B",
    issue_labels: ["feature", "ready"],
    issue_spec_source: "fallback",
    issue_spec_fallback_reason: "writer_output_unavailable",
    issue_spec_fallback_schema: "hatch.issue_spec.fallback.v1",
  });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "B",
    issue_labels: "feature,ready",
    issue_spec_source: "fallback",
    issue_spec_fallback_reason: "writer_output_unavailable",
    issue_spec_fallback_schema: "hatch.issue_spec.fallback.v1",
  });
});

test("fallbackIssueSpec backfills fallback metadata when legacy issue body carries fallback marker", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "## Summary\nLegacy fallback\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: ["feature", "ready"],
  });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "## Summary\nLegacy fallback\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: "feature,ready",
    issue_spec_source: "fallback",
    issue_spec_fallback_reason: "writer_output_unavailable",
    issue_spec_fallback_schema: "hatch.issue_spec.fallback.v1",
  });
});

test("fallbackIssueSpec backfills fallback metadata when source is fallback without provenance marker", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "## Summary\nFallback source but marker unavailable",
    issue_labels: ["feature", "ready"],
    issue_spec_source: "fallback",
  });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "## Summary\nFallback source but marker unavailable",
    issue_labels: "feature,ready",
    issue_spec_source: "fallback",
    issue_spec_fallback_reason: "writer_output_unavailable",
    issue_spec_fallback_schema: "hatch.issue_spec.fallback.v1",
  });
});

test("fallbackIssueSpec keeps non-fallback existing issue specs unchanged when fallback marker absent", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "## Summary\nNormal writer output",
    issue_labels: ["feature", "ready"],
  });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "## Summary\nNormal writer output",
    issue_labels: "feature,ready",
  });
});

test("fallbackIssueSpec respects explicit non-fallback source even when fallback marker appears", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "## Summary\nCopied marker\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: ["feature", "ready"],
    issue_spec_source: "writer",
  });
  const out = JSON.parse(fallbackIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "## Summary\nCopied marker\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
    issue_labels: "feature,ready",
    issue_spec_source: "writer",
  });
});

test("fallbackIssueSpec synthesizes deterministic issue spec from feature when missing", () => {
  const feature = JSON.stringify({ name: "Feature X", summary: "Ship X", acceptance_criteria: ["A", "B"], risks: ["R1"] });
  const out = JSON.parse(fallbackIssueSpec("", feature));
  assert.equal(out.issue_title, "Feature X");
  assert.match(out.issue_body, /## Summary/);
  assert.match(out.issue_body, /## Acceptance Criteria/);
  assert.match(out.issue_body, /taxi:fallback_issue_spec reason=writer_output_unavailable/);
  assert.match(out.issue_body, new RegExp(`reason=${out.issue_spec_fallback_reason}`));
  assert.equal(out.issue_labels, "feature,ready");
  assert.equal(out.issue_spec_source, "fallback");
  assert.equal(out.issue_spec_fallback_reason, "writer_output_unavailable");
  assert.equal(out.issue_spec_fallback_schema, "hatch.issue_spec.fallback.v1");
});

test("fallbackIssueSpec preserves deterministic output across repeated calls", () => {
  const feature = JSON.stringify({ name: "Feature X", summary: "Ship X", acceptance_criteria: ["A", "B"], risks: ["R1"] });
  const first = fallbackIssueSpec("", feature);
  const second = fallbackIssueSpec("", feature);
  assert.equal(first, second);
});

test("fallbackIssueSpec does not duplicate provenance marker when feature summary already includes it", () => {
  const feature = JSON.stringify({
    name: "Feature X",
    summary: "Deterministic fallback issue spec generated because writer output was unavailable.\n\n<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->",
  });
  const out = JSON.parse(fallbackIssueSpec("", feature));
  const marker = "<!-- taxi:fallback_issue_spec reason=writer_output_unavailable -->";
  assert.equal(out.issue_body.includes(marker), true);
  assert.equal(out.issue_body.split(marker).length - 1, 1);
});

test("fallbackIssueSpec rejects non-string feature fields and falls back deterministically", () => {
  const feature = JSON.stringify({
    name: { nested: "bad" },
    summary: 42,
    acceptance_criteria: ["string-criterion", 17, { nope: true }],
    risks: [false, "risk-1", null],
  });
  const out = JSON.parse(fallbackIssueSpec("", feature));
  assert.equal(out.issue_title, "Bootstrap feature");
  assert.match(out.issue_body, /Deterministic fallback issue spec generated because writer output was unavailable\./);
  assert.match(out.issue_body, /- string-criterion/);
  assert.equal(out.issue_body.includes("- 17"), false);
  assert.equal(out.issue_body.includes("- risk-1"), true);
});

test("fallbackIssueSpec rejects invalid existing issue spec scalar types and rebuilds deterministic fallback", () => {
  const invalidExisting = JSON.stringify({
    issue_title: 99,
    issue_body: ["not-string"],
    issue_labels: ["feature", 7],
  });
  const feature = JSON.stringify({ summary: "Recovered from invalid existing issue spec" });
  const out = JSON.parse(fallbackIssueSpec(invalidExisting, feature));
  assert.equal(out.issue_title, "Bootstrap feature");
  assert.match(out.issue_body, /Recovered from invalid existing issue spec/);
  assert.equal(out.issue_labels, "feature,ready");
});

test("normalizeFeatureIssueSpec strips goal labels and enforces feature-ready labels", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "B",
    issue_labels: ["goal", "feature", "ready", "goal"],
  });
  const out = JSON.parse(normalizeFeatureIssueSpec(raw, "{}"));
  assert.deepEqual(out, {
    issue_title: "T",
    issue_body: "B",
    issue_labels: "feature,ready",
  });
});

test("normalizeFeatureIssueSpec does not force-add feature when LLM outputs bug label", () => {
  const raw = JSON.stringify({
    issue_title: "Fix recovery pricing",
    issue_body: "GTC recovery uses wrong VWAP",
    issue_labels: ["bug"],
  });
  const out = JSON.parse(normalizeFeatureIssueSpec(raw, "{}"));
  assert.equal(out.issue_labels, "bug,ready");
  assert.ok(!out.issue_labels.includes("feature"),
    "bug and feature labels must not coexist");
});

test("normalizeFeatureIssueSpec keeps feature when no bug label is present", () => {
  const raw = JSON.stringify({
    issue_title: "Add new endpoint",
    issue_body: "Wire the new API",
    issue_labels: [],
  });
  const out = JSON.parse(normalizeFeatureIssueSpec(raw, "{}"));
  assert.equal(out.issue_labels, "feature,ready");
});

test("normalizeFeatureIssueSpec does not force-add feature when bug+feature both specified by LLM", () => {
  const raw = JSON.stringify({
    issue_title: "Fix and extend",
    issue_body: "Both bug and feature",
    issue_labels: ["bug", "feature"],
  });
  const out = JSON.parse(normalizeFeatureIssueSpec(raw, "{}"));
  assert.equal(out.issue_labels, "bug,ready");
});

test("normalizeFeatureIssueSpec falls back to deterministic feature issue spec when writer output is invalid", () => {
  const feature = JSON.stringify({ name: "Ship X", summary: "Do the thing." });
  const out = JSON.parse(normalizeFeatureIssueSpec("{broken", feature));
  assert.equal(out.issue_title, "Ship X");
  assert.equal(out.issue_labels, "feature,ready");
});

test("fallbackIssueSpecBundle returns issue spec plus base64 transport", () => {
  const feature = JSON.stringify({ name: "Ship X", summary: "Do the thing." });
  const out = JSON.parse(fallbackIssueSpecBundle("", feature));
  assert.equal(typeof out.issue_spec, "string");
  assert.equal(Buffer.from(out.issue_spec_b64, "base64").toString("utf8"), out.issue_spec);
});

test("normalizeFeatureIssueSpecBundle returns normalized issue spec plus base64 transport", () => {
  const raw = JSON.stringify({
    issue_title: "T",
    issue_body: "B",
    issue_labels: ["goal"],
  });
  const out = JSON.parse(normalizeFeatureIssueSpecBundle(raw, "{}"));
  const parsedIssueSpec = JSON.parse(out.issue_spec);
  assert.equal(parsedIssueSpec.issue_labels, "feature,ready");
  assert.equal(Buffer.from(out.issue_spec_b64, "base64").toString("utf8"), out.issue_spec);
});

test("normalizeIssueUrlArray removes blanks, invalid entries, and duplicates", () => {
  const out = JSON.parse(normalizeIssueUrlArray(JSON.stringify([
    " https://github.com/recallnet/astrochicken/issues/1937 ",
    "",
    "bad",
    "https://github.com/recallnet/astrochicken/issues/1937",
    "https://github.com/recallnet/astrochicken/issues/1938",
  ])));
  assert.deepEqual(out, [
    "https://github.com/recallnet/astrochicken/issues/1937",
    "https://github.com/recallnet/astrochicken/issues/1938",
  ]);
});

test("normalizeIssueUrlArray accepts fan-out issue_url object payloads", () => {
  const out = JSON.parse(normalizeIssueUrlArray(JSON.stringify([
    { ok: true, issue_url: "https://github.com/recallnet/astrochicken/issues/1939" },
    "{\"ok\":true,\"issue_url\":\"https://github.com/recallnet/astrochicken/issues/1940\"}",
    { ok: false, issue_url: "" },
    "{\"ok\":true,\"issue_url\":\"https://github.com/recallnet/astrochicken/issues/1939\"}",
  ])));
  assert.deepEqual(out, [
    "https://github.com/recallnet/astrochicken/issues/1939",
    "https://github.com/recallnet/astrochicken/issues/1940",
  ]);
});

test("inspectJsonPair falls back to secondary when primary is invalid", () => {
  const out = JSON.parse(inspectJsonPair("{broken", "[{\"id\":\"F-2\"}]"));
  assert.equal(out.decompose_parse_status, "valid_json");
  assert.equal(out.decompose_parse_source, "secondary");
});

test("fallbackJsonPair returns secondary when primary is invalid", () => {
  assert.equal(fallbackJsonPair("{broken", "[{\"id\":\"F-2\"}]"), '[{"id":"F-2"}]');
});

test("inspectJsonPair skips empty primary arrays and reports secondary source", () => {
  const out = JSON.parse(inspectJsonPair("[]", "[{\"id\":\"F-2\"}]"));
  assert.equal(out.decompose_parse_status, "valid_json");
  assert.equal(out.decompose_parse_source, "secondary");
});

test("fallbackJsonPair skips unusable primary arrays and canonicalizes secondary", () => {
  assert.equal(fallbackJsonPair("[null,\"oops\"]", "[ { \"id\": \"F-2\" } ]"), '[{"id":"F-2"}]');
});

test("fallbackJsonPair returns [] when neither candidate has feature objects", () => {
  assert.equal(fallbackJsonPair("[]", "[null,\"oops\"]"), "[]");
});

test("fallbackJson emits bootstrap feature for empty decomposition output", () => {
  const out = JSON.parse(fallbackJson("", "", { goalNumber: "206" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.ok(out[0].summary.includes("goal #206"));
});

test("normalizeApproved maps decompose approval booleans deterministically", () => {
  assert.equal(normalizeApproved("true"), "true");
  assert.equal(normalizeApproved("1"), "true");
  assert.equal(normalizeApproved("yes"), "true");
  assert.equal(normalizeApproved(""), "false");
  assert.equal(normalizeApproved("no"), "false");
});

test("normalizeApproved extracts approved from JSON embedded in prose (LLM output format violation recovery)", () => {
  // Reviewer output with prose preamble before ```json ... ``` block
  const proseWithJsonBlock = [
    "Here is my analysis of the features.",
    "All deliverables are covered.",
    "",
    "```json",
    JSON.stringify({ approved: true, approved_features: [{ id: "F-1", name: "Test" }], review_notes: "LGTM" }),
    "```",
  ].join("\n");
  assert.equal(normalizeApproved(proseWithJsonBlock), "true");

  // Rejected decomposition in JSON block
  const proseWithRejection = [
    "Feature F-3 is missing coverage.",
    "```json",
    JSON.stringify({ approved: false, approved_features: [], review_notes: "Missing F-3." }),
    "```",
  ].join("\n");
  assert.equal(normalizeApproved(proseWithRejection), "false");

  // No JSON block at all — should still return false
  assert.equal(normalizeApproved("The decomposition looks great!"), "false");

  // Bare JSON object at end (no fence)
  const bareJson = 'Analysis complete.\n{"approved":true,"approved_features":[],"review_notes":"ok"}';
  assert.equal(normalizeApproved(bareJson), "true");

  // Bare JSON object followed by trailing junk should still recover approved=true.
  const bareJsonWithTrailingNoise = [
    "Analysis complete.",
    '{"approved":true,"approved_features":[{"id":"F-1","name":"Test"}],"review_notes":"ok"}',
    "---",
    "false",
    "---",
  ].join("\n");
  assert.equal(normalizeApproved(bareJsonWithTrailingNoise), "true");
});

test("normalizeDecision maps case-insensitive approved/revise and fails closed", () => {
  assert.equal(normalizeDecision("approved"), "approved");
  assert.equal(normalizeDecision("APPROVED"), "approved");
  assert.equal(normalizeDecision("ReViSe"), "revise");
  assert.equal(normalizeDecision(""), "revise");
  assert.equal(normalizeDecision("   "), "revise");
  assert.equal(normalizeDecision("unknown"), "revise");
});

test("incrementCounter increments deterministic string counters", () => {
  assert.equal(incrementCounter("0"), "1");
  assert.equal(incrementCounter("2"), "3");
  assert.equal(incrementCounter("abc"), "1");
  assert.equal(incrementCounter(""), "1");
});
