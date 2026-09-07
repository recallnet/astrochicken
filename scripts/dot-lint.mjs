#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { benchmarkIdentityDiagnosticsForNode } from "./lib/dot-lint-benchmark-identity.ts";
import {
  CONTEXT_FLOW_SEED_KEYS,
  collectProducedKeys,
  extractConditionKeys,
  extractContextKeysList,
  extractTemplatePlaceholders,
  hasConsumedStructuredOutputs,
  isEmitterReceiptOutput,
  isReceiptOnlyOutputKey,
  isResolveDefaultSelfBootstrapReference,
  isSeedNormalizationOutput,
  isTerminalContractOutput,
  shouldInspectNodeAttrForPlaceholders,
  splitCommaSeparated,
} from "./lib/dot-lint-context-flow.ts";
import { emitInlineScriptBaselineDiffTelemetry, enforceInlineScriptDebt as enforceInlineScriptDebtPolicy, runInlineScriptBaselineMode } from "./lib/dot-lint-inline-script-debt.ts";
import {
  PROMPT_SHELL_METASYNTAX_RULE_ID,
  TOOL_DECLARATIVE_PROMPT_POLICY_RULE_ID,
  classifyToolPromptMutability,
  findToolDeclarativePromptViolation,
  findToolOutputMetadataAllowlistMatch,
  findToolShellMetasyntaxViolation,
  normalizeToolPromptForPolicy,
  promptSnippetForTelemetry,
  resolveToolOutputMetadata,
  sortDeclarativeToolTelemetry,
  sortShellMetasyntaxTelemetry,
} from "./lib/dot-lint-tool-policy.ts";
import { parseDotFileWithAst } from "./lib/hatch-dot-parser-wrapper.ts";
import { DEFAULT_INLINE_SCRIPT_BASELINE_FILE, computeInlineScriptMarkerIdentity, dedupeInlineScriptMarkers, toSerializableInlineScriptMarker } from "./lib/inline-script-baseline.ts";
const DEFAULT_COMPAT_FILE = "scripts/dot-lint-exceptions.json";
const TRUST_DOMAIN_KEY = "trust_domain";
const TRUST_ROLE_KEY = "trust_role";
const LEGACY_TRUST_ALIASES = ["trust_participant", "trust_identity"];
const INLINE_SCRIPT_RULE_ID = "prompt.inline_script";
const INLINE_SCRIPT_IGNORE_DEBT_RULE_ID = "prompt.inline_script_ignore_debt";
const INLINE_SCRIPT_MARKER = "# hatch:no-inline-script-ok";
const INLINE_SCRIPT_MARKER_REASON = "marker_present";
const INLINE_SCRIPT_MARKER_LINE_REGEX = /^\s*#\s*hatch:no-inline-script-ok\s*$/;

const TARGET_INLINE_SCRIPT_HANDLERS = new Set([
  "tool",
  "assert",
  "agent.worktree",
  "agent.kw",
  "stack.manager_loop",
]);

const SHAPE_TO_HANDLER_TYPE = Object.freeze({
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  "": "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
  octagon: "assert",
});

const INLINE_SCRIPT_PATTERNS = Object.freeze([
  Object.freeze({
    matchType: "heredoc",
    regex: /\bpython\s+-\s+<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "heredoc",
    regex: /\bpython3\s+-\s+<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "heredoc",
    regex: /\bbash\s+-\s+<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "heredoc",
    regex: /\bsh\s+-\s+<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "flag",
    regex: /\bpython\s+-c\b/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "flag",
    regex: /\bpython3\s+-c\b/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "flag",
    regex: /\bsh\s+-c\b/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "flag",
    regex: /\bbash\s+-c\b/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw"]),
  }),
  Object.freeze({
    matchType: "flag",
    regex: /\bnode\s+-e\b/g,
    handlers: Object.freeze(["tool", "assert", "agent.worktree", "agent.kw", "stack.manager_loop"]),
  }),
]);

const NODE_LABEL_REQUIRED_RULE_ID = "node.label.required";
const TOOL_OUTPUT_METADATA_REQUIRED_RULE_ID = "tool.output_metadata.required";
const TOOL_MUTABLE_GOVERNANCE_REQUIRED_RULE_ID = "tool.governance.missing_for_mutable";
const TOOL_MUTABLE_GOVERNANCE_IRREVERSIBLE_RULE_ID = "tool.governance.mutable_requires_irreversible";

const SHELL_UNSAFE_ARG_RULE_ID = "prompt.shell_unsafe_arg";
const SHELL_UNSAFE_CONTENT_VARS = new Set(["review_notes","last_review_notes","judge_notes","issue_body","issue_title","next_issue_title","issue_spec","issue_labels","review_reason_codes","state_snapshot","merged_results","supervisor_skill_content","review_skill_content","review_repo_content"]);
const SHELL_UNSAFE_ARG_REGEX = /--[\w-]+\s+'[^']*\$\{(\w+)\}[^']*'/g;

const CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID = "context_flow.undefined_reference";
const CONTEXT_FLOW_UNUSED_OUTPUT_KEY_RULE_ID = "context_flow.unused_output_key";

const CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST = new Set([
  "goal",
  "goal_statement",
  "issue_number",
]);

const CONTEXT_FLOW_PLACEHOLDER_ATTR_KEYS = new Set([
  "prompt",
  "workdir",
  "pipeline",
  "repo",
  "branch",
  "base",
  "session_id",
  "fail_message",
]);

const CONTEXT_FLOW_DIRECT_KEY_ATTR_KEYS = new Set([
  "source_key",
]);

export function usage() {
  return "usage: node scripts/dot-lint.mjs [--compat-file <path>] [--inline-script-baseline-file <path>] <file.dot> [more.dot ...] | node scripts/dot-lint.mjs [--compat-file <path>] [--inline-script-baseline-file <path>] [--inline-script-baseline-diff|--inline-script-baseline-refresh]";
}

export function normalizePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function parseArgs(argv) {
  const options = {
    compatFile: DEFAULT_COMPAT_FILE,
    inlineScriptBaselineFile: DEFAULT_INLINE_SCRIPT_BASELINE_FILE,
    inlineScriptBaselineDiff: false,
    inlineScriptBaselineRefresh: false,
    files: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (arg === "--compat-file") {
      const value = argv[index + 1]; if (!value) throw new Error("--compat-file requires a value");
      options.compatFile = value; index += 1; continue;
    }
    if (arg === "--inline-script-baseline-file") {
      const value = argv[index + 1]; if (!value) throw new Error("--inline-script-baseline-file requires a value");
      options.inlineScriptBaselineFile = value; index += 1; continue;
    }
    if (arg === "--inline-script-baseline-diff") { options.inlineScriptBaselineDiff = true; continue; }
    if (arg === "--inline-script-baseline-refresh") { options.inlineScriptBaselineRefresh = true; continue; }
    if (arg.startsWith("-")) { throw new Error(`unknown option: ${arg}`); }
    options.files.push(arg);
  }
  if (options.inlineScriptBaselineDiff && options.inlineScriptBaselineRefresh) {
    throw new Error("--inline-script-baseline-diff and --inline-script-baseline-refresh are mutually exclusive");
  }
  return options;
}

function loadCompatConfig(compatFile) {
  const absolutePath = resolve(process.cwd(), compatFile);
  if (!existsSync(absolutePath)) {
    throw new Error(`compat file not found: ${compatFile}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`invalid compat file JSON (${compatFile}): ${String(error?.message || error)}`);
  }

  const pairCompat = parsed?.trust_domain_role_compat;
  if (!Array.isArray(pairCompat)) {
    throw new Error(`invalid compat file (${compatFile}): trust_domain_role_compat must be an array`);
  }

  const aliasCompat = parsed?.trust_alias_compat;
  if (!Array.isArray(aliasCompat)) {
    throw new Error(`invalid compat file (${compatFile}): trust_alias_compat must be an array`);
  }

  const domainRoleCompatSet = new Set();
  for (const entry of pairCompat) {
    const file = normalizePath(entry?.file);
    const node = String(entry?.node || "").trim();
    if (!file || !node) {
      throw new Error(`invalid trust_domain_role_compat entry in ${compatFile}: expected {file,node}`);
    }
    domainRoleCompatSet.add(`${file}#${node}`);
  }

  const aliasCompatSet = new Set();
  for (const entry of aliasCompat) {
    const file = normalizePath(entry?.file);
    const node = String(entry?.node || "").trim();
    const alias = String(entry?.alias || "").trim().toLowerCase() || "*";
    if (!file || !node) {
      throw new Error(`invalid trust_alias_compat entry in ${compatFile}: expected {file,node,alias}`);
    }
    aliasCompatSet.add(`${file}#${node}#${alias}`);
  }

  return {
    domainRoleCompatSet,
    aliasCompatSet,
  };
}

function parseSyntaxLocation(errorMessage) {
  const raw = String(errorMessage || "").trim();
  const match = raw.match(/line\s+(\d+)\s+col\s+(\d+)\s*:\s*(.+)$/i);
  if (!match) {
    return {
      line: 1,
      column: 1,
      message: raw || "parse error",
    };
  }
  return {
    line: Number.parseInt(match[1], 10) || 1,
    column: Number.parseInt(match[2], 10) || 1,
    message: match[3],
  };
}

function attrsFromNode(node, resolvedAttrs = {}) {
  const attrs = { ...(resolvedAttrs || {}) };
  const attrEntries = Array.isArray(node?.attrList?.entries) ? node.attrList.entries : [];
  for (const entry of attrEntries) {
    const key = String(entry?.key || "").trim();
    if (!key) continue;
    attrs[key] = entry?.value;
  }
  return attrs;
}

function findAttrEntry(node, key) {
  const entries = Array.isArray(node?.attrList?.entries) ? node.attrList.entries : [];
  return entries.find((entry) => String(entry?.key || "").trim() === key) || null;
}

function resolveNodeHandlerType(attrs) {
  const explicitType = String(attrs?.type || "").trim();
  if (explicitType) return explicitType;

  const shape = String(attrs?.shape || "");
  return SHAPE_TO_HANDLER_TYPE[shape] ?? "codergen";
}

function nodeExplicitLabel(attrs) {
  return String(attrs?.label || "").trim();
}

function nodeLabelFromAttrs(attrs, nodeId) {
  const label = nodeExplicitLabel(attrs);
  return label || nodeId;
}

function hasInlineScriptMarker(text) {
  if (!text) return false;
  const lines = String(text).split(/\r?\n/);
  return lines.some((line) => INLINE_SCRIPT_MARKER_LINE_REGEX.test(line));
}

function nodeHasInlineScriptMarker(node, promptText) {
  const inPrompt = hasInlineScriptMarker(promptText);
  if (inPrompt) return true;

  const attrRaw = String(node?.attrList?.raw || "");
  return hasInlineScriptMarker(attrRaw);
}

function collectInlineScriptMatches(promptText, handlerType) {
  const text = String(promptText || "");
  if (!text || !TARGET_INLINE_SCRIPT_HANDLERS.has(handlerType)) {
    return [];
  }

  const matches = [];

  for (const pattern of INLINE_SCRIPT_PATTERNS) {
    if (!pattern.handlers.includes(handlerType)) continue;

    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    while (true) {
      const match = regex.exec(text);
      if (!match) break;

      matches.push({
        matchType: pattern.matchType,
        matchedPattern: String(match[0] || ""),
        index: match.index,
      });

      if (regex.lastIndex <= match.index) {
        regex.lastIndex = match.index + 1;
      }
    }
  }

  matches.sort((left, right) => {
    const indexCmp = left.index - right.index;
    if (indexCmp !== 0) return indexCmp;

    const typeCmp = left.matchType.localeCompare(right.matchType, "en");
    if (typeCmp !== 0) return typeCmp;

    return left.matchedPattern.localeCompare(right.matchedPattern, "en");
  });

  return matches;
}

function unionSets(...sets) {
  const merged = new Set();
  for (const entrySet of sets) {
    if (!entrySet) continue;
    for (const value of entrySet) {
      merged.add(value);
    }
  }
  return merged;
}

function sortedNodeIds(graphNodes) {
  return Object.keys(graphNodes || {}).sort((left, right) => left.localeCompare(right, "en"));
}

function sortGraphEdges(edges) {
  return [...(edges || [])].sort((left, right) => {
    const fromCmp = String(left?.from || "").localeCompare(String(right?.from || ""), "en");
    if (fromCmp !== 0) return fromCmp;

    const toCmp = String(left?.to || "").localeCompare(String(right?.to || ""), "en");
    if (toCmp !== 0) return toCmp;

    const leftCondition = String(left?.attrs?.condition || "");
    const rightCondition = String(right?.attrs?.condition || "");
    const conditionCmp = leftCondition.localeCompare(rightCondition, "en");
    if (conditionCmp !== 0) return conditionCmp;

    const leftInput = String(left?.attrs?.input_key || "");
    const rightInput = String(right?.attrs?.input_key || "");
    return leftInput.localeCompare(rightInput, "en");
  });
}

function resolveAttrLocation(nodeAst, attrName) {
  const attrEntry = nodeAst ? findAttrEntry(nodeAst, attrName) : null;
  return {
    line: Number(attrEntry?.line || nodeAst?.idToken?.line || 1),
    column: Number(attrEntry?.column || nodeAst?.idToken?.column || 1),
  };
}

function computeReachableNodeIds(startNodeId, outgoingByNode) {
  const visited = new Set();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;

    visited.add(current);
    const outgoing = outgoingByNode.get(current) || [];
    const sortedOutgoing = [...outgoing].sort((left, right) => String(left?.to || "").localeCompare(String(right?.to || ""), "en"));
    for (const edge of sortedOutgoing) {
      if (edge?.to && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  return visited;
}

function buildContextFlowWarnings({ file, parsed, nodesAst }) {
  const graphNodes = parsed?.graph?.nodes || {};
  const graphEdges = sortGraphEdges(parsed?.graph?.edges || []);
  const nodeIds = sortedNodeIds(graphNodes);

  if (nodeIds.length === 0) {
    return [];
  }

  const nodeAstById = new Map();
  for (const node of nodesAst || []) {
    const nodeId = String(node?.id || "");
    if (!nodeId || nodeAstById.has(nodeId)) continue;
    nodeAstById.set(nodeId, node);
  }

  const nodeMetaById = new Map();
  for (const nodeId of nodeIds) {
    const attrs = graphNodes[nodeId]?.attrs || {};
    const nodeAst = nodeAstById.get(nodeId) || null;
    nodeMetaById.set(nodeId, {
      nodeId,
      nodeAst,
      attrs,
      nodeLabel: nodeLabelFromAttrs(attrs, nodeId),
      handlerType: resolveNodeHandlerType(attrs),
      producedKeys: collectProducedKeys(attrs),
      outputKey: String(attrs?.output_key || "").trim(),
    });
  }

  const outgoingByNode = new Map();
  for (const nodeId of nodeIds) {
    outgoingByNode.set(nodeId, []);
  }
  for (const edge of graphEdges) {
    const from = String(edge?.from || "");
    if (!outgoingByNode.has(from)) {
      outgoingByNode.set(from, []);
    }
    outgoingByNode.get(from).push(edge);
  }

  const knownBeforeByNode = new Map();
  for (const nodeId of nodeIds) {
    knownBeforeByNode.set(nodeId, new Set(CONTEXT_FLOW_SEED_KEYS));
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const nodeId of nodeIds) {
      const nodeMeta = nodeMetaById.get(nodeId);
      const knownBefore = knownBeforeByNode.get(nodeId) || new Set(CONTEXT_FLOW_SEED_KEYS);
      const knownAfter = unionSets(knownBefore, nodeMeta?.producedKeys || new Set());
      const outgoing = outgoingByNode.get(nodeId) || [];

      for (const edge of outgoing) {
        const target = String(edge?.to || "");
        if (!knownBeforeByNode.has(target)) continue;

        const targetKnown = knownBeforeByNode.get(target);
        for (const key of knownAfter) {
          if (targetKnown.has(key)) continue;
          targetKnown.add(key);
          changed = true;
        }
      }
    }
  }

  const warnings = [];
  const warningDedup = new Set();
  const consumedReferences = [];

  function pushWarning({ ruleId, message, line, column, nodeId, dedupKey }) {
    if (warningDedup.has(dedupKey)) return;
    warningDedup.add(dedupKey);
    warnings.push(toDiagnostic({
      file,
      severity: "warning",
      ruleId,
      message,
      line,
      column,
      node: nodeId,
    }));
  }

  for (const nodeId of nodeIds) {
    const nodeMeta = nodeMetaById.get(nodeId);
    const nodeAst = nodeMeta?.nodeAst || null;
    const attrs = nodeMeta?.attrs || {};
    const nodeLabel = nodeMeta?.nodeLabel || nodeId;
    const knownBefore = knownBeforeByNode.get(nodeId) || new Set(CONTEXT_FLOW_SEED_KEYS);

    const attrNames = Object.keys(attrs).sort((left, right) => left.localeCompare(right, "en"));
    for (const attrName of attrNames) {
      const normalizedAttrName = String(attrName).trim().toLowerCase();

      if (CONTEXT_FLOW_DIRECT_KEY_ATTR_KEYS.has(normalizedAttrName)) {
        const key = String(attrs[attrName] || "").trim();
        if (!key) continue;

        const location = resolveAttrLocation(nodeAst, attrName);
        consumedReferences.push({
          key,
          kind: "node_attr",
          nodeId,
          edgeFrom: "",
          source: `node_attr.${attrName}`,
        });

        if (isResolveDefaultSelfBootstrapReference({ nodeMeta, attrName, key })) {
          continue;
        }

        if (knownBefore.has(key) || CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST.has(key)) {
          continue;
        }

        pushWarning({
          ruleId: CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID,
          message: `node "${nodeId}" label="${nodeLabel}" references undefined context key "${key}" via node_attr.${attrName}`,
          line: location.line,
          column: location.column,
          nodeId,
          dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID)}|${nodeId}|node_attr.${attrName}|${key}`,
        });
        continue;
      }

      if (normalizedAttrName === "context_keys") {
        const location = resolveAttrLocation(nodeAst, attrName);
        for (const key of extractContextKeysList(attrs[attrName])) {
          consumedReferences.push({
            key,
            kind: "node_attr",
            nodeId,
            edgeFrom: "",
            source: `node_attr.${attrName}`,
          });

          if (knownBefore.has(key) || CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST.has(key)) {
            continue;
          }

          pushWarning({
            ruleId: CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID,
            message: `node "${nodeId}" label="${nodeLabel}" references undefined context key "${key}" via node_attr.${attrName}`,
            line: location.line,
            column: location.column,
            nodeId,
            dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID)}|${nodeId}|node_attr.${attrName}|${key}`,
          });
        }
        continue;
      }

      if (!shouldInspectNodeAttrForPlaceholders(attrName, CONTEXT_FLOW_PLACEHOLDER_ATTR_KEYS)) continue;

      const placeholders = extractTemplatePlaceholders(attrs[attrName]);
      if (placeholders.length === 0) continue;

      const location = resolveAttrLocation(nodeAst, attrName);
      for (const key of placeholders) {
        consumedReferences.push({
          key,
          kind: "node_attr",
          nodeId,
          edgeFrom: "",
          source: `node_attr.${attrName}`,
        });

        if (isResolveDefaultSelfBootstrapReference({ nodeMeta, attrName, key })) {
          continue;
        }

        if (knownBefore.has(key) || CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST.has(key)) {
          continue;
        }

        pushWarning({
          ruleId: CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID,
          message: `node "${nodeId}" label="${nodeLabel}" references undefined context key "${key}" via node_attr.${attrName}`,
          line: location.line,
          column: location.column,
          nodeId,
          dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID)}|${nodeId}|node_attr.${attrName}|${key}`,
        });
      }
    }
  }

  for (const edge of graphEdges) {
    const from = String(edge?.from || "");
    const to = String(edge?.to || "");
    const edgeId = `${from}->${to}`;
    const fromMeta = nodeMetaById.get(from);
    const fromLabel = fromMeta?.nodeLabel || from;
    const fromNodeAst = fromMeta?.nodeAst || null;
    const fromLocation = resolveAttrLocation(fromNodeAst, "prompt");

    const knownAtEdge = unionSets(
      knownBeforeByNode.get(from) || new Set(CONTEXT_FLOW_SEED_KEYS),
      fromMeta?.producedKeys || new Set(),
    );

    const conditionKeys = extractConditionKeys(edge?.attrs?.condition || "");
    for (const key of conditionKeys) {
      consumedReferences.push({
        key,
        kind: "edge_condition",
        nodeId: from,
        edgeFrom: from,
        source: `edge.${edgeId}.condition`,
      });

      if (knownAtEdge.has(key) || CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST.has(key)) continue;

      pushWarning({
        ruleId: CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID,
        message: `edge "${edgeId}" from node "${from}" label="${fromLabel}" references undefined context key "${key}" via edge.condition`,
        line: fromLocation.line,
        column: fromLocation.column,
        nodeId: from,
        dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID)}|${edgeId}|edge.condition|${key}`,
      });
    }

    const inputKey = String(edge?.attrs?.input_key || "").trim();
    if (inputKey) {
      consumedReferences.push({
        key: inputKey,
        kind: "edge_input_key",
        nodeId: from,
        edgeFrom: from,
        source: `edge.${edgeId}.input_key`,
      });

      if (!knownAtEdge.has(inputKey) && !CONTEXT_FLOW_UNDEFINED_REFERENCE_ALLOWLIST.has(inputKey)) {
        pushWarning({
          ruleId: CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID,
          message: `edge "${edgeId}" from node "${from}" label="${fromLabel}" references undefined context key "${inputKey}" via edge.input_key`,
          line: fromLocation.line,
          column: fromLocation.column,
          nodeId: from,
          dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNDEFINED_REFERENCE_RULE_ID)}|${edgeId}|edge.input_key|${inputKey}`,
        });
      }
    }
  }

  for (const nodeId of nodeIds) {
    const nodeMeta = nodeMetaById.get(nodeId);
    if (!nodeMeta || nodeMeta.handlerType !== "tool") continue;

    const outputKey = nodeMeta.outputKey;
    if (!outputKey) continue;
    if (isReceiptOnlyOutputKey(outputKey)) continue;
    if (isEmitterReceiptOutput(nodeMeta)) continue;
    if (isSeedNormalizationOutput(nodeMeta)) continue;

    const reachable = computeReachableNodeIds(nodeId, outgoingByNode);
    if (hasConsumedStructuredOutputs({ nodeMeta, consumedReferences, reachable })) continue;
    let consumedDownstream = false;

    for (const reference of consumedReferences) {
      if (reference.key !== outputKey) continue;

      if (reference.kind === "node_attr") {
        if (reference.nodeId !== nodeId && reachable.has(reference.nodeId)) {
          consumedDownstream = true;
          break;
        }
        continue;
      }

      if (reachable.has(reference.edgeFrom)) {
        consumedDownstream = true;
        break;
      }
    }

    if (isTerminalContractOutput({ outputKey, reachable, graphNodes, resolveNodeHandlerType })) {
      continue;
    }

    if (consumedDownstream) continue;

    const location = resolveAttrLocation(nodeMeta.nodeAst, "output_key");
    pushWarning({
      ruleId: CONTEXT_FLOW_UNUSED_OUTPUT_KEY_RULE_ID,
      message: `tool node "${nodeId}" label="${nodeMeta.nodeLabel}" produces output_key "${outputKey}" that is never consumed downstream by conditions, edge input_key, or variable references`,
      line: location.line,
      column: location.column,
      nodeId,
      dedupKey: `${ruleIdKey(CONTEXT_FLOW_UNUSED_OUTPUT_KEY_RULE_ID)}|${nodeId}|${outputKey}`,
    });
  }

  return sortDiagnostics(warnings);
}

function ruleIdKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isAliasCompatAllowed(aliasCompatSet, file, node, alias) {
  const normalizedAlias = String(alias || "").trim().toLowerCase();
  return aliasCompatSet.has(`${file}#${node}#${normalizedAlias}`) || aliasCompatSet.has(`${file}#${node}#*`);
}

function toDiagnostic({ file, severity, ruleId, message, line, column, node }) {
  return {
    file,
    severity,
    rule_id: ruleId,
    message,
    line,
    column,
    node,
  };
}

export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => {
    const fileCmp = left.file.localeCompare(right.file, "en");
    if (fileCmp !== 0) return fileCmp;

    const severityCmp = left.severity.localeCompare(right.severity, "en");
    if (severityCmp !== 0) return severityCmp;

    const ruleCmp = left.rule_id.localeCompare(right.rule_id, "en");
    if (ruleCmp !== 0) return ruleCmp;

    const lineCmp = left.line - right.line;
    if (lineCmp !== 0) return lineCmp;

    const columnCmp = left.column - right.column;
    if (columnCmp !== 0) return columnCmp;

    const nodeCmp = left.node.localeCompare(right.node, "en");
    if (nodeCmp !== 0) return nodeCmp;

    return left.message.localeCompare(right.message, "en");
  });
}

export function sortInlineScriptTelemetry(entries) {
  return [...entries].sort((left, right) => {
    const fileCmp = left.file.localeCompare(right.file, "en");
    if (fileCmp !== 0) return fileCmp;

    const nodeCmp = left.nodeId.localeCompare(right.nodeId, "en");
    if (nodeCmp !== 0) return nodeCmp;

    const actionCmp = left.action.localeCompare(right.action, "en");
    if (actionCmp !== 0) return actionCmp;

    const typeCmp = left.matchType.localeCompare(right.matchType, "en");
    if (typeCmp !== 0) return typeCmp;

    return left.matchedPattern.localeCompare(right.matchedPattern, "en");
  });
}

export async function lintDotFiles({
  files,
  compatFile = DEFAULT_COMPAT_FILE,
  inlineScriptBaselineFile = DEFAULT_INLINE_SCRIPT_BASELINE_FILE,
  enforceInlineScriptDebt = true,
}) {
  const compat = loadCompatConfig(compatFile);
  const diagnostics = [];
  const inlineScriptTelemetry = [];
  const declarativeToolTelemetry = [];
  const shellMetasyntaxTelemetry = [];
  const inlineScriptMarkers = [];

  for (const fileArg of files) {
    const file = normalizePath(fileArg);
    const absolutePath = resolve(process.cwd(), fileArg);

    if (!existsSync(absolutePath)) {
      diagnostics.push(toDiagnostic({
        file,
        severity: "error",
        ruleId: "io.file_not_found",
        message: `file not found: ${fileArg}`,
        line: 1,
        column: 1,
        node: "",
      }));
      continue;
    }

    const source = readFileSync(absolutePath, "utf8");
    let parsed;
    try {
      parsed = await parseDotFileWithAst({
        input: source,
        filePath: absolutePath,
      });
    } catch (error) {
      const syntax = parseSyntaxLocation(error?.message || error);
      const ruleId = String(error?.code || "").startsWith("stylesheet_import.")
        ? "parser.stylesheet_import"
        : "parser.syntax";
      diagnostics.push(toDiagnostic({
        file,
        severity: "error",
        ruleId,
        message: syntax.message,
        line: syntax.line,
        column: syntax.column,
        node: "",
      }));
      continue;
    }

    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const contextFlowWarnings = buildContextFlowWarnings({
      file,
      parsed,
      nodesAst: nodes,
    });
    diagnostics.push(...contextFlowWarnings);

    for (const node of nodes) {
      const nodeId = String(node?.id || "");
      if (!nodeId) continue;

      const resolvedNodeAttrs = parsed?.graph?.nodes?.[nodeId]?.attrs || {};
      const attrs = attrsFromNode(node, resolvedNodeAttrs);
      const nodeLabel = nodeLabelFromAttrs(attrs, nodeId);
      const hasDomain = Object.prototype.hasOwnProperty.call(attrs, TRUST_DOMAIN_KEY);
      const hasRole = Object.prototype.hasOwnProperty.call(attrs, TRUST_ROLE_KEY);
      const pairCompatKey = `${file}#${nodeId}`;

      if ((hasDomain || hasRole) && hasDomain !== hasRole && !compat.domainRoleCompatSet.has(pairCompatKey)) {
        diagnostics.push(toDiagnostic({
          file,
          severity: "error",
          ruleId: "trust.compat.domain_role_pair",
          message: `node \"${nodeId}\" must declare ${TRUST_DOMAIN_KEY} and ${TRUST_ROLE_KEY} together`,
          line: Number(node?.idToken?.line || 1),
          column: Number(node?.idToken?.column || 1),
          node: nodeId,
        }));
      }

      for (const alias of LEGACY_TRUST_ALIASES) {
        const aliasEntry = findAttrEntry(node, alias);
        if (!aliasEntry) continue;
        if (isAliasCompatAllowed(compat.aliasCompatSet, file, nodeId, alias)) continue;

        diagnostics.push(toDiagnostic({
          file,
          severity: "error",
          ruleId: "trust.compat.alias",
          message: `node \"${nodeId}\" uses legacy ${alias}; prefer ${TRUST_DOMAIN_KEY}/${TRUST_ROLE_KEY} or declare explicit compat`,
          line: Number(aliasEntry.line || node?.idToken?.line || 1),
          column: Number(aliasEntry.column || node?.idToken?.column || 1),
          node: nodeId,
        }));
      }

      const handlerType = resolveNodeHandlerType(attrs);
      const explicitLabel = nodeExplicitLabel(attrs);
      if (handlerType !== "start" && handlerType !== "exit" && !explicitLabel) {
        diagnostics.push(toDiagnostic({
          file,
          severity: "error",
          ruleId: NODE_LABEL_REQUIRED_RULE_ID,
          message: `node \"${nodeId}\" must declare non-empty label (required for all non-start/exit nodes)`,
          line: Number(node?.idToken?.line || 1),
          column: Number(node?.idToken?.column || 1),
          node: nodeId,
        }));
      }

      const promptEntry = findAttrEntry(node, "prompt");
      const promptText = String(promptEntry?.value || "");
      const normalizedPrompt = normalizeToolPromptForPolicy(promptText);

      diagnostics.push(...benchmarkIdentityDiagnosticsForNode({
        file,
        nodeId,
        attrs,
        line: Number(node?.idToken?.line || 1),
        column: Number(node?.idToken?.column || 1),
      }));

      if (handlerType === "tool") {
        const outputMetadata = resolveToolOutputMetadata(attrs);
        const allowlistMatch = findToolOutputMetadataAllowlistMatch(normalizedPrompt);

        if (!outputMetadata && !allowlistMatch) {
          diagnostics.push(toDiagnostic({
            file,
            severity: "error",
            ruleId: TOOL_OUTPUT_METADATA_REQUIRED_RULE_ID,
            message: `tool node \"${nodeId}\" label=\"${nodeLabel}\" must declare output metadata via output_key (preferred) or compatibility aliases output_keys/outputs unless prompt is explicitly allowlisted no-op/router`,
            line: Number(node?.idToken?.line || 1),
            column: Number(node?.idToken?.column || 1),
            node: nodeId,
          }));
        }

        const hasInlineScripts = collectInlineScriptMatches(promptText, handlerType).length > 0;
        const hasInlineScriptMarker = nodeHasInlineScriptMarker(node, promptText);
        const skipToolPromptPolicyRules = allowlistMatch || hasInlineScripts || hasInlineScriptMarker;
        const shellMetasyntaxViolation = skipToolPromptPolicyRules
          ? null
          : findToolShellMetasyntaxViolation({
            rawPromptText: promptText,
            normalizedPrompt,
          });
        if (shellMetasyntaxViolation) {
          diagnostics.push(toDiagnostic({
            file,
            severity: "error",
            ruleId: PROMPT_SHELL_METASYNTAX_RULE_ID,
            message: `tool node "${nodeId}" label="${nodeLabel}" contains shell metasyntax token="${shellMetasyntaxViolation.forbiddenToken}" snippet="${promptSnippetForTelemetry(normalizedPrompt)}"`,
            line: Number(promptEntry?.line || node?.idToken?.line || 1),
            column: Number(promptEntry?.column || node?.idToken?.column || 1),
            node: nodeId,
          }));
          shellMetasyntaxTelemetry.push({
            file,
            nodeId,
            nodeLabel,
            forbiddenToken: shellMetasyntaxViolation.forbiddenToken,
            promptSnippet: promptSnippetForTelemetry(normalizedPrompt),
            line: Number(promptEntry?.line || node?.idToken?.line || 1),
          });
        }

        const declarativeViolation = skipToolPromptPolicyRules
          ? null
          : findToolDeclarativePromptViolation({
            rawPromptText: promptText,
            normalizedPrompt,
          });
        if (declarativeViolation) {
          diagnostics.push(toDiagnostic({
            file,
            severity: "error",
            ruleId: TOOL_DECLARATIVE_PROMPT_POLICY_RULE_ID,
            message: `tool node "${nodeId}" label="${nodeLabel}" violates declarative prompt policy: forbidden token="${declarativeViolation.forbiddenToken}" snippet="${promptSnippetForTelemetry(normalizedPrompt)}"`,
            line: Number(promptEntry?.line || node?.idToken?.line || 1),
            column: Number(promptEntry?.column || node?.idToken?.column || 1),
            node: nodeId,
          }));
          declarativeToolTelemetry.push({
            file,
            nodeId,
            nodeLabel,
            forbiddenToken: declarativeViolation.forbiddenToken,
            promptSnippet: promptSnippetForTelemetry(normalizedPrompt),
          });
        }

        const mutability = classifyToolPromptMutability(normalizedPrompt, allowlistMatch);
        if (mutability.kind === "mutable") {
          const governanceRaw = String(attrs?.governance || "").trim();
          const governance = governanceRaw.toLowerCase();
          const governanceEntry = findAttrEntry(node, "governance");
          const locationLine = Number(governanceEntry?.line || promptEntry?.line || node?.idToken?.line || 1);
          const locationColumn = Number(governanceEntry?.column || promptEntry?.column || node?.idToken?.column || 1);
          const heuristics = mutability.mutableRuleIds.join(",") || "unknown";

          if (!governance) {
            diagnostics.push(toDiagnostic({
              file,
              severity: "error",
              ruleId: TOOL_MUTABLE_GOVERNANCE_REQUIRED_RULE_ID,
              message: `tool node \"${nodeId}\" label=\"${nodeLabel}\" has mutable command (heuristics=${heuristics}) and must declare governance=\"irreversible\"`,
              line: locationLine,
              column: locationColumn,
              node: nodeId,
            }));
          } else if (governance !== "irreversible") {
            diagnostics.push(toDiagnostic({
              file,
              severity: "error",
              ruleId: TOOL_MUTABLE_GOVERNANCE_IRREVERSIBLE_RULE_ID,
              message: `tool node \"${nodeId}\" label=\"${nodeLabel}\" has mutable command (heuristics=${heuristics}); governance=\"${governanceRaw}\" is invalid and must be \"irreversible\"`,
              line: locationLine,
              column: locationColumn,
              node: nodeId,
            }));
          }
        }

        // Shell-unsafe arg detection: flag known multi-line/user content passed as single-quoted shell args
        if (promptText) {
          const unsafeArgRegex = new RegExp(SHELL_UNSAFE_ARG_REGEX.source, SHELL_UNSAFE_ARG_REGEX.flags);
          let unsafeMatch;
          while ((unsafeMatch = unsafeArgRegex.exec(promptText)) !== null) {
            const varName = unsafeMatch[1];
            if (SHELL_UNSAFE_CONTENT_VARS.has(varName)) {
              diagnostics.push(toDiagnostic({
                file,
                severity: "error",
                ruleId: SHELL_UNSAFE_ARG_RULE_ID,
                message: `tool node "${nodeId}" label="${nodeLabel}" passes shell-unsafe variable \${${varName}} as single-quoted CLI arg; use base64 encoding (--arg-b64 "$(printf '%s' "\${${varName}}" | base64)") or stdin/temp file instead`,
                line: Number(promptEntry?.line || node?.idToken?.line || 1),
                column: Number(promptEntry?.column || node?.idToken?.column || 1),
                node: nodeId,
              }));
            }
            if (unsafeArgRegex.lastIndex <= unsafeMatch.index) {
              unsafeArgRegex.lastIndex = unsafeMatch.index + 1;
            }
          }
        }
      }

      if (!TARGET_INLINE_SCRIPT_HANDLERS.has(handlerType)) continue;

      const hasMarker = nodeHasInlineScriptMarker(node, promptText);
      if (hasMarker) {
        const markerLine = Number(promptEntry?.line || node?.idToken?.line || 1);
        const markerColumn = Number(promptEntry?.column || node?.idToken?.column || 1);
        inlineScriptMarkers.push({
          file,
          node_id: nodeId,
          node_label: nodeLabel,
          handler_type: handlerType,
          identity: computeInlineScriptMarkerIdentity({
            file,
            nodeId,
            handlerType,
            markerText: INLINE_SCRIPT_MARKER,
          }),
          line: markerLine,
          column: markerColumn,
        });
      }

      if (!promptEntry) continue;

      const matches = collectInlineScriptMatches(promptText, handlerType);
      if (matches.length === 0) continue;

      for (const match of matches) {
        const telemetryEntry = {
          action: hasMarker ? "skip" : "violation",
          file,
          nodeId,
          nodeLabel,
          reason: hasMarker ? INLINE_SCRIPT_MARKER_REASON : "",
          matchType: match.matchType,
          matchedPattern: match.matchedPattern,
        };
        inlineScriptTelemetry.push(telemetryEntry);

        if (hasMarker) continue;

        diagnostics.push(toDiagnostic({
          file,
          severity: "error",
          ruleId: INLINE_SCRIPT_RULE_ID,
          message: `node \"${nodeId}\" label=\"${nodeLabel}\" contains inline executable pattern \"${match.matchedPattern}\" (match_type=${match.matchType}); add marker line \"${INLINE_SCRIPT_MARKER}\" only when explicitly justified`,
          line: Number(promptEntry.line || node?.idToken?.line || 1),
          column: Number(promptEntry.column || node?.idToken?.column || 1),
          node: nodeId,
        }));
      }
    }
  }

  let inlineScriptDebtReport = null;
  if (enforceInlineScriptDebt) {
    const debtResult = enforceInlineScriptDebtPolicy({ files, inlineScriptMarkers, inlineScriptBaselineFile, inlineScriptMarker: INLINE_SCRIPT_MARKER, normalizePath, toDiagnostic, debtRuleId: INLINE_SCRIPT_IGNORE_DEBT_RULE_ID });
    diagnostics.push(...debtResult.diagnostics);
    inlineScriptDebtReport = debtResult.report;
  }

  const orderedDiagnostics = sortDiagnostics(diagnostics);
  const orderedTelemetry = sortInlineScriptTelemetry(inlineScriptTelemetry);
  const orderedDeclarativeToolTelemetry = sortDeclarativeToolTelemetry(declarativeToolTelemetry);
  const orderedShellMetasyntaxTelemetry = sortShellMetasyntaxTelemetry(shellMetasyntaxTelemetry);
  const hasErrors = orderedDiagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    ok: !hasErrors,
    diagnostics: orderedDiagnostics,
    inlineScriptTelemetry: orderedTelemetry,
    declarativeToolTelemetry: orderedDeclarativeToolTelemetry,
    shellMetasyntaxTelemetry: orderedShellMetasyntaxTelemetry,
    inlineScriptMarkers: dedupeInlineScriptMarkers(inlineScriptMarkers.map((entry) => toSerializableInlineScriptMarker(entry, { markerText: INLINE_SCRIPT_MARKER }))),
    inlineScriptDebtReport,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  if (options.inlineScriptBaselineDiff || options.inlineScriptBaselineRefresh) {
    if (options.files.length > 0) {
      throw new Error("baseline diff/refresh modes do not accept positional dot file arguments");
    }

    const report = await runInlineScriptBaselineMode({ options, inlineScriptMarker: INLINE_SCRIPT_MARKER, lintDotFiles });
    emitInlineScriptBaselineDiffTelemetry(report, { action: options.inlineScriptBaselineRefresh ? "refresh" : "diff" });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exit(0);
  }

  if (options.files.length === 0) {
    throw new Error(`missing dot files\n${usage()}`);
  }

  const result = await lintDotFiles({ files: options.files, compatFile: options.compatFile, inlineScriptBaselineFile: options.inlineScriptBaselineFile, enforceInlineScriptDebt: true });

  for (const entry of result.inlineScriptTelemetry) {
    const fields = [
      `[dot-lint] inline_script_${entry.action}`,
      `file=${JSON.stringify(entry.file)}`,
      `node_id=${JSON.stringify(entry.nodeId)}`,
      `node_label=${JSON.stringify(entry.nodeLabel)}`,
      `match_type=${entry.matchType}`,
      `pattern=${JSON.stringify(entry.matchedPattern)}`,
    ];
    if (entry.action === "skip") {
      fields.push(`reason=${entry.reason || INLINE_SCRIPT_MARKER_REASON}`);
    }
    process.stderr.write(`${fields.join(" ")}\n`);
  }

  for (const entry of result.shellMetasyntaxTelemetry || []) {
    const fields = [
      "[dot-lint] shell_metasyntax_violation",
      `node=${JSON.stringify(entry.nodeId)}`,
      `file=${JSON.stringify(entry.file)}`,
      `token=${JSON.stringify(entry.forbiddenToken)}`,
      `line=${entry.line}`,
      `node_id=${JSON.stringify(entry.nodeId)}`,
      `node_label=${JSON.stringify(entry.nodeLabel)}`,
      `forbidden_token=${JSON.stringify(entry.forbiddenToken)}`,
      `snippet=${JSON.stringify(entry.promptSnippet)}`,
    ];
    process.stderr.write(`${fields.join(" ")}\n`);
  }

  for (const entry of result.declarativeToolTelemetry || []) {
    const fields = [
      "[dot-lint] tool_prompt_policy_violation",
      `node=${JSON.stringify(entry.nodeId)}`,
      `file=${JSON.stringify(entry.file)}`,
      `token=${JSON.stringify(entry.forbiddenToken)}`,
      `node_id=${JSON.stringify(entry.nodeId)}`,
      `node_label=${JSON.stringify(entry.nodeLabel)}`,
      `forbidden_token=${JSON.stringify(entry.forbiddenToken)}`,
      `snippet=${JSON.stringify(entry.promptSnippet)}`,
    ];
    process.stderr.write(`${fields.join(" ")}\n`);
  }

  if (result.inlineScriptDebtReport && result.inlineScriptDebtReport.summary.added > 0) {
    emitInlineScriptBaselineDiffTelemetry(result.inlineScriptDebtReport, { action: "violation" });
  }

  const exitCode = result.ok ? 0 : 1;
  process.stdout.write(`${JSON.stringify(result.diagnostics)}\n`, () => {
    process.exit(exitCode);
  });
}
const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(2);
  });
}
