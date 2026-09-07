import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadAgentGuidanceContext } from "../../src/commands/common-load-agent-guidance.ts";

test("loadAgentGuidanceContext loads AGENTS and recent AGENT-LEARNINGS excerpts", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-"));
  writeFileSync(join(root, "AGENTS.md"), "# AGENTS\n\nPolicy line 1\nPolicy line 2\n", "utf8");
  writeFileSync(
    join(root, "AGENT-LEARNINGS.md"),
    [
      "# Agent Learnings",
      "",
      "preface",
      "",
      "### 2026-03-18 — Newest",
      "Insight A",
      "",
      "### 2026-03-17 — Prior",
      "Insight B",
      "",
      "### 2026-03-16 — Older",
      "Insight C",
      "",
    ].join("\n"),
    "utf8",
  );

  const out = loadAgentGuidanceContext({
    repoRoot: root,
    learningsEntryCount: "2",
  });

  assert.equal(out.agents_found, "true");
  assert.match(out.agents_excerpt, /Policy line 1/);
  assert.equal(out.agent_learnings_found, "true");
  assert.equal(out.agent_learnings_entry_count, "2");
  assert.match(out.agent_learnings_excerpt, /2026-03-18/);
  assert.match(out.agent_learnings_excerpt, /2026-03-17/);
  assert.doesNotMatch(out.agent_learnings_excerpt, /2026-03-16/);
});

test("loadAgentGuidanceContext truncates long excerpts with deterministic marker", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-truncate-"));
  writeFileSync(join(root, "AGENTS.md"), "# AGENTS\n\n0123456789abcdefghij\n", "utf8");
  writeFileSync(join(root, "AGENT-LEARNINGS.md"), "# Agent Learnings\n\n### 2026-03-18 — Entry\n0123456789abcdefghij\n", "utf8");

  const out = loadAgentGuidanceContext({
    repoRoot: root,
    agentsMaxChars: "10",
    learningsMaxChars: "10",
  });

  assert.match(out.agents_excerpt, /truncated AGENTS\.md/);
  assert.match(out.agent_learnings_excerpt, /truncated AGENT-LEARNINGS\.md/);
});

test("loadAgentGuidanceContext fail-closes to explicit missing placeholders", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-missing-"));
  const out = loadAgentGuidanceContext({ repoRoot: root });

  assert.equal(out.agents_found, "false");
  assert.equal(out.agents_excerpt, "(missing AGENTS.md)");
  assert.equal(out.agent_learnings_found, "false");
  assert.equal(out.agent_learnings_excerpt, "(missing AGENT-LEARNINGS.md)");
  assert.equal(out.agent_learnings_entry_count, "0");
});

test("loadAgentGuidanceContext uses explicit agentsPath relative to repoRoot", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-custom-path-"));
  mkdirSync(join(root, "factories", "mothership"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Root AGENTS\nRoot content\n", "utf8");
  writeFileSync(join(root, "factories", "mothership", "AGENTS.md"), "# Factory AGENTS\nFactory-specific builder content\n", "utf8");

  const out = loadAgentGuidanceContext({
    repoRoot: root,
    agentsPath: "factories/mothership/AGENTS.md",
  });

  assert.equal(out.agents_found, "true");
  assert.match(out.agents_excerpt, /Factory-specific builder content/);
  assert.doesNotMatch(out.agents_excerpt, /Root content/);
});

test("loadAgentGuidanceContext falls back to empty string when custom agentsPath is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-missing-custom-"));
  const out = loadAgentGuidanceContext({
    repoRoot: root,
    agentsPath: "factories/nonexistent/AGENTS.md",
  });

  assert.equal(out.agents_found, "false");
  assert.equal(out.agents_excerpt, "");
});

test("loadAgentGuidanceContext falls back to empty string when custom agentLearningsPath is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-guidance-missing-custom-learnings-"));
  const out = loadAgentGuidanceContext({
    repoRoot: root,
    agentLearningsPath: "factories/nonexistent/AGENT-LEARNINGS.md",
  });

  assert.equal(out.agent_learnings_found, "false");
  assert.equal(out.agent_learnings_excerpt, "");
});
