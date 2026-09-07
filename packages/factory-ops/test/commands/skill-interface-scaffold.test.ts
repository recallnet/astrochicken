import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  scaffoldSkillInterface,
  validateSkillInterfaceAtPath,
  validateSkillInterfaceDocument,
} from "../../src/commands/skill-interface-scaffold.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

const REQUIRED_JUDGE_CONTEXT_INPUTS = [
  "judge_context_path",
  "judge_context_sha256",
  "judge_context_valid",
  "judge_context_error",
  "judge_scenario_selection_path",
  "judge_scenario_selection_sha256",
  "judge_scenario_selection_signature_sha256",
];

function createSkillsRootFixture({ includePiMetadata = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "skills-scaffold-"));
  const skillsRoot = join(root, "skills");
  const existingDir = join(skillsRoot, "existing_skill");
  mkdirSync(existingDir, { recursive: true });

  const interfaceDoc = {
    name: "existing_skill",
    version: "0.1.0",
    description: "Existing fixture skill",
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
    },
    tools: {
      allowed: ["read"],
      forbidden: ["bash", "write", "edit", "deploy", "push"],
    },
    safety: {
      may_modify_tests: false,
      may_create_files: false,
      may_delete_files: false,
      may_run_destructive_commands: false,
    },
  };

  if (includePiMetadata) {
    interfaceDoc.pi_coding_agent = {
      supported_prompts: ["primary"],
      required_context_keys: ["goal_context"],
      judge_context_inputs: [...REQUIRED_JUDGE_CONTEXT_INPUTS],
    };
  }

  writeFileSync(join(existingDir, "interface.json"), `${JSON.stringify(interfaceDoc, null, 2)}\n`, "utf8");

  return { root, skillsRoot };
}

function buildValidInterfaceDoc(name = "sample_skill") {
  return {
    name,
    version: "0.1.0",
    description: "Sample",
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
    },
    tools: {
      allowed: ["read"],
      forbidden: ["bash"],
    },
    safety: {
      may_modify_tests: false,
      may_create_files: false,
      may_delete_files: false,
      may_run_destructive_commands: false,
    },
    pi_coding_agent: {
      supported_prompts: ["primary"],
      required_context_keys: ["goal_context"],
      judge_context_inputs: [...REQUIRED_JUDGE_CONTEXT_INPUTS],
    },
  };
}

test("validateSkillInterfaceDocument rejects missing judge context inputs", () => {
  const invalid = buildValidInterfaceDoc("judge_missing");
  invalid.pi_coding_agent.judge_context_inputs = [
    "judge_context_path",
    "judge_context_sha256",
  ];

  const out = validateSkillInterfaceDocument({
    interfaceDoc: invalid,
    skillName: "judge_missing",
    sharedSchema: {
      required_top_level_keys: ["name", "version", "description", "output_schema", "tools", "safety"],
      required_tool_keys: ["allowed", "forbidden"],
      required_safety_keys: [
        "may_modify_tests",
        "may_create_files",
        "may_delete_files",
        "may_run_destructive_commands",
      ],
    },
  });

  assert.equal(out.ok, false);
  assert.ok(out.diagnostics.some((entry) => entry.code === "judge_context_input_missing"));
});

test("validateSkillInterfaceDocument rejects non-string entries in tools arrays", () => {
  const invalid = buildValidInterfaceDoc("tool_type_violation");
  invalid.tools.allowed = ["read", 123, true];
  invalid.tools.forbidden = ["bash", { value: "write" }];

  const out = validateSkillInterfaceDocument({
    interfaceDoc: invalid,
    skillName: "tool_type_violation",
    sharedSchema: {
      required_top_level_keys: ["name", "version", "description", "output_schema", "tools", "safety"],
      required_tool_keys: ["allowed", "forbidden"],
      required_safety_keys: [
        "may_modify_tests",
        "may_create_files",
        "may_delete_files",
        "may_run_destructive_commands",
      ],
    },
  });

  assert.equal(out.ok, false);
  assert.ok(out.diagnostics.some((entry) => entry.code === "tools_key_invalid" && entry.path === "tools.allowed"));
  assert.ok(out.diagnostics.some((entry) => entry.code === "tools_key_invalid" && entry.path === "tools.forbidden"));
});

test("validateSkillInterfaceDocument rejects non-string entries in pi_coding_agent arrays", () => {
  const invalid = buildValidInterfaceDoc("integration_type_violation");
  invalid.pi_coding_agent.supported_prompts = ["primary", 42];
  invalid.pi_coding_agent.required_context_keys = ["goal_context", false];
  invalid.pi_coding_agent.judge_context_inputs = [
    "judge_context_path",
    "judge_context_sha256",
    "judge_context_valid",
    "judge_context_error",
    "judge_scenario_selection_path",
    "judge_scenario_selection_sha256",
    9,
  ];

  const out = validateSkillInterfaceDocument({
    interfaceDoc: invalid,
    skillName: "integration_type_violation",
    sharedSchema: {
      required_top_level_keys: ["name", "version", "description", "output_schema", "tools", "safety"],
      required_tool_keys: ["allowed", "forbidden"],
      required_safety_keys: [
        "may_modify_tests",
        "may_create_files",
        "may_delete_files",
        "may_run_destructive_commands",
      ],
    },
  });

  assert.equal(out.ok, false);
  assert.ok(out.diagnostics.some((entry) => entry.code === "pi_coding_agent_key_invalid" && entry.path === "pi_coding_agent.supported_prompts"));
  assert.ok(out.diagnostics.some((entry) => entry.code === "pi_coding_agent_key_invalid" && entry.path === "pi_coding_agent.required_context_keys"));
  assert.ok(out.diagnostics.some((entry) => entry.code === "pi_coding_agent_key_invalid" && entry.path === "pi_coding_agent.judge_context_inputs"));
});

test("scaffoldSkillInterface dry-run inspects schema and does not write files", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: true });

  const out = scaffoldSkillInterface({
    skillName: "new_skill",
    skillsRoot,
    dryRun: true,
  });

  assert.equal(out.ok, true);
  assert.equal(out.dry_run, true);
  assert.deepEqual(out.created_files, ["interface.json", "current.md", "README.md"]);
  assert.equal(existsSync(join(skillsRoot, "new_skill")), false);
  assert.ok(out.schema.inspected_interface_count >= 1);
  assert.ok(Array.isArray(out.schema.inferred_tool_policy.allowed));
  assert.ok(out.schema.inferred_tool_policy.allowed.includes("read"));
});

test("scaffoldSkillInterface writes interface/current/readme and validateSkillInterfaceAtPath passes", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: true });

  const scaffolded = scaffoldSkillInterface({
    skillName: "skill_router",
    skillsRoot,
    owner: "factory-core",
    dryRun: false,
  });

  assert.equal(scaffolded.ok, true);
  assert.equal(scaffolded.dry_run, false);
  assert.equal(scaffolded.owner, "factory-core");
  assert.equal(existsSync(join(skillsRoot, "skill_router", "interface.json")), true);
  assert.equal(existsSync(join(skillsRoot, "skill_router", "current.md")), true);
  assert.equal(existsSync(join(skillsRoot, "skill_router", "README.md")), true);

  const generatedInterface = JSON.parse(readFileSync(join(skillsRoot, "skill_router", "interface.json"), "utf8"));
  assert.deepEqual(generatedInterface.tools.allowed, ["read"]);
  assert.ok(generatedInterface.tools.forbidden.includes("bash"));

  const generatedPrompt = readFileSync(join(skillsRoot, "skill_router", "current.md"), "utf8");
  assert.match(generatedPrompt, /^## Responsibilities$/m);
  assert.match(generatedPrompt, /- \[ \] Read required context keys before producing output\./);
  assert.match(generatedPrompt, /^## Policy \/ Template References$/m);
  assert.match(generatedPrompt, /^## Required Section Checklist$/m);

  const generatedReadme = readFileSync(join(skillsRoot, "skill_router", "README.md"), "utf8");
  assert.match(generatedReadme, /^## Integrate Into a Factory Pipeline$/m);
  assert.match(generatedReadme, /node packages\/factory-ops\/src\/cli\.mjs skill scaffold-interface/);
  assert.match(generatedReadme, /node packages\/factory-ops\/src\/cli\.mjs skill validate-interface/);
  assert.match(generatedReadme, /^## Required Section Checklist$/m);

  const validated = validateSkillInterfaceAtPath({
    skillName: "skill_router",
    skillsRoot,
  });

  assert.equal(validated.ok, true);
  assert.equal(validated.skill_name, "skill_router");
  assert.equal(validated.diagnostics.length, 0);
});

test("scaffoldSkillInterface surfaces warnings for existing interfaces missing judge metadata", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: false });

  const out = scaffoldSkillInterface({
    skillName: "judge_fallback_skill",
    skillsRoot,
    dryRun: true,
    validateExisting: true,
  });

  assert.equal(out.ok, true);
  assert.ok(
    out.validation.warnings.some((entry) => entry.code === "existing_interface_missing_judge_context_inputs"),
  );
});

test("hatch-ops skill scaffold-interface CLI creates files and returns machine-readable JSON", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: true });

  const run = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "scaffold-interface",
      "--skill-name",
      "cli_scaffold_skill",
      "--skills-root",
      skillsRoot,
      "--owner",
      "qa-team",
      "--dry-run",
      "false",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");

  assert.equal(out.ok, true);
  assert.equal(out.skill_name, "cli_scaffold_skill");
  assert.equal(out.owner, "qa-team");
  assert.equal(out.dry_run, false);
  assert.deepEqual(out.created_files, ["interface.json", "current.md", "README.md"]);
  assert.ok(Array.isArray(out.schema.inferred_tool_policy.allowed));

  assert.equal(existsSync(join(skillsRoot, "cli_scaffold_skill", "interface.json")), true);
  assert.equal(existsSync(join(skillsRoot, "cli_scaffold_skill", "current.md")), true);
  assert.equal(existsSync(join(skillsRoot, "cli_scaffold_skill", "README.md")), true);

  const generatedPrompt = readFileSync(join(skillsRoot, "cli_scaffold_skill", "current.md"), "utf8");
  assert.match(generatedPrompt, /## Owner/);
  assert.match(generatedPrompt, /- qa-team/);
});

test("hatch-ops skill validate-interface CLI validates generated scaffold end-to-end", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: true });

  const scaffoldRun = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "scaffold-interface",
      "--skill-name",
      "cli_validate_skill",
      "--skills-root",
      skillsRoot,
      "--dry-run",
      "false",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(scaffoldRun.status, 0, scaffoldRun.stderr || scaffoldRun.stdout);

  const validateRun = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "validate-interface",
      "--skill-name",
      "cli_validate_skill",
      "--skills-root",
      skillsRoot,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(validateRun.status, 0, validateRun.stderr || validateRun.stdout);

  const out = JSON.parse(validateRun.stdout || "{}");
  assert.equal(out.ok, true);
  assert.equal(out.skill_name, "cli_validate_skill");
  assert.equal(Array.isArray(out.diagnostics), true);
  assert.equal(out.diagnostics.length, 0);
});

test("hatch-ops skill validate-interface CLI fails for invalid generated interface", () => {
  const { skillsRoot } = createSkillsRootFixture({ includePiMetadata: true });

  const scaffoldRun = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "scaffold-interface",
      "--skill-name",
      "cli_invalid_skill",
      "--skills-root",
      skillsRoot,
      "--dry-run",
      "false",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(scaffoldRun.status, 0, scaffoldRun.stderr || scaffoldRun.stdout);

  const brokenInterfacePath = join(skillsRoot, "cli_invalid_skill", "interface.json");
  const brokenDoc = JSON.parse(readFileSync(brokenInterfacePath, "utf8"));
  brokenDoc.name = "wrong_name";
  writeFileSync(brokenInterfacePath, `${JSON.stringify(brokenDoc, null, 2)}\n`, "utf8");

  const validateRun = spawnSync(
    "node",
    [
      opsCliPath,
      "skill",
      "validate-interface",
      "--skill-name",
      "cli_invalid_skill",
      "--skills-root",
      skillsRoot,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(validateRun.status, 1);
  const out = JSON.parse(validateRun.stdout || "{}");
  assert.equal(out.ok, false);
  assert.ok(out.diagnostics.some((entry) => entry.code === "interface_name_mismatch"));
});
