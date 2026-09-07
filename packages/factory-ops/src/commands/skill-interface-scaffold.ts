import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { trim } from "../lib/cli-helpers.ts";

// Canonical factory skill root after intents -> mothership rebrand.
const DEFAULT_SKILLS_ROOT = "factories/mothership/skills";
const BASE_REQUIRED_TOP_LEVEL_KEYS = ["name", "version", "description", "output_schema", "tools", "safety"];
const BASE_REQUIRED_TOOL_KEYS = ["allowed", "forbidden"];
const BASE_REQUIRED_SAFETY_KEYS = [
  "may_modify_tests",
  "may_create_files",
  "may_delete_files",
  "may_run_destructive_commands",
];
const DEFAULT_JUDGE_CONTEXT_INPUTS = [
  "judge_context_path",
  "judge_context_sha256",
  "judge_context_valid",
  "judge_context_error",
  "judge_scenario_selection_path",
  "judge_scenario_selection_sha256",
  "judge_scenario_selection_signature_sha256",
];


function parseBoolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(true|1|yes)$/i.test(String(value).trim());
}

function parseJsonFile(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function toSortedUniqueStrings(values = []) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map((entry) => trim(entry)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "en"));
}

function listSkillDirectories(skillsRoot) {
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right), "en"));
}

function loadExistingInterfaces(skillsRoot) {
  const directories = listSkillDirectories(skillsRoot);
  const loaded = [];
  for (const dir of directories) {
    const interfacePath = join(dir, "interface.json");
    if (!existsSync(interfacePath)) continue;
    loaded.push({
      skill_name: basename(dir),
      interface_path: interfacePath,
      interface: parseJsonFile(interfacePath),
    });
  }
  return loaded;
}

function intersectKeys(objects = []) {
  if (!Array.isArray(objects) || objects.length === 0) return [];
  const first = new Set(Object.keys(objects[0] || {}));
  for (let index = 1; index < objects.length; index += 1) {
    const next = new Set(Object.keys(objects[index] || {}));
    for (const key of Array.from(first)) {
      if (!next.has(key)) first.delete(key);
    }
  }
  return Array.from(first).sort((left, right) => left.localeCompare(right, "en"));
}

function inferSharedSchema(existingInterfaces) {
  const documents = existingInterfaces.map((entry) => entry.interface);
  const topLevelIntersection = intersectKeys(documents);

  const toolObjects = documents
    .map((doc) => (doc && typeof doc.tools === "object" && !Array.isArray(doc.tools) ? doc.tools : null))
    .filter(Boolean);
  const safetyObjects = documents
    .map((doc) => (doc && typeof doc.safety === "object" && !Array.isArray(doc.safety) ? doc.safety : null))
    .filter(Boolean);

  return {
    required_top_level_keys: toSortedUniqueStrings([...BASE_REQUIRED_TOP_LEVEL_KEYS, ...topLevelIntersection]),
    required_tool_keys: toSortedUniqueStrings([...BASE_REQUIRED_TOOL_KEYS, ...intersectKeys(toolObjects)]),
    required_safety_keys: toSortedUniqueStrings([...BASE_REQUIRED_SAFETY_KEYS, ...intersectKeys(safetyObjects)]),
    output_schema_required_keys: ["type", "properties"],
  };
}

function intersectStringArrays(arrays = []) {
  if (!Array.isArray(arrays) || arrays.length === 0) return [];
  const sets = arrays.map((values) => new Set(toSortedUniqueStrings(values)));
  const out = new Set(sets[0]);
  for (let index = 1; index < sets.length; index += 1) {
    for (const value of Array.from(out)) {
      if (!sets[index].has(value)) out.delete(value);
    }
  }
  return Array.from(out).sort((left, right) => left.localeCompare(right, "en"));
}

function inferToolPolicy(existingInterfaces) {
  const allowedArrays = [];
  const forbiddenArrays = [];

  for (const entry of existingInterfaces) {
    const tools = entry.interface?.tools;
    allowedArrays.push(Array.isArray(tools?.allowed) ? tools.allowed : []);
    forbiddenArrays.push(Array.isArray(tools?.forbidden) ? tools.forbidden : []);
  }

  const mergedAllowed = toSortedUniqueStrings(allowedArrays.flat());
  const mergedForbidden = toSortedUniqueStrings(forbiddenArrays.flat());
  const sharedAllowed = intersectStringArrays(allowedArrays);
  const sharedForbidden = intersectStringArrays(forbiddenArrays);

  const allowed = sharedAllowed.length > 0
    ? sharedAllowed
    : (mergedAllowed.length > 0 ? mergedAllowed : ["read"]);

  const forbidden = (sharedForbidden.length > 0 ? sharedForbidden : mergedForbidden)
    .filter((tool) => !allowed.includes(tool));

  return {
    allowed,
    forbidden: forbidden.length > 0 ? forbidden : ["deploy", "push"],
    policy_mode: sharedAllowed.length > 0 ? "shared_intersection" : "merged_union_fallback",
  };
}

function inferSafetyDefaults(existingInterfaces) {
  const counts = {
    may_modify_tests: 0,
    may_create_files: 0,
    may_delete_files: 0,
    may_run_destructive_commands: 0,
  };

  for (const entry of existingInterfaces) {
    const safety = entry.interface?.safety || {};
    for (const key of Object.keys(counts)) {
      if (safety[key] === true) counts[key] += 1;
    }
  }

  // Default to conservative false unless every existing interface marks true.
  const total = existingInterfaces.length || 1;
  return {
    may_modify_tests: counts.may_modify_tests === total,
    may_create_files: counts.may_create_files === total,
    may_delete_files: counts.may_delete_files === total,
    may_run_destructive_commands: counts.may_run_destructive_commands === total,
  };
}

function validateSharedSchemaInputs(existingInterfaces, sharedSchema) {
  const diagnostics = [];

  if (!Array.isArray(existingInterfaces) || existingInterfaces.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "no_existing_skill_interfaces",
      message: "No existing interface.json files found under skills root.",
      path: "",
    });
    return diagnostics;
  }

  for (const key of BASE_REQUIRED_TOP_LEVEL_KEYS) {
    if (!sharedSchema.required_top_level_keys.includes(key)) {
      diagnostics.push({
        severity: "error",
        code: "shared_schema_missing_base_key",
        message: `Shared schema did not include required top-level key \"${key}\".`,
        path: "schema.required_top_level_keys",
      });
    }
  }

  return diagnostics;
}

function isNonEmptyStringArray(value) {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => typeof entry === "string" && trim(entry).length > 0);
}

export function validateSkillInterfaceDocument({ interfaceDoc = {}, skillName = "", sharedSchema = {} } = {}) {
  const diagnostics = [];

  const requiredTopLevel = Array.isArray(sharedSchema.required_top_level_keys)
    ? sharedSchema.required_top_level_keys
    : BASE_REQUIRED_TOP_LEVEL_KEYS;
  const requiredToolKeys = Array.isArray(sharedSchema.required_tool_keys)
    ? sharedSchema.required_tool_keys
    : BASE_REQUIRED_TOOL_KEYS;
  const requiredSafetyKeys = Array.isArray(sharedSchema.required_safety_keys)
    ? sharedSchema.required_safety_keys
    : BASE_REQUIRED_SAFETY_KEYS;

  for (const key of requiredTopLevel) {
    if (!(key in interfaceDoc)) {
      diagnostics.push({
        severity: "error",
        code: "interface_missing_required_key",
        path: key,
        message: `Missing top-level key \"${key}\".`,
      });
    }
  }

  if (trim(interfaceDoc.name) !== trim(skillName)) {
    diagnostics.push({
      severity: "error",
      code: "interface_name_mismatch",
      path: "name",
      message: `Expected name \"${trim(skillName)}\" but got \"${trim(interfaceDoc.name)}\".`,
    });
  }

  if (trim(interfaceDoc.version) === "") {
    diagnostics.push({ severity: "error", code: "interface_version_missing", path: "version", message: "version must be non-empty." });
  }

  if (trim(interfaceDoc.description) === "") {
    diagnostics.push({ severity: "error", code: "interface_description_missing", path: "description", message: "description must be non-empty." });
  }

  const outputSchema = interfaceDoc.output_schema;
  if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) {
    diagnostics.push({ severity: "error", code: "output_schema_invalid", path: "output_schema", message: "output_schema must be an object." });
  } else {
    if (trim(outputSchema.type) !== "object") {
      diagnostics.push({ severity: "error", code: "output_schema_type_invalid", path: "output_schema.type", message: "output_schema.type must be \"object\"." });
    }
    if (!outputSchema.properties || typeof outputSchema.properties !== "object" || Array.isArray(outputSchema.properties)) {
      diagnostics.push({ severity: "error", code: "output_schema_properties_invalid", path: "output_schema.properties", message: "output_schema.properties must be an object." });
    }
  }

  const tools = interfaceDoc.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    diagnostics.push({ severity: "error", code: "tools_invalid", path: "tools", message: "tools must be an object." });
  } else {
    for (const key of requiredToolKeys) {
      const value = tools[key];
      if (!isNonEmptyStringArray(value)) {
        diagnostics.push({
          severity: "error",
          code: "tools_key_invalid",
          path: `tools.${key}`,
          message: `tools.${key} must be an array of non-empty strings.`,
        });
      }
    }
  }

  const safety = interfaceDoc.safety;
  if (!safety || typeof safety !== "object" || Array.isArray(safety)) {
    diagnostics.push({ severity: "error", code: "safety_invalid", path: "safety", message: "safety must be an object." });
  } else {
    for (const key of requiredSafetyKeys) {
      if (typeof safety[key] !== "boolean") {
        diagnostics.push({
          severity: "error",
          code: "safety_key_invalid",
          path: `safety.${key}`,
          message: `safety.${key} must be a boolean.`,
        });
      }
    }
  }

  const integration = interfaceDoc.pi_coding_agent;
  if (!integration || typeof integration !== "object" || Array.isArray(integration)) {
    diagnostics.push({
      severity: "error",
      code: "pi_coding_agent_missing",
      path: "pi_coding_agent",
      message: "pi_coding_agent metadata is required.",
    });
  } else {
    const arrayKeys = ["supported_prompts", "required_context_keys", "judge_context_inputs"];
    for (const key of arrayKeys) {
      const value = integration[key];
      if (!isNonEmptyStringArray(value)) {
        diagnostics.push({
          severity: "error",
          code: "pi_coding_agent_key_invalid",
          path: `pi_coding_agent.${key}`,
          message: `pi_coding_agent.${key} must be an array of non-empty strings.`,
        });
      }
    }

    const judgeInputs = toSortedUniqueStrings(integration.judge_context_inputs || []);
    for (const required of DEFAULT_JUDGE_CONTEXT_INPUTS) {
      if (!judgeInputs.includes(required)) {
        diagnostics.push({
          severity: "error",
          code: "judge_context_input_missing",
          path: "pi_coding_agent.judge_context_inputs",
          message: `Missing required judge context input \"${required}\".`,
        });
      }
    }
  }

  return {
    ok: diagnostics.filter((entry) => entry.severity === "error").length === 0,
    diagnostics,
  };
}

function validateExistingInterfaces(existingInterfaces) {
  const warnings = [];
  for (const entry of existingInterfaces) {
    const integration = entry.interface?.pi_coding_agent;
    const judgeInputs = Array.isArray(integration?.judge_context_inputs)
      ? toSortedUniqueStrings(integration.judge_context_inputs)
      : [];
    if (judgeInputs.length === 0) {
      warnings.push({
        severity: "warning",
        code: "existing_interface_missing_judge_context_inputs",
        skill_name: entry.skill_name,
        path: entry.interface_path,
        message: "Existing interface.json is missing pi_coding_agent.judge_context_inputs metadata.",
      });
    }
  }

  return {
    checked: existingInterfaces.length,
    warnings,
  };
}

function buildInterfaceDoc({ skillName, existingInterfaces, sharedSchema }) {
  const toolsDefault = inferToolPolicy(existingInterfaces);
  const safetyDefault = inferSafetyDefaults(existingInterfaces);

  const interfaceDoc = {
    name: skillName,
    version: "0.1.0",
    description: `TODO: Describe what ${skillName} does and when to use it.`,
    output_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        prompt_used: { type: "string" },
        context_keys_used: { type: "array", items: { type: "string" } },
      },
    },
    tools: {
      allowed: toolsDefault.allowed,
      forbidden: toolsDefault.forbidden,
    },
    safety: safetyDefault,
    pi_coding_agent: {
      supported_prompts: ["primary", "revise"],
      required_context_keys: ["TODO_context_key"],
      judge_context_inputs: [...DEFAULT_JUDGE_CONTEXT_INPUTS],
    },
  };

  const validation = validateSkillInterfaceDocument({
    interfaceDoc,
    skillName,
    sharedSchema,
  });

  if (!validation.ok) {
    const message = validation.diagnostics.map((entry) => `${entry.code}@${entry.path}`).join(", ");
    throw new Error(`Generated interface.json failed validation: ${message}`);
  }

  return interfaceDoc;
}

function toTitle(value) {
  return value
    .split(/[_-]/g)
    .map((part) => trim(part))
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCurrentPrompt({ skillName, owner = "factory-owners" }) {
  const title = toTitle(skillName) || skillName;
  return [
    `# ${title} — Skill Prompt Template`,
    "",
    "## Owner",
    `- ${trim(owner) || "factory-owners"}`,
    "",
    "## Purpose",
    `TODO: Describe the primary purpose of ${skillName} and when this skill should be loaded.`,
    "",
    "## Supported Prompts",
    "- `primary`: TODO describe the default prompt invocation and expected output behavior.",
    "- `revise`: TODO describe how revision prompts should incorporate reviewer notes.",
    "",
    "## Responsibilities",
    "- [ ] Read required context keys before producing output.",
    "- [ ] Follow repository policy and trust-domain constraints for the calling node.",
    "- [ ] Return JSON that conforms exactly to `interface.json -> output_schema`.",
    "- [ ] Include any judge-context transport data expected by downstream validation gates.",
    "",
    "## Required Context Keys",
    "- TODO_context_key",
    "",
    "## Judge Context Inputs",
    ...DEFAULT_JUDGE_CONTEXT_INPUTS.map((key) => `- ${key}`),
    "",
    "## Policy / Template References",
    "- `AGENTS.md` (repo governance and quality gates)",
    "- `docs/architecture/factory-internals.md` (handler + skill contract expectations)",
    "- Relevant factory graph prompt nodes that load this skill",
    "",
    "## Output Contract",
    "Return JSON only. It must conform to `interface.json -> output_schema` and include all required fields.",
    "",
    "## Required Section Checklist",
    "- [ ] Purpose updated",
    "- [ ] Supported prompts documented",
    "- [ ] Responsibilities checked",
    "- [ ] Required context keys populated",
    "- [ ] Judge context inputs confirmed",
    "- [ ] Policy references linked",
    "",
  ].join("\n");
}

function buildReadme({ skillName, owner = "factory-owners", skillsRoot = DEFAULT_SKILLS_ROOT }) {
  const title = toTitle(skillName) || skillName;
  return [
    `# ${title} Skill Interface`,
    "",
    "This scaffold documents how the skill integrates with Hatch pipeline handlers and pi-coding-agent prompt contracts.",
    "",
    "## Owner",
    `- ${trim(owner) || "factory-owners"}`,
    "",
    "## Generated Files",
    "- `interface.json` — skill interface contract (output schema, tool policy, safety policy, pi-coding-agent metadata)",
    "- `current.md` — prompt template with responsibilities and policy references",
    "- `README.md` — integration instructions + acceptance checklist",
    "",
    "## Handler Expectations",
    "- `codergen` handler: load `current.md`, provide required context keys, and return JSON conforming to `interface.json`.",
    "- `tool` handler: may load this skill content for deterministic prompt text; keep prompts explicit and machine-readable.",
    "- `agent.worktree` handler: use this skill as policy guidance; commits/tests stay governed by worktree execution contracts.",
    "",
    "## Supported Prompts",
    "Document prompt entry points in `interface.json -> pi_coding_agent.supported_prompts` and mirror them in `current.md`.",
    "",
    "## Required Context Keys",
    "Document required context keys in `interface.json -> pi_coding_agent.required_context_keys`.",
    "",
    "## Judge Context Inputs",
    "`interface.json -> pi_coding_agent.judge_context_inputs` must list the deterministic judge-context transport keys:",
    ...DEFAULT_JUDGE_CONTEXT_INPUTS.map((key) => `- ${key}`),
    "",
    "## Validation",
    "Generator enforces schema inference from existing interfaces and validates output JSON before write.",
    "Run explicit validation after generation:",
    "```bash",
    `node packages/factory-ops/src/cli.ts skill validate-interface --skill-name ${skillName} --skills-root ${skillsRoot}`,
    "```",
    "",
    "## Integrate Into a Factory Pipeline",
    "1. Add or update a graph node prompt to load this skill file via `read` (prefer explicit file path).",
    "2. Ensure node prompt references required context keys documented in `interface.json`.",
    "3. Add/adjust contract tests for prompt routing and output expectations.",
    "4. Re-run relevant `@hatch/factory-ops` tests and pre-commit gates.",
    "",
    "## Generator Workflow",
    "Use the CLI to generate a new skill scaffold:",
    "```bash",
    `node packages/factory-ops/src/cli.ts skill scaffold-interface --skill-name ${skillName} --skills-root ${skillsRoot}`,
    "```",
    "",
    "## Required Section Checklist",
    "- [ ] Owner set",
    "- [ ] Prompt responsibilities completed in `current.md`",
    "- [ ] Supported prompts documented",
    "- [ ] Required context keys documented",
    "- [ ] Judge context inputs verified",
    "- [ ] Graph integration steps completed",
    "- [ ] Validation command executed",
    "",
  ].join("\n");
}

function normalizeSkillName(rawSkillName) {
  const skillName = trim(rawSkillName);
  if (!skillName) throw new Error("skillName is required");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(skillName)) {
    throw new Error("skillName must match /^[a-z0-9][a-z0-9_-]*$/");
  }
  return skillName;
}

export function validateSkillInterfaceAtPath({
  skillName = "",
  skillsRoot = DEFAULT_SKILLS_ROOT,
  validateExisting = true,
} = {}) {
  const normalizedSkillName = normalizeSkillName(skillName);
  const resolvedSkillsRoot = resolve(process.cwd(), skillsRoot);
  const outputDir = join(resolvedSkillsRoot, normalizedSkillName);
  const interfacePath = join(outputDir, "interface.json");

  if (!existsSync(interfacePath)) {
    throw new Error(`interface.json not found for skill: ${interfacePath}`);
  }

  const existingInterfaces = loadExistingInterfaces(resolvedSkillsRoot);
  const sharedSchema = inferSharedSchema(existingInterfaces);
  const schemaDiagnostics = validateSharedSchemaInputs(existingInterfaces, sharedSchema);
  if (schemaDiagnostics.some((entry) => entry.severity === "error")) {
    const summary = schemaDiagnostics.map((entry) => `${entry.code}@${entry.path}`).join(", ");
    throw new Error(`Unable to infer shared skill schema: ${summary}`);
  }

  const existingValidation = validateExisting ? validateExistingInterfaces(existingInterfaces) : { checked: 0, warnings: [] };
  const interfaceDoc = parseJsonFile(interfacePath);
  const validation = validateSkillInterfaceDocument({
    interfaceDoc,
    skillName: normalizedSkillName,
    sharedSchema,
  });

  return {
    ok: validation.ok,
    skill_name: normalizedSkillName,
    interface_path: interfacePath,
    schema: {
      inspected_interface_count: existingInterfaces.length,
      required_top_level_keys: sharedSchema.required_top_level_keys,
      required_tool_keys: sharedSchema.required_tool_keys,
      required_safety_keys: sharedSchema.required_safety_keys,
    },
    diagnostics: validation.diagnostics,
    warnings: existingValidation.warnings,
  };
}

export function scaffoldSkillInterface({
  skillName = "",
  skillsRoot = DEFAULT_SKILLS_ROOT,
  owner = "factory-owners",
  overwrite = false,
  dryRun = false,
  validateExisting = true,
} = {}) {
  const normalizedSkillName = normalizeSkillName(skillName);
  const resolvedSkillsRoot = resolve(process.cwd(), skillsRoot);

  if (!existsSync(resolvedSkillsRoot)) {
    throw new Error(`skillsRoot does not exist: ${resolvedSkillsRoot}`);
  }

  const existingInterfaces = loadExistingInterfaces(resolvedSkillsRoot);
  const sharedSchema = inferSharedSchema(existingInterfaces);
  const schemaDiagnostics = validateSharedSchemaInputs(existingInterfaces, sharedSchema);
  if (schemaDiagnostics.some((entry) => entry.severity === "error")) {
    const summary = schemaDiagnostics.map((entry) => `${entry.code}@${entry.path}`).join(", ");
    throw new Error(`Unable to infer shared skill schema: ${summary}`);
  }

  const existingValidation = validateExisting ? validateExistingInterfaces(existingInterfaces) : { checked: 0, warnings: [] };

  const inferredToolPolicy = inferToolPolicy(existingInterfaces);

  const interfaceDoc = buildInterfaceDoc({
    skillName: normalizedSkillName,
    existingInterfaces,
    sharedSchema,
  });

  const outputDir = join(resolvedSkillsRoot, normalizedSkillName);
  const interfacePath = join(outputDir, "interface.json");
  const promptPath = join(outputDir, "current.md");
  const readmePath = join(outputDir, "README.md");

  if (existsSync(outputDir) && !parseBoolFlag(overwrite, false)) {
    throw new Error(`Skill directory already exists: ${outputDir}. Pass overwrite=true to replace scaffold files.`);
  }

  const files = {
    "interface.json": `${JSON.stringify(interfaceDoc, null, 2)}\n`,
    "current.md": buildCurrentPrompt({ skillName: normalizedSkillName, owner }),
    "README.md": buildReadme({ skillName: normalizedSkillName, owner, skillsRoot }),
  };

  const shouldWrite = !parseBoolFlag(dryRun, false);
  if (shouldWrite) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(interfacePath, files["interface.json"], "utf8");
    writeFileSync(promptPath, files["current.md"], "utf8");
    writeFileSync(readmePath, files["README.md"], "utf8");

    const persisted = parseJsonFile(interfacePath);
    const persistedValidation = validateSkillInterfaceDocument({
      interfaceDoc: persisted,
      skillName: normalizedSkillName,
      sharedSchema,
    });
    if (!persistedValidation.ok) {
      const summary = persistedValidation.diagnostics.map((entry) => `${entry.code}@${entry.path}`).join(", ");
      throw new Error(`Persisted interface.json failed validation: ${summary}`);
    }
  }

  return {
    ok: true,
    dry_run: !shouldWrite,
    skills_root: resolvedSkillsRoot,
    skill_name: normalizedSkillName,
    output_dir: outputDir,
    created_files: Object.keys(files),
    schema: {
      inspected_interface_count: existingInterfaces.length,
      required_top_level_keys: sharedSchema.required_top_level_keys,
      required_tool_keys: sharedSchema.required_tool_keys,
      required_safety_keys: sharedSchema.required_safety_keys,
      inferred_tool_policy: inferredToolPolicy,
    },
    owner: trim(owner) || "factory-owners",
    validation: {
      generated_interface_ok: true,
      existing_interfaces_checked: existingValidation.checked,
      warnings: existingValidation.warnings,
    },
  };
}
