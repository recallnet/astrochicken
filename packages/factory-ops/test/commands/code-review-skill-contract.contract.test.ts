import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const skillDir = join(repoRoot, "factories/mothership/skills/code_review");
const skillMd = join(skillDir, "SKILL.md");
const repoMd = join(skillDir, "REPO.md");

test("SKILL.md exists and is non-empty", () => {
  assert.equal(existsSync(skillMd), true, `missing SKILL.md: ${skillMd}`);
  assert.ok(readFileSync(skillMd, "utf8").trim().length > 0, "SKILL.md must be non-empty");
});

test("SKILL.md frontmatter has required fields", () => {
  const content = readFileSync(skillMd, "utf8");
  assert.match(content, /^name: code-review$/m);
  assert.match(content, /^description: .+$/m);
});

test("SKILL.md contains the non-QA boundary", () => {
  const content = readFileSync(skillMd, "utf8");
  assert.match(content, /(Code review is not QA|not QA execution)/);
  assert.match(content, /(Do not turn this into a generic QA|not QA execution)/);
});

test("SKILL.md contains revise feedback contract elements", () => {
  const content = readFileSync(skillMd, "utf8");
  assert.match(content, /issue-scoped/);
  assert.match(content, /[Aa]ctionable/);
  assert.match(content, /[Gg]rounded/);
});

test("SKILL.md contains approve/revise criteria section", () => {
  const content = readFileSync(skillMd, "utf8");
  assert.match(content, /Approve only when/);
  assert.match(content, /Revise when/);
});

test("SKILL.md contains JSON output format with required keys", () => {
  const content = readFileSync(skillMd, "utf8");
  assert.match(content, /"schema": "verdict\/v1"/);
  assert.match(content, /"verdict_kind": "code_review"/);
  assert.match(content, /"disposition": "approve\|reject"/);
  assert.match(content, /"reason_codes"/);
  assert.match(content, /"notes"/);
});

test("REPO.md exists and is non-empty", () => {
  assert.equal(existsSync(repoMd), true, `missing REPO.md: ${repoMd}`);
  assert.ok(readFileSync(repoMd, "utf8").trim().length > 0, "REPO.md must be non-empty");
});

test("REPO.md contains shared-wave scope discipline", () => {
  const content = readFileSync(repoMd, "utf8");
  assert.match(content, /issue_changed_files/);
});

test("REPO.md contains gh issue view instructions", () => {
  const content = readFileSync(repoMd, "utf8");
  assert.match(content, /gh issue view/);
});
