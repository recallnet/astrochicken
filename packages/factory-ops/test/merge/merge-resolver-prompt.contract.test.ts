import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptDir = resolve(__dirname, "../../../capability-merge/prompts/merge_resolver");
const skillDir = resolve(__dirname, "../../../capability-merge/skills/merge_conflict_resolver");

function readPrompt(name) {
  return readFileSync(resolve(promptDir, name), "utf8");
}

function readSkill() {
  return readFileSync(resolve(skillDir, "SKILL.md"), "utf8");
}

describe("merge resolver system prompt", () => {
  const system = readPrompt("system.md");

  it("prohibits git checkout --ours/--theirs", () => {
    assert.ok(system.includes("--ours"), "must explicitly prohibit --ours");
    assert.ok(system.includes("--theirs"), "must explicitly prohibit --theirs");
    assert.ok(system.includes("NEVER"), "prohibition must use NEVER");
  });

  it("prohibits --no-verify", () => {
    assert.ok(system.includes("--no-verify"), "must explicitly prohibit --no-verify");
  });

  it("requires reading AGENTS.md", () => {
    assert.ok(system.includes("AGENTS.md"), "must reference AGENTS.md");
  });

  it("requires reading stderr first", () => {
    assert.ok(system.includes("stderr"), "must reference merge stderr");
  });
});

describe("resolve_post_merge prompt", () => {
  const prompt = readPrompt("resolve_post_merge.md");

  it("covers pre-merge QA failures as a distinct failure mode", () => {
    assert.ok(prompt.includes("QA"), "must mention QA failures");
    assert.ok(prompt.includes("pre-merge"), "must reference pre-merge hook");
    assert.ok(prompt.includes("husky") || prompt.includes("hook"), "must reference hook mechanism");
  });

  it("lists common QA violations with fix guidance", () => {
    assert.ok(prompt.includes("oversized"), "must cover oversized-source-file");
    assert.ok(prompt.includes("type-check") || prompt.includes("type error"), "must cover type errors");
    assert.ok(prompt.includes("lint"), "must cover lint failures");
  });

  it("prohibits --ours/--theirs shortcuts", () => {
    assert.ok(prompt.includes("--ours"), "must prohibit --ours");
    assert.ok(prompt.includes("--theirs"), "must prohibit --theirs");
  });

  it("tells resolver to iterate on failures", () => {
    assert.ok(prompt.includes("Do not give up"), "must instruct iteration");
    assert.ok(prompt.includes("60 minutes"), "must mention time budget");
  });
});

describe("resolve_push_failure prompt", () => {
  const prompt = readPrompt("resolve_push_failure.md");

  it("handles hook failures as a distinct push failure mode", () => {
    assert.ok(prompt.includes("hook"), "must mention hook failures");
    assert.ok(prompt.includes("QA") || prompt.includes("gate"), "must reference QA gates");
    assert.ok(prompt.includes("--no-verify"), "must prohibit --no-verify");
  });
});

describe("retry_resolve_conflict prompt", () => {
  const prompt = readPrompt("retry_resolve_conflict.md");

  it("handles hook failures after merge resolution", () => {
    assert.ok(prompt.includes("hook"), "must mention hook failures");
    assert.ok(prompt.includes("--no-verify"), "must prohibit --no-verify");
  });
});

describe("SKILL.md", () => {
  const skill = readSkill();

  it("has a QA failure handling section", () => {
    assert.ok(skill.includes("pre-merge QA"), "must have QA failure section");
  });

  it("covers oversized-source-file resolution", () => {
    assert.ok(skill.includes("oversized-source-file"), "must cover oversized files");
    assert.ok(skill.includes("extract") || skill.includes("split"), "must give extraction guidance");
    assert.ok(skill.includes("re-export") || skill.includes("Re-export"), "must mention re-exporting");
  });

  it("covers unexpected-top-level-directory resolution", () => {
    assert.ok(skill.includes("unexpected-top-level-directory"), "must cover structure violations");
    assert.ok(skill.includes("move") || skill.includes("Move"), "must instruct moving files");
  });

  it("prohibits --ours/--theirs in guardrails", () => {
    assert.ok(skill.includes("--ours"), "must prohibit --ours");
    assert.ok(skill.includes("--theirs"), "must prohibit --theirs");
  });

  it("prohibits --no-verify in guardrails", () => {
    assert.ok(skill.includes("--no-verify"), "must prohibit --no-verify");
  });

  it("instructs iterative fixing", () => {
    assert.ok(skill.includes("60 minutes"), "must mention time budget");
    assert.ok(skill.includes("Do not give up"), "must instruct persistence");
  });
});
