import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectLensData } from "../../src/lib/analysis/lens-collector.ts";

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "analysis-lens-collector-"));
}

test("collectLensData enriches the base bundle with learnings, history, pending suggestions, and inventories", async (t) => {
  const root = fixtureRoot();
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const learningsPath = join(root, "AGENT-LEARNINGS.md");
  const pastLensDir = join(root, "reports", "lens");
  const learningLogPath = join(root, "reports", "analysis-learnings.json");
  const llmInventoryPath = join(root, "factories", "mothership", "inventory", "llm-role-session-baseline.json");
  const timeoutInventoryPath = join(root, "factories", "mothership", "inventory", "goal-decomposition-timeouts.json");

  await fsPromises.mkdir(join(root, "factories", "mothership", "inventory"), { recursive: true });
  await fsPromises.mkdir(pastLensDir, { recursive: true });

  await fsPromises.writeFile(learningsPath, [
    "# Analysis Learnings",
    "",
    "### 2026-03-15",
    "- learned something recent",
    "",
    "### 2026-03-01",
    "- old learning outside window",
    "",
  ].join("\n"), "utf8");

  await fsPromises.writeFile(join(pastLensDir, "2026-03-14.json"), `${JSON.stringify({ date: "2026-03-14", findings: [{ title: "older" }] })}\n`, "utf8");
  await fsPromises.writeFile(join(pastLensDir, "2026-03-15.json"), `${JSON.stringify({ date: "2026-03-15", findings: [{ title: "yesterday" }] })}\n`, "utf8");
  await fsPromises.writeFile(learningLogPath, `${JSON.stringify([
    { id: "lens-pending-1", summary: "pending", type: "suggestion", status: "pending", evidence_refs: [], impact_notes: "" },
    { id: "lens-adopted-1", summary: "adopted", type: "suggestion", status: "adopted", evidence_refs: [], impact_notes: "" },
  ], null, 2)}\n`, "utf8");
  await fsPromises.writeFile(llmInventoryPath, `${JSON.stringify({ roles: [{ role: "reviewer", model: "anthropic/claude-sonnet-4.6" }] }, null, 2)}\n`, "utf8");
  await fsPromises.writeFile(timeoutInventoryPath, `${JSON.stringify({ timeouts: [{ issue: 2140, count: 3 }] }, null, 2)}\n`, "utf8");

  const baseBundle = {
    langfuse: { traces: [{ id: "trace-1" }], meta: { error: "" } },
    github: { issues: [{ number: 1 }], pull_requests: [], meta: { error: "" } },
    git: { commits: [{ sha: "abc" }], meta: { error: "" } },
    hatch_runs: { runs: [{ run_id: "run-1" }], meta: { error: "" } },
    supervisor: { ticks: [{ run_id: "tick-1" }], meta: { error: "" } },
  };

  const payload = await collectLensData({
    date: "2026-03-16",
    repo: "recallnet/astrochicken",
    analysisStart: "2026-03-15T14:30:00.000Z",
    analysisEnd: "2026-03-16T14:30:00.000Z",
    repoPath: root,
    factoryId: "mothership",
    learningLogPath,
    collectDailyInsightDataFn: async () => baseBundle,
  });

  assert.deepEqual(payload.base, baseBundle);
  assert.equal(payload.agent_learnings.entries.length, 1);
  assert.match(payload.agent_learnings.entries[0].heading, /2026-03-15/);
  assert.deepEqual(payload.past_lens_outputs.map((entry) => entry.date).sort(), ["2026-03-14", "2026-03-15"]);
  assert.deepEqual(payload.pending_suggestions.map((entry) => entry.id), ["lens-pending-1"]);
  assert.equal(payload.llm_inventory.roles.length, 1);
  assert.equal(payload.goal_decomposition_timeouts.timeouts.length, 1);
});
