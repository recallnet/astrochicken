import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const skillsRoot = join(repoRoot, "factories/mothership/skills");
const skillName = "hatch_factory_architect";
const skillDir = join(skillsRoot, skillName);
const interfacePath = join(skillDir, "interface.json");
const contextPackPath = join(skillDir, "context-pack.json");
const currentPath = join(skillDir, "current.md");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

const REQUIRED_OUTPUT_SCHEMA_KEYS = [
  "design_summary",
  "playbook_steps",
  "validation_commands",
  "next_actions",
  "context_keys_used",
];

const REQUIRED_CONTEXT_PATTERNS = [
  "AGENTS.md",
  "docs/skills/factory-design/SKILL.md",
  "docs/skills/factory-design/templates/**",
  "apps/hatch/src/cli.ts",
  "apps/hatch/src/pipeline/**/*.ts",
  "apps/hatch/src/dispatch/**/*.ts",
  "factories/mothership/graphs/*.dot",
  "packages/factory-ops/src/**/*.mjs",
  "factories/mothership/factory.config.json",
  "docs/factory-supervisor-tick.md",
  "docs/reference/factory-native-subagent-contract.md",
];

const REQUIRED_JUDGE_CONTEXT_INPUTS = [
  "judge_context_path",
  "judge_context_sha256",
  "judge_context_valid",
  "judge_context_error",
  "judge_scenario_selection_path",
  "judge_scenario_selection_sha256",
  "judge_scenario_selection_signature_sha256",
  "judge_context_identity",
  "judge_context_purpose",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function entryPattern(entry = {}) {
  if (typeof entry.path === "string" && entry.path.trim()) return entry.path.trim();
  if (typeof entry.glob === "string" && entry.glob.trim()) return entry.glob.trim();
  return "";
}

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globPatternToRegex(globPattern = "") {
  const normalized = String(globPattern).replaceAll("\\", "/").trim();
  const withSentinel = normalized.replaceAll("**", "__DOUBLE_STAR__");
  const escaped = escapeRegex(withSentinel);
  const regexPattern = escaped
    .replaceAll("__DOUBLE_STAR__", ".*")
    .replaceAll("\\*", "[^/]*");
  return new RegExp(`^${regexPattern}$`);
}

function patternCoversPath(pattern = "", path = "") {
  if (!pattern) return false;
  if (!pattern.includes("*")) return pattern === path;
  return globPatternToRegex(pattern).test(path);
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

test("hatch_factory_architect skill artifact exists under skills root", () => {
  assert.equal(existsSync(skillDir), true, `Missing skill directory: ${skillDir}`);
  assert.equal(existsSync(interfacePath), true, `Missing interface.json: ${interfacePath}`);
  assert.equal(existsSync(contextPackPath), true, `Missing context-pack.json: ${contextPackPath}`);
  assert.equal(existsSync(currentPath), true, `Missing current.md: ${currentPath}`);

  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(skillDirs.includes(skillName), `${skillName} must be discoverable under ${skillsRoot}`);
});

test("interface.json validates via ops CLI and exposes required Hatch architect contract keys", () => {
  const run = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "validate-interface",
      "--skill-name",
      skillName,
      "--skills-root",
      "factories/mothership/skills",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);

  const interfaceDoc = readJson(interfacePath);
  const outputKeys = Object.keys(interfaceDoc.output_schema?.properties || {});
  for (const key of REQUIRED_OUTPUT_SCHEMA_KEYS) {
    assert.ok(outputKeys.includes(key), `output_schema.properties missing key: ${key}`);
  }

  assert.deepEqual(unique(interfaceDoc.tools?.allowed || []).sort(), ["glob", "grep", "read"]);
  assert.equal(interfaceDoc.safety?.may_modify_tests, false);
  assert.equal(interfaceDoc.safety?.may_create_files, false);
  assert.equal(interfaceDoc.safety?.may_delete_files, false);
  assert.equal(interfaceDoc.safety?.may_run_destructive_commands, false);

  assert.ok((interfaceDoc.pi_coding_agent?.supported_prompts || []).includes("primary"));
  assert.ok((interfaceDoc.pi_coding_agent?.supported_prompts || []).includes("revise"));

  const judgeInputs = unique(interfaceDoc.pi_coding_agent?.judge_context_inputs || []);
  for (const input of REQUIRED_JUDGE_CONTEXT_INPUTS) {
    assert.ok(judgeInputs.includes(input), `pi_coding_agent.judge_context_inputs missing: ${input}`);
  }
});

test("context-pack.json covers required architecture paths and current.md doc references", () => {
  const contextPack = readJson(contextPackPath);
  const entries = Array.isArray(contextPack.entries) ? contextPack.entries : [];
  assert.ok(entries.length > 0, "context-pack.json entries must be non-empty");

  const entryKeys = entries.map((entry) => entry.key);
  const uniqueKeys = new Set(entryKeys);
  assert.equal(uniqueKeys.size, entryKeys.length, "context-pack.json entries must use unique keys");

  const patterns = unique(entries.map((entry) => entryPattern(entry)));
  for (const requiredPattern of REQUIRED_CONTEXT_PATTERNS) {
    assert.ok(patterns.includes(requiredPattern), `context-pack.json missing required path/glob: ${requiredPattern}`);
  }

  const interfaceDoc = readJson(interfacePath);
  const requiredContextKeys = unique(interfaceDoc.pi_coding_agent?.required_context_keys || []).sort();
  const contextPackKeys = unique(entries.map((entry) => entry.key)).sort();
  assert.deepEqual(requiredContextKeys, contextPackKeys, "interface required_context_keys must match context-pack entry keys");

  const currentMd = readFileSync(currentPath, "utf8");
  const referencedDocs = unique(
    Array.from(currentMd.matchAll(/`(docs\/[^`]+\.md)`/g), (match) => match[1]),
  );

  for (const docPath of referencedDocs) {
    const covered = patterns.some((pattern) => patternCoversPath(pattern, docPath));
    assert.ok(covered, `context-pack.json must cover doc referenced by current.md: ${docPath}`);
  }
});

test("current.md includes mandated architect sections, playbooks, validation checklist, invocation, and boundaries", () => {
  const currentMd = readFileSync(currentPath, "utf8");

  assert.match(currentMd, /^## Identity and purpose$/m);
  assert.match(currentMd, /^## Curated context pack \(`context-pack\.json`\)$/m);
  assert.match(currentMd, /Always load `factories\/mothership\/skills\/hatch_factory_architect\/context-pack\.json` first\./);
  assert.match(currentMd, /^## Playbooks$/m);
  assert.match(currentMd, /^### 1\) Create a new factory$/m);
  assert.match(currentMd, /^### 2\) Add a new handler$/m);
  assert.match(currentMd, /^### 3\) Add or modify a graph$/m);
  assert.match(currentMd, /^### 4\) Redesign a stuck workflow from first principles$/m);
  assert.match(currentMd, /^### 5\) Turn repeated shell spelunking into an ops CLI command$/m);

  assert.match(currentMd, /^## Completion and validation checklist$/m);
  assert.match(currentMd, /hatch validate/);
  assert.match(currentMd, /pnpm docs:check/);
  assert.match(currentMd, /node scripts\/check-export-coverage\.mjs/);
  assert.match(currentMd, /pnpm test:guard-gates/);
  assert.match(currentMd, /pnpm test:wave-claim-gates/);

  assert.match(currentMd, /^## Invocation \/ operator instructions$/m);
  assert.match(currentMd, /^### Pi runtime \(deterministic\)$/m);
  assert.match(currentMd, /skill validate-interface/);
  assert.match(currentMd, /skill invoke/);

  assert.match(currentMd, /^## Boundaries and anti-patterns$/m);
  assert.match(currentMd, /No general-purpose coding prompts/);
  assert.match(currentMd, /Never use `SKIP_TESTS`\./);
  assert.match(currentMd, /gate-before-fix/);
  assert.match(currentMd, /No compatibility shims, legacy aliases, or dual old\/new code paths\./);

  assert.match(currentMd, /^## Scaffold adoption path$/m);
  assert.match(currentMd, /Canonical source template: `factories\/mothership\/skills\/hatch_factory_architect`\./);
  assert.match(currentMd, /must copy this structure/);
});
