import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateUpstreamBugGate } from "../../src/commands/supervisor-upstream-bug-gate.ts";

const supervisorArtifactSource = readFileSync("packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts", "utf8");

test("evaluateUpstreamBugGate treats body-json needs-triage incidents as non-blocking", () => {
  const body = "Supervisor artifact.\n\n```json\n"
    + `${JSON.stringify({ classification: "needs-triage" }, null, 2)}\n`
    + "```";

  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({
      payload: [
        {
          number: 901,
          title: "[bug] ambiguous incident",
          labels: [{ name: "managed-factory-bug" }],
          body,
        },
      ],
      parse_error: "",
    }),
  });

  assert.equal(gate.has_open_upstream_bugs, "false");
  assert.equal(gate.open_upstream_bug_count, 0);
  assert.deepEqual(gate.open_upstream_bug_numbers, []);
  assert.equal(gate.parse_error, "");
});

test("evaluateUpstreamBugGate keeps body-json infrastructure incidents blocking", () => {
  const body = "Supervisor artifact.\n\n```json\n"
    + `${JSON.stringify({ classification: "infrastructure" }, null, 2)}\n`
    + "```";

  const gate = evaluateUpstreamBugGate({
    repo: "recallnet/astrochicken",
    ghIssueListFn: () => ({
      payload: [
        {
          number: 902,
          title: "[bug] infra incident",
          labels: [{ name: "managed-factory-bug" }],
          body,
        },
      ],
      parse_error: "",
    }),
  });

  assert.equal(gate.has_open_upstream_bugs, "true");
  assert.equal(gate.open_upstream_bug_count, 1);
  assert.deepEqual(gate.open_upstream_bug_numbers, [902]);
  assert.equal(gate.parse_error, "");
});

test("emitBugIssue normalizes source metadata through evidence fallback chain", () => {
  assert.ok(
    supervisorArtifactSource.includes("normalizedSourceFactory = trim(sourceFactory || evidenceObject.source_factory)"),
    "emitBugIssue must derive normalizedSourceFactory from param-first + evidence fallback",
  );
  assert.ok(
    supervisorArtifactSource.includes("normalizedSourceRepo = trim(sourceRepo || evidenceObject.source_repo)"),
    "emitBugIssue must derive normalizedSourceRepo from param-first + evidence fallback",
  );
  assert.ok(
    supervisorArtifactSource.includes("if (normalizedSourceFactory) payload.source_factory = normalizedSourceFactory"),
    "emitBugIssue must emit payload.source_factory when normalized source factory is present",
  );
  assert.ok(
    supervisorArtifactSource.includes("source_repo: normalizedSourceRepo"),
    "emitBugIssue payload must carry normalized source repo",
  );
});

test("emitBugIssue routes example-trading managed labels through normalized metadata", () => {
  assert.ok(
    supervisorArtifactSource.includes("resolveBugLabels({ repo: normalizedRepo, sourceRepo: normalizedSourceRepo, labels, incidentPacket })"),
    "emitBugIssue must pass normalized repo/sourceRepo + labels + incidentPacket into managed-label resolver",
  );
  assert.ok(
    supervisorArtifactSource.includes("if (shouldApplyReplayLabManagedLabels({ repo, sourceRepo }))"),
    "managed-label resolver must route through shouldApplyReplayLabManagedLabels",
  );
  assert.ok(
    supervisorArtifactSource.includes("resolved.push(MANAGED_FACTORY_BUG_LABEL, EXAMPLE_TRADING_FACTORY_LABEL)"),
    "example-trading managed label routing must add managed-factory and example-trading labels",
  );
});
