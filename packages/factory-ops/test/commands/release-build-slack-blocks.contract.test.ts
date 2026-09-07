import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SLACK_CONCEPTUAL_SHIFT_FALLBACK,
  SLACK_NARRATIVE_HEADLINE_FALLBACK,
  SLACK_NARRATIVE_SUMMARY_FALLBACK,
  SLACK_WATCH_ITEMS_FALLBACK,
  buildReleaseSlackBlocksPayload,
} from "../../src/commands/release-build-slack-blocks.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const fixturesDir = join(repoRoot, "packages/factory-ops/test/commands/fixtures/release");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function fixtureJson(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

test("release build-slack-blocks CLI wiring includes payload transport flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/release-delivery-cmds.ts", "utf8");
  assert.match(source, /class ReleaseBuildSlackBlocksCommand/);
  assert.match(source, /static paths = \[\["release", "build-slack-blocks"\]\]/);
  assert.match(source, /Option\.String\("--context", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--context-b64", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--narrative", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--narrative-b64", \{ required: false \}\)/);
});

test("buildReleaseSlackBlocksPayload assembles deterministic block order and sections", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");

  const payload = buildReleaseSlackBlocksPayload({ context, narrative });
  assert.equal(typeof payload.text, "string");
  assert.deepEqual(payload.blocks.map((block) => block.type), [
    "header",
    "section",
    "context",
    "section",
    "context",
  ]);

  assert.equal(payload.blocks[0].text.text, ":rocket: Fleet-wide factory health in one command");
  assert.match(payload.blocks[1].text.text, /clusters shipped goals, merge throughput, and wave timing/);

  const comprehensionText = payload.blocks[2].elements[0].text;
  assert.match(comprehensionText, /^Comprehension:/);
  assert.match(comprehensionText, /significance-gated comprehension brief/);
  assert.match(comprehensionText, /entry `packages\/capability-release-reporting\/graphs\/release_report_flow\.dot`/);

  const goalsText = payload.blocks[3].text.text;
  assert.match(goalsText, /^\*Goals Shipped\*/);
  assert.match(goalsText, /<https:\/\/github\.com\/recallnet\/astrochicken\/issues\/1488\|#1488 Fleet visibility & operator status>/);
  assert.match(goalsText, /<https:\/\/github\.com\/recallnet\/astrochicken\/issues\/1517\|#1517 Release report context assembly>/);

  const contextLine = payload.blocks[4].elements[0].text;
  assert.match(contextLine, /7 issues/);
  assert.match(contextLine, /12 commits/);
  assert.match(contextLine, /avg wave 38m/);
  assert.match(contextLine, /\+892 -214/);
  assert.match(contextLine, /mothership/);
});

test("buildReleaseSlackBlocksPayload emits explicit goals fallback for zero-goal context", () => {
  const context = fixtureJson("report-context.zero-goals.json");
  const narrative = fixtureJson("narrative.typical.json");

  const payload = buildReleaseSlackBlocksPayload({ context, narrative });
  assert.equal(payload.blocks[3].text.text, "*Goals Shipped*\n- None");
});

test("buildReleaseSlackBlocksPayload compacts oversized goal lists to stay within Slack block limits", () => {
  const baseContext = fixtureJson("report-context.typical.json");
  const narrative = {
    headline: "Wave reviewer context eliminates 100-percent force-merge failure mode",
      summary:
      "The issue executor's reviewer now receives full goal, wave, and scoped diff context before rendering a verdict, closing the systemic review exhaustion that drove a 100% force-merge rate across 60+ issues in 24 hours. With genuine review verdicts replacing unconditional force-merge fallbacks alongside fixes to normalize_features dropping all decompose output and LLM merge conflict resolution, operators can now treat review outcomes as real quality signals and rely on wave throughput as a meaningful measure of pipeline health rather than fallback churn.",
  };
  const context = {
    ...baseContext,
    generated_at: "2026-03-11T01:32:02.706Z",
    goals: Array.from({ length: 29 }, (_, index) => ({
      number: 1700 + index,
      title: `Goal ${index + 1}: ${"x".repeat(80)}`,
      url: `https://github.com/recallnet/astrochicken/issues/${1700 + index}`,
      closed_at: "2026-03-11T00:40:40.000Z",
    })),
    metrics: {
      goals_closed: 29,
      issues_closed: 88,
      commits_landed: 0,
    },
    timing: {
      avg_wave_minutes: 27.85,
    },
    diff_stats: {
      text: "+0 -0",
    },
  };

  const payload = buildReleaseSlackBlocksPayload({ context, narrative });

  assert.ok(payload.blocks[3].text.text.length <= 3000, `goals section too large: ${payload.blocks[3].text.text.length}`);
  assert.match(payload.blocks[3].text.text, /\*Goals Shipped\*/);
  assert.match(payload.blocks[3].text.text, /\.\.\. and \d+ more goals/);
  assert.ok(payload.blocks[4].elements.every((element) => String(element.text || "").length <= 300));
});

test("buildReleaseSlackBlocksPayload fails fast when required metrics are missing", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");

  const invalidContext = {
    ...context,
    metrics: {
      issues_closed: 7,
    },
  };

  assert.throws(
    () => buildReleaseSlackBlocksPayload({ context: invalidContext, narrative }),
    /context.metrics.commits_landed must be a finite number/,
  );
});

test("release build-slack-blocks supports raw and base64 payload transports with parity", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");

  const rawRun = spawnSync("node", [
    opsCliPath,
    "release",
    "build-slack-blocks",
    "--context",
    JSON.stringify(context),
    "--narrative",
    JSON.stringify(narrative),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(rawRun.status, 0, rawRun.stderr || rawRun.stdout);
  const rawPayload = JSON.parse(rawRun.stdout || "{}");

  const b64Run = spawnSync("node", [
    opsCliPath,
    "release",
    "build-slack-blocks",
    "--context-b64",
    Buffer.from(JSON.stringify(context), "utf8").toString("base64"),
    "--narrative-b64",
    Buffer.from(JSON.stringify(narrative), "utf8").toString("base64"),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(b64Run.status, 0, b64Run.stderr || b64Run.stdout);
  const b64Payload = JSON.parse(b64Run.stdout || "{}");
  assert.deepEqual(b64Payload, rawPayload);
});

test("buildReleaseSlackBlocksPayload includes report issue link when reportIssueUrl provided", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");
  const issueUrl = "https://github.com/recallnet/astrochicken/issues/2410";

  const payload = buildReleaseSlackBlocksPayload({
    context,
    narrative,
    reportIssueUrl: issueUrl,
  });

  // Button accessory on summary section
  assert.equal(payload.blocks[1].type, "section");
  assert.equal(payload.blocks[1].accessory?.type, "button");
  assert.equal(payload.blocks[1].accessory?.url, issueUrl);
  assert.equal(payload.blocks[1].accessory?.text?.text, "Open report");

  // Footer link in the stats context block
  const footerBlock = payload.blocks[payload.blocks.length - 1];
  assert.equal(footerBlock.type, "context");
  assert.ok(footerBlock.elements.length >= 2, "footer context must include stats and report issue link");
  const linkElement = footerBlock.elements.find((el) => el.text.includes("Full report issue"));
  assert.ok(linkElement, "footer must contain 'Full report issue' link");
  assert.match(linkElement.text, new RegExp(`<${issueUrl.replace(/[/]/g, "\\/")}\\|Full report issue>`));
});

test("buildReleaseSlackBlocksPayload omits footer report link when reportIssueUrl is absent", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");

  const payload = buildReleaseSlackBlocksPayload({ context, narrative });

  const footerBlock = payload.blocks[payload.blocks.length - 1];
  assert.equal(footerBlock.elements.length, 1, "footer must have only stats when no report issue URL");
  assert.doesNotMatch(footerBlock.elements[0].text, /Full report issue/);
});

test("release build-slack-blocks exports deterministic fallback constants", () => {
  assert.equal(SLACK_NARRATIVE_HEADLINE_FALLBACK, "Comprehension detail pending.");
  assert.equal(SLACK_NARRATIVE_SUMMARY_FALLBACK, "Comprehension detail pending.");
  assert.equal(SLACK_CONCEPTUAL_SHIFT_FALLBACK, "Conceptual shift was not described by the narrator.");
  assert.equal(SLACK_WATCH_ITEMS_FALLBACK, "No watch items were provided.");
});

test("release build-slack-blocks rejects mixed transport and malformed inputs", () => {
  const context = fixtureJson("report-context.typical.json");
  const narrative = fixtureJson("narrative.typical.json");

  const mixedTransportRun = spawnSync("node", [
    opsCliPath,
    "release",
    "build-slack-blocks",
    "--context",
    JSON.stringify(context),
    "--context-b64",
    Buffer.from(JSON.stringify(context), "utf8").toString("base64"),
    "--narrative",
    JSON.stringify(narrative),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(mixedTransportRun.status, 1);
  assert.match(mixedTransportRun.stderr, /context accepts one transport: --context or --context-b64/);

  const malformedContextRun = spawnSync("node", [
    opsCliPath,
    "release",
    "build-slack-blocks",
    "--context",
    "{not-json",
    "--narrative",
    JSON.stringify(narrative),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(malformedContextRun.status, 1);
  assert.match(malformedContextRun.stderr, /--context must be valid JSON/);

  const missingNarrativeFieldRun = spawnSync("node", [
    opsCliPath,
    "release",
    "build-slack-blocks",
    "--context",
    JSON.stringify(context),
    "--narrative",
    JSON.stringify({ delivery_decision: "slack_and_issue", headline: "Only headline" }),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(missingNarrativeFieldRun.status, 0, missingNarrativeFieldRun.stderr || missingNarrativeFieldRun.stdout);
  const missingNarrativePayload = JSON.parse(missingNarrativeFieldRun.stdout || "{}");
  assert.equal(missingNarrativePayload.blocks[0].text.text, ":rocket: Only headline");
  assert.match(missingNarrativePayload.blocks[1].text.text, /Comprehension detail pending\./);
});
