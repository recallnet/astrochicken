import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(".");
const factoryOpsCommandDir = join(repoRoot, "packages", "factory-ops", "src", "cli", "commands");
const hatchRunsPath = join(repoRoot, "apps", "hatch", "src", "runs.ts");
const recoverySweepPath = join(repoRoot, "apps", "hatch", "src", "runs-recovery-sweep.ts");
const cliInternalParams = new Map([
  ["createBrainstormGoalIssue", new Set(["destinations"])],
  ["buildFactorySessionBrowserSnapshot", new Set(["repoRoot"])],
  ["factoryFleetTriageQueues", new Set(["reader"])],
  ["hostVersion", new Set(["releaseCommand"])],
  ["describeHostAssignment", new Set(["readOnly"])],
  ["provisionFactoryRepo", new Set(["authCheck"])],
  ["bootstrapFactoryTargetRepo", new Set(["templatePath", "issueTemplatesDir", "controlPlaneRepo", "authCheck"])],
  ["runReleaseRolloutController", new Set(["releaseAssetGithubClient"])],
  ["fleetReport", new Set(["data"])],
  ["inspectGoalRunAdmission", new Set(["goalRoutingState"])],
  ["produceHostRuntimeReleaseManifest", new Set(["artifactId", "artifactPath"])],
  ["publishHostRuntimeReleaseManifest", new Set(["releaseAssetGithubClient"])],
  ["normalizeAndEnsureIssueLabels", new Set(["createLabel"])],
  ["normalizeIssueLabels", new Set(["issues"])],
  ["runLabelProvision", new Set(["authCheck"])],
  ["buildStateSnapshot", new Set(["factoryConfig"])],
  ["validateManagedDomainContract", new Set(["dotContent"])],
  ["closeStaleMergeFollowups", new Set(["nowEpoch"])],
  ["filterReadyIssues", new Set(["queryBlockedBy"])],
  ["factoryFleetStatus", new Set(["json"])],
  ["classifyGoalExecutionPath", new Set(["planningArtifactPath", "classificationSignals"])],
]);
// Adapter, mutation-authority, audit, and correlation inputs are supplied by
// the owning runtime/environment. They are not caller-editable transport flags.
for (const [owner, params] of [
  [
    "createGitHubIssueFromSpec",
    [
      "auditHomeDir",
      "auditHostBaseDir",
      "auditLogPath",
      "factoryId",
      "githubProjectionTarget",
      "mutationContext",
      "mutationContextJson",
      "repoRoot",
      "runId"
    ]
  ],
  [
    "updateGitHubIssueFromSpec",
    [
      "auditHomeDir",
      "auditHostBaseDir",
      "auditLogPath",
      "factoryId",
      "githubProjectionTarget",
      "mutationContext",
      "mutationContextJson",
      "runId"
    ]
  ],
  [
    "closeMergedIssues",
    [
      "factoryId",
      "githubProjectionTarget",
      "repoRoot"
    ]
  ],
  [
    "buildWaveMergeResults",
    [
      "factoryId",
      "runId"
    ]
  ],
  [
    "reconcileGoalFinalState",
    [
      "githubProjectionTarget"
    ]
  ],
  [
    "fetchGoalIssue",
    [
      "factoryId",
      "githubIssueSource",
      "runId"
    ]
  ],
  [
    "listReadyGoals",
    [
      "factoryId"
    ]
  ],
  [
    "evaluateGoalDecomposeBackpressure",
    [
      "factoryId"
    ]
  ],
  [
    "exhaustDecomposeRetries",
    [
      "factoryId",
      "githubProjectionTarget",
      "runId"
    ]
  ],
  [
    "markGoalDispatched",
    [
      "factoryId",
      "githubProjectionTarget",
      "runId"
    ]
  ],
  [
    "postDecomposeAttemptMarker",
    [
      "factoryId",
      "githubProjectionTarget",
      "runId"
    ]
  ],
  [
    "postGoalRetryComment",
    [
      "factoryId",
      "githubProjectionTarget",
      "runId"
    ]
  ],
  [
    "addSubIssue",
    [
      "auditHomeDir",
      "auditHostBaseDir",
      "auditLogPath",
      "factoryId",
      "githubProjectionTarget",
      "mutationContext",
      "mutationContextJson",
      "repoRoot",
      "runId"
    ]
  ],
  [
    "selectManagedIntakeIssue",
    [
      "factoryId"
    ]
  ],
  [
    "initWaveIssueWorktree",
    [
      "factoryId",
      "runId"
    ]
  ],
  [
    "pickReadyWaveFromRepo",
    [
      "getMilestoneOpenIssues"
    ]
  ],
  [
    "blockReadyWaveIssue",
    [
      "execGh"
    ]
  ]
]) {
  const declared = cliInternalParams.get(owner) || new Set();
  for (const param of params) declared.add(param);
  cliInternalParams.set(owner, declared);
}

const aliasSatisfiedParams = new Map([
  ["installHostRuntime", new Set(["trustPublicKeyPem"])],
  ["getHostRuntimeStatus", new Set(["trustPublicKeyPem"])],
  ["doctorHostRuntime", new Set(["trustPublicKeyPem"])],
]);

function read(filePath) {
  return readFileSync(filePath, "utf8");
}

function extractBalanced(source, startIndex, openChar = "{", closeChar = "}") {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (!inDouble && !inTemplate && char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && char === "\"") {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === "`") {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex + 1, index);
      }
    }
  }
  throw new Error(`Unbalanced ${openChar}${closeChar} block`);
}

function splitTopLevel(text, delimiter = ",") {
  const parts = [];
  let current = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || "";
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "/") {
      current += char + next;
      inLineComment = true;
      index += 1;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && char === "/" && next === "*") {
      current += char + next;
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (!inDouble && !inTemplate && char === "'") {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (!inSingle && !inTemplate && char === "\"") {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && char === "`") {
      inTemplate = !inTemplate;
      current += char;
      continue;
    }
    if (inSingle || inDouble || inTemplate) {
      current += char;
      continue;
    }
    if (char === "(") depthParen += 1;
    if (char === ")") depthParen -= 1;
    if (char === "{") depthBrace += 1;
    if (char === "}") depthBrace -= 1;
    if (char === "[") depthBracket += 1;
    if (char === "]") depthBracket -= 1;

    if (char === delimiter && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractClassBlocks(source) {
  const classes = [];
  const re = /export\s+class\s+(\w+Command)\s+extends\s+Command\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const braceIndex = source.indexOf("{", match.index);
    const body = extractBalanced(source, braceIndex);
    classes.push({ className: match[1], body });
  }
  return classes;
}

function extractOptionProperties(classBody) {
  const properties = new Set();
  const re = /(?:^|;)\s*(\w+)\s*=\s*Option\.(?:String|Boolean|Array)\(/gm;
  let match;
  while ((match = re.exec(classBody)) !== null) {
    properties.add(match[1]);
  }
  return properties;
}

function extractExecuteBody(classBody) {
  const index = classBody.indexOf("async execute()");
  if (index < 0) return "";
  const braceIndex = classBody.indexOf("{", index);
  if (braceIndex < 0) return "";
  return extractBalanced(classBody, braceIndex);
}

function extractImportedBindings(executeBody) {
  const bindings = [];
  const re = /const\s+\{\s*([^}]+)\s*\}\s*=\s*await\s+import\(\s*"([^"]+)"\s*\)/g;
  let match;
  while ((match = re.exec(executeBody)) !== null) {
    const names = match[1].split(",").map((value) => value.trim()).filter(Boolean);
    for (const name of names) bindings.push({ name, importPath: match[2] });
  }
  return bindings;
}

function extractObjectCall(executeBody, functionName) {
  const patterns = [
    `${functionName}({`,
    `await ${functionName}({`,
  ];
  for (const pattern of patterns) {
    const start = executeBody.indexOf(pattern);
    if (start < 0) continue;
    const braceIndex = executeBody.indexOf("{", start);
    if (braceIndex < 0) continue;
    return extractBalanced(executeBody, braceIndex);
  }
  return "";
}

function extractObjectKeys(objectLiteral) {
  return splitTopLevel(objectLiteral).map((entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized || normalized.startsWith("...")) return "";
    const aliasMatch = normalized.match(/^([A-Za-z0-9_]+)\s*:/);
    if (aliasMatch) return aliasMatch[1];
    const shorthandMatch = normalized.match(/^([A-Za-z0-9_]+)$/);
    if (shorthandMatch) return shorthandMatch[1];
    return "";
  }).filter(Boolean);
}

function extractObjectEntries(objectLiteral) {
  return splitTopLevel(objectLiteral).map((entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized || normalized.startsWith("...")) return null;
    const aliasMatch = normalized.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/s);
    if (aliasMatch) return { key: aliasMatch[1], value: aliasMatch[2].trim(), raw: normalized };
    const shorthandMatch = normalized.match(/^([A-Za-z0-9_]+)$/);
    if (shorthandMatch) return { key: shorthandMatch[1], value: shorthandMatch[1], raw: normalized };
    return null;
  }).filter(Boolean);
}

function extractParamEntries(source, functionName) {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${functionName}\\s*\\(\\s*\\{`, "g");
  const match = re.exec(source);
  if (!match) return [];
  const braceIndex = source.indexOf("{", match.index);
  const paramBlock = extractBalanced(source, braceIndex);
  return splitTopLevel(paramBlock).map((entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized || normalized.startsWith("...")) return null;
    const defaultIndex = normalized.indexOf("=");
    const left = defaultIndex >= 0 ? normalized.slice(0, defaultIndex).trim() : normalized;
    const right = defaultIndex >= 0 ? normalized.slice(defaultIndex + 1).trim() : "";
    const leftMatch = left.match(/^([A-Za-z0-9_]+)$/);
    if (!leftMatch) return null;
    return {
      key: leftMatch[1],
      defaultValue: right,
    };
  }).filter(Boolean);
}

function isPrimitiveDefault(defaultValue) {
  if (!defaultValue) return true;
  return /^(?:undefined|null|true|false|-?\d+(?:\.\d+)?|""|''|`[^`]*`)$/u.test(defaultValue);
}

function isInjectableParam(param) {
  const key = String(param?.key || "");
  const defaultValue = String(param?.defaultValue || "");
  if (!key) return true;
  if (/(?:Fn|Impl|Runner|Reader|Writer|Loader|Exec|JsonFn|Spawn|Clock|Now|Adapter)$/u.test(key)) return true;
  if (/^(?:env|io|adapter|contextProvider|cwdResolver|resolveContext|appendLogLineFn|emitManagedLifecycleEventFn)$/u.test(key)) return true;
  if (!isPrimitiveDefault(defaultValue) && defaultValue) return true;
  return false;
}

function collectFactoryOpsWrapperContracts() {
  const files = readdirSync(factoryOpsCommandDir).filter((file) => file.endsWith(".mjs") || file.endsWith(".ts")).sort();
  const contracts = [];

  for (const file of files) {
    const filePath = join(factoryOpsCommandDir, file);
    const source = read(filePath);
    const classes = extractClassBlocks(source);
    for (const classInfo of classes) {
      const executeBody = extractExecuteBody(classInfo.body);
      if (!executeBody) continue;
      const optionProperties = extractOptionProperties(classInfo.body);
      const importedBindings = extractImportedBindings(executeBody);
      for (const binding of importedBindings) {
        const objectCall = extractObjectCall(executeBody, binding.name);
        if (!objectCall) continue;
        const targetPath = resolve(dirname(filePath), binding.importPath);
        const targetSource = read(targetPath);
        const paramEntries = extractParamEntries(targetSource, binding.name);
        if (paramEntries.length === 0) continue;
        contracts.push({
          file,
          className: classInfo.className,
          functionName: binding.name,
          importPath: binding.importPath,
          optionProperties,
          passedKeys: new Set(extractObjectKeys(objectCall)),
          passedEntries: extractObjectEntries(objectCall),
          paramEntries,
        });
      }
    }
  }

  return contracts;
}

test("factory-ops clipanion wrappers cover downstream CLI-facing params", async (t) => {
  const contracts = collectFactoryOpsWrapperContracts();
  assert.ok(contracts.length > 0, "expected to discover factory-ops command wrapper contracts");

  for (const contract of contracts) {
    if (!contract.importPath.startsWith("../../commands/")) continue;
    const ignoredParams = cliInternalParams.get(contract.functionName) || new Set();
    const aliasSatisfied = aliasSatisfiedParams.get(contract.functionName) || new Set();
    const missing = contract.paramEntries
      .filter((entry) => !isInjectableParam(entry))
      .map((entry) => entry.key)
      .filter((key) => !ignoredParams.has(key))
      .filter((key) => !contract.passedKeys.has(key))
      .filter((key) => !aliasSatisfied.has(key));

    await t.test(`${contract.file}:${contract.className} covers ${contract.functionName} params`, () => {
      assert.deepEqual(
        missing,
        [],
        `${contract.className} in ${contract.file} does not forward CLI-facing params for ${contract.functionName}: ${missing.join(", ")}`,
      );
    });

    const invalidThisMappings = contract.passedEntries
      .map((entry) => String(entry?.value || "").match(/^this\.([A-Za-z0-9_]+)/)?.[1] || "")
      .filter(Boolean)
      .filter((property) => property !== "context")
      .filter((property) => !contract.optionProperties.has(property));

    await t.test(`${contract.file}:${contract.className} only forwards declared option properties`, () => {
      assert.deepEqual(
        invalidThisMappings,
        [],
        `${contract.className} in ${contract.file} forwards undeclared this.* properties: ${invalidThisMappings.join(", ")}`,
      );
    });
  }
});

function extractFunctionBody(source, functionName) {
  const re = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "g");
  const match = re.exec(source);
  if (!match) return "";
  const braceIndex = source.indexOf("{", match.index);
  return extractBalanced(source, braceIndex);
}

function extractParsedArgFlags(functionBody) {
  const flags = new Set();
  const includesRe = /args\.includes\("(--[^"]+)"\)/g;
  let match;
  while ((match = includesRe.exec(functionBody)) !== null) flags.add(match[1]);

  const startsWithRe = /startsWith\("(--[^"=]+)=?"\)/g;
  while ((match = startsWithRe.exec(functionBody)) !== null) flags.add(match[1]);
  return flags;
}

function extractScanCallKeys(functionBody, functionName) {
  const objectCall = extractObjectCall(functionBody, functionName);
  return new Set(extractObjectKeys(objectCall));
}

test("hatch runs recovery-sweep parser covers the recovery sweep option surface", async (t) => {
  const runsSource = read(hatchRunsPath);
  const recoverySweepSource = read(recoverySweepPath);
  const cmdBody = extractFunctionBody(runsSource, "cmdRunsRecoverySweep");
  const parsedFlags = extractParsedArgFlags(cmdBody);
  const passedKeys = extractScanCallKeys(cmdBody, "scanRuntimeRecoverySweep");
  const paramEntries = extractParamEntries(recoverySweepSource, "scanRuntimeRecoverySweep");
  const expectedKeys = paramEntries
    .filter((entry) => !isInjectableParam(entry))
    .map((entry) => entry.key);

  await t.test("scanRuntimeRecoverySweep CLI-facing params are forwarded by cmdRunsRecoverySweep", () => {
    const missingKeys = expectedKeys.filter((key) => !passedKeys.has(key));
    assert.deepEqual(
      missingKeys,
      [],
      `cmdRunsRecoverySweep does not forward recovery-sweep params: ${missingKeys.join(", ")}`,
    );
  });

  await t.test("cmdRunsRecoverySweep parses skip-worktree-scan when recovery sweep accepts it", () => {
    assert.ok(
      !expectedKeys.includes("skipWorktreeScan") || parsedFlags.has("--skip-worktree-scan"),
      "cmdRunsRecoverySweep must parse --skip-worktree-scan when scanRuntimeRecoverySweep accepts skipWorktreeScan",
    );
  });
});
