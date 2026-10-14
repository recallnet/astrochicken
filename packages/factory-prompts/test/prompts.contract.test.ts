import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const promptsRoot = new URL("../prompts/", import.meta.url).pathname;

test("factory prompts package exports prompt trees with markdown content", () => {
  assert.equal(existsSync(promptsRoot), true);
  const promptFamilies = readdirSync(promptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(promptFamilies, [
    "daily_lens",
    "goal_decomposer",
    "merge_resolver",
    "supervisor",
  ]);
});

test("factory prompts markdown files are non-empty and instruction-bearing", () => {
  const files = [
    "daily_lens/agent_analysis.md",
    "goal_decomposer/analyze.md",
    "goal_decomposer/propose.md",
    "goal_decomposer/review.md",
    "goal_decomposer/system.md",
    "merge_resolver/system.md",
    "supervisor/system.md",
  ];

  for (const relativePath of files) {
    const content = readFileSync(join(promptsRoot, relativePath), "utf8");
    assert.match(content, /\S/, `${relativePath} must not be empty`);
    assert.match(content, /[A-Za-z]{3,}/, `${relativePath} must contain readable instructions`);
  }
});
