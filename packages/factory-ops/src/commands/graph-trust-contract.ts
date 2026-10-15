import { readdirSync, writeFileSync } from "node:fs";

import { isWorkflowSourceModulePath, loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

import { listActiveIntentGraphPaths } from "../lib/active-graphs.ts";
import {
  AGENT_ID_KEY,
  AGENT_IDS_V1,
  AGENT_ROLE_KEY,
  AGENT_ROLES_V1,
  isValidAgentIdV1,
  isValidAgentRoleV1,
} from "../lib/trust-agent-identity-v1.ts";
import {
  LEGACY_TRUST_IDENTITY_KEY,
  LOCAL_INTENTS_TRUST_DOMAIN,
  TRUST_DOMAIN_ALLOWLIST,
  TRUST_DOMAIN_KEY,
  TRUST_ROLE_ALLOWLIST,
  TRUST_ROLE_KEY,
  expectedTrustIdentityForHandlerType,
  expectedTrustRoleForHandlerType,
  isLegacyTrustIdentityKey,
  isTrustParticipatingHandlerType,
  isValidTrustDomain,
  isValidTrustRole,
  parseLegacyTrustIdentity,
  resolveHandlerTypeFromAttrs,
} from "../lib/trust-participants.ts";

export const DEFAULT_LOCAL_INTENTS_GRAPHS_DIR = "factories/mothership/workflows";

const CLASS_DERIVED_TRUST_DEFAULTS = {
  reviewer: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  judge: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  knowledge_worker: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  scenario_author: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  release_narrator: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  goal_decomposer: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  goal_batch_reviewer: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  issue_quality_judge: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  post_merge_judge: {
    type: "codergen",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.codergen",
  },
  coder: {
    type: "agent.worktree",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.agent.worktree",
  },
  supervisor: {
    type: "stack.manager_loop",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.stack.manager_loop",
  },
  merge_resolver: {
    type: "stack.manager_loop",
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: "mothership.local.stack.manager_loop",
  },
};

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isStrictTrustContractEnabled(rawValue = "", env = process.env) {
  if (String(rawValue || "").trim()) return isTruthy(rawValue);
  return isTruthy(env?.INTENTS_TRUST_CONTRACT_STRICT || "");
}

export function listLocalIntentGraphPaths({ graphsDir = DEFAULT_LOCAL_INTENTS_GRAPHS_DIR } = {}) {
  const paths = [];
  for (const entry of readdirSync(graphsDir, { withFileTypes: true })) {
    const path = `${graphsDir}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...listLocalIntentGraphPaths({ graphsDir: path }));
    else if (entry.isFile() && (entry.name.endsWith(".dot") || isWorkflowSourceModulePath(entry.name))) paths.push(path);
  }
  return paths.sort();
}

export function listActiveLocalIntentGraphPaths({ graphsDir = DEFAULT_LOCAL_INTENTS_GRAPHS_DIR } = {}) {
  const normalizedPrefix = `${String(graphsDir || "").replace(/\\/g, "/").replace(/\/$/, "")}/`;
  return listActiveIntentGraphPaths({ graphsDir })
    .filter((path) => String(path || "").replace(/\\/g, "/").startsWith(normalizedPrefix))
    .sort();
}

export function migrateTrustContractInDot(dot, { sourcePath = "" } = {}) {
  const parsed = parseDotGraph(String(dot || ""), sourcePath);
  const patches = [];
  let trustParticipants = 0;
  let changedNodes = 0;

  for (const node of parsed.nodes) {
    const attrs = attrsFromAttrList(node.attrList);
    const resolvedAttrs = resolveAttrsWithClassDefaults(attrs);
    const handlerType = resolveHandlerTypeFromAttrs(resolvedAttrs);
    if (!isTrustParticipatingHandlerType(handlerType)) continue;

    trustParticipants += 1;

    const expectedIdentity = expectedTrustIdentityForHandlerType(handlerType);
    const expectedRole = expectedIdentity?.trust_role || expectedTrustRoleForHandlerType(handlerType);
    if (!expectedRole) continue;

    if (!node.attrList) {
      patches.push({
        start: node.idToken.end,
        end: node.idToken.end,
        text: ` [${TRUST_DOMAIN_KEY}=${quoteDotValue(LOCAL_INTENTS_TRUST_DOMAIN)} ${TRUST_ROLE_KEY}=${quoteDotValue(expectedRole)}]`,
      });
      changedNodes += 1;
      continue;
    }

    const trustDomainEntries = node.attrList.entries.filter((entry) => entry.key === TRUST_DOMAIN_KEY);
    const trustRoleEntries = node.attrList.entries.filter((entry) => entry.key === TRUST_ROLE_KEY);
    const legacyIdentityEntries = node.attrList.entries.filter((entry) => isLegacyTrustIdentityKey(entry.key));

    const hasNoTrustAttrs = trustDomainEntries.length === 0 && trustRoleEntries.length === 0 && legacyIdentityEntries.length === 0;
    if (hasNoTrustAttrs) {
      if (hasCanonicalClassTrustDefaults(attrs, expectedRole)) {
        continue;
      }
      patches.push({
        start: node.attrList.end - 1,
        end: node.attrList.end - 1,
        text: ` ${TRUST_DOMAIN_KEY}=${quoteDotValue(LOCAL_INTENTS_TRUST_DOMAIN)} ${TRUST_ROLE_KEY}=${quoteDotValue(expectedRole)}`,
      });
      changedNodes += 1;
      continue;
    }

    const alreadyCanonical = isCanonicalTrustContract({
      attrList: node.attrList,
      expectedRole,
      requireNoLegacy: true,
    });
    if (alreadyCanonical) continue;

    const rewritten = rewriteAttrListWithCanonicalTrustContract({
      attrList: node.attrList,
      expectedRole,
    });
    if (rewritten !== node.attrList.raw) {
      patches.push({ start: node.attrList.start, end: node.attrList.end, text: rewritten });
      changedNodes += 1;
    }
  }

  if (patches.length === 0) {
    return {
      content: String(dot || ""),
      changed: false,
      changed_nodes: 0,
      trust_participants: trustParticipants,
    };
  }

  const content = applyPatches(String(dot || ""), patches);
  return {
    content,
    changed: true,
    changed_nodes: changedNodes,
    trust_participants: trustParticipants,
  };
}

export function validateTrustContractInDot(dot, { sourcePath = "", strict = false } = {}) {
  const violations = [];
  let trustParticipants = 0;

  const defaultViolationPath = normalizeViolationPath(sourcePath) || "<dot>";
  const allowedAgentIdsLabel = AGENT_IDS_V1.join(", ");
  const allowedAgentRolesLabel = AGENT_ROLES_V1.join(", ");

  let parsed;
  try {
    parsed = parseDotGraph(String(dot || ""), sourcePath);
  } catch (error) {
    violations.push({
      code: "dot_parse_error",
      message: String(error?.message || error),
      path: sourcePath,
    });
    return {
      ok: false,
      strict,
      trust_participants: 0,
      violations: normalizeTrustContractViolations(violations, { defaultPath: defaultViolationPath }),
    };
  }

  for (const node of parsed.nodes) {
    const attrs = attrsFromAttrList(node.attrList);
    const resolvedAttrs = resolveAttrsWithClassDefaults(attrs);
    const handlerType = resolveHandlerTypeFromAttrs(resolvedAttrs);
    if (!isTrustParticipatingHandlerType(handlerType)) continue;
    trustParticipants += 1;

    const expectedRole = expectedTrustRoleForHandlerType(handlerType);
    const location = toNodeLocation(defaultViolationPath, node.id);

    if (!node.attrList) {
      violations.push({
        code: "missing_attr_list",
        message: `Trust-participating node ${node.id} is missing attribute list`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
      continue;
    }

    const trustDomainEntries = node.attrList.entries.filter((entry) => entry.key === TRUST_DOMAIN_KEY);
    const trustRoleEntries = node.attrList.entries.filter((entry) => entry.key === TRUST_ROLE_KEY);
    const agentIdEntries = node.attrList.entries.filter((entry) => entry.key === AGENT_ID_KEY);
    const agentRoleEntries = node.attrList.entries.filter((entry) => entry.key === AGENT_ROLE_KEY);
    const legacyIdentityEntries = node.attrList.entries.filter((entry) => isLegacyTrustIdentityKey(entry.key));
    const classDerivedDefaults = resolveClassDerivedTrustDefaults(attrs);

    if (trustDomainEntries.length === 0 && !classDerivedDefaults[TRUST_DOMAIN_KEY]) {
      violations.push({
        code: "missing_trust_domain",
        message: `${location} missing ${TRUST_DOMAIN_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustRoleEntries.length === 0 && !classDerivedDefaults[TRUST_ROLE_KEY]) {
      violations.push({
        code: "missing_trust_role",
        message: `${location} missing ${TRUST_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustDomainEntries.length > 1) {
      violations.push({
        code: "duplicate_trust_domain",
        message: `${location} has duplicate ${TRUST_DOMAIN_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustRoleEntries.length > 1) {
      violations.push({
        code: "duplicate_trust_role",
        message: `${location} has duplicate ${TRUST_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (legacyIdentityEntries.length > 1) {
      violations.push({
        code: "duplicate_legacy_trust_identity",
        message: `${location} has duplicate ${LEGACY_TRUST_IDENTITY_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    const trustDomain = String(trustDomainEntries[0]?.value || classDerivedDefaults[TRUST_DOMAIN_KEY] || "").trim();
    const trustRole = String(trustRoleEntries[0]?.value || classDerivedDefaults[TRUST_ROLE_KEY] || "").trim();

    if (trustDomainEntries.length === 1 && !trustDomain) {
      violations.push({
        code: "empty_trust_domain",
        message: `${location} has empty ${TRUST_DOMAIN_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustRoleEntries.length === 1 && !trustRole) {
      violations.push({
        code: "empty_trust_role",
        message: `${location} has empty ${TRUST_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (!strict) continue;

    if (agentIdEntries.length === 0) {
      violations.push({
        code: "missing_agent_id",
        message: `${location} missing ${AGENT_ID_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (agentRoleEntries.length === 0) {
      violations.push({
        code: "missing_agent_role",
        message: `${location} missing ${AGENT_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (agentIdEntries.length > 1) {
      violations.push({
        code: "duplicate_agent_id",
        message: `${location} has duplicate ${AGENT_ID_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (agentRoleEntries.length > 1) {
      violations.push({
        code: "duplicate_agent_role",
        message: `${location} has duplicate ${AGENT_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    const agentId = String(agentIdEntries[0]?.value || "").trim();
    const agentRole = String(agentRoleEntries[0]?.value || "").trim();

    if (agentIdEntries.length === 1 && !isValidAgentIdV1(agentId)) {
      violations.push({
        code: "invalid_agent_id",
        message: `${location} has invalid ${AGENT_ID_KEY}=${String(agentIdEntries[0]?.value || "")}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_values: AGENT_IDS_V1,
        expected_values_label: allowedAgentIdsLabel,
        actual_value: String(agentIdEntries[0]?.value || ""),
        path: defaultViolationPath,
      });
    }

    if (agentRoleEntries.length === 1 && !isValidAgentRoleV1(agentRole)) {
      violations.push({
        code: "invalid_agent_role",
        message: `${location} has invalid ${AGENT_ROLE_KEY}=${String(agentRoleEntries[0]?.value || "")}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_values: AGENT_ROLES_V1,
        expected_values_label: allowedAgentRolesLabel,
        actual_value: String(agentRoleEntries[0]?.value || ""),
        path: defaultViolationPath,
      });
    }

    const hasCanonicalIdentity = trustDomainEntries.length > 0 || trustRoleEntries.length > 0;
    if (legacyIdentityEntries.length > 0 && hasCanonicalIdentity) {
      violations.push({
        code: "mixed_trust_identity_schema",
        message: `${location} mixes legacy ${LEGACY_TRUST_IDENTITY_KEY} with canonical ${TRUST_DOMAIN_KEY}/${TRUST_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    for (const legacyEntry of legacyIdentityEntries) {
      const legacyParsed = parseLegacyTrustIdentity(legacyEntry.value);
      if (!legacyParsed) {
        violations.push({
          code: "malformed_legacy_trust_identity",
          message: `${location} has malformed ${LEGACY_TRUST_IDENTITY_KEY}=${String(legacyEntry.value || "")}`,
          node_id: node.id,
          handler_type: handlerType,
          path: defaultViolationPath,
        });
        continue;
      }

      if (legacyParsed.domain !== LOCAL_INTENTS_TRUST_DOMAIN || legacyParsed.role !== expectedRole) {
        violations.push({
          code: "conflicting_legacy_trust_identity",
          message: `${location} ${LEGACY_TRUST_IDENTITY_KEY} conflicts with canonical handler contract`,
          node_id: node.id,
          handler_type: handlerType,
          expected_domain: LOCAL_INTENTS_TRUST_DOMAIN,
          expected_role: expectedRole,
          actual_domain: legacyParsed.domain,
          actual_role: legacyParsed.role,
          path: defaultViolationPath,
        });
      }

      violations.push({
        code: "legacy_trust_identity_forbidden",
        message: `${location} uses legacy ${LEGACY_TRUST_IDENTITY_KEY}; strict mode requires canonical ${TRUST_DOMAIN_KEY}/${TRUST_ROLE_KEY}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustDomainEntries.length === 1 && trustDomain && !isValidTrustDomain(trustDomain)) {
      violations.push({
        code: "malformed_trust_domain",
        message: `${location} has malformed ${TRUST_DOMAIN_KEY}=${trustDomain}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustRoleEntries.length === 1 && trustRole && !isValidTrustRole(trustRole)) {
      violations.push({
        code: "malformed_trust_role",
        message: `${location} has malformed ${TRUST_ROLE_KEY}=${trustRole}`,
        node_id: node.id,
        handler_type: handlerType,
        path: defaultViolationPath,
      });
    }

    if (trustDomainEntries.length === 1 && trustDomain && isValidTrustDomain(trustDomain) && !TRUST_DOMAIN_ALLOWLIST.has(trustDomain)) {
      violations.push({
        code: "invalid_trust_domain",
        message: `${location} has unsupported ${TRUST_DOMAIN_KEY}=${trustDomain}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_domain: LOCAL_INTENTS_TRUST_DOMAIN,
        path: defaultViolationPath,
      });
    }

    if (trustRoleEntries.length === 1 && trustRole && isValidTrustRole(trustRole) && !TRUST_ROLE_ALLOWLIST.has(trustRole)) {
      violations.push({
        code: "invalid_trust_role",
        message: `${location} has unsupported ${TRUST_ROLE_KEY}=${trustRole}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_role: expectedRole,
        path: defaultViolationPath,
      });
    }

    if (trustRole && trustRole !== expectedRole) {
      violations.push({
        code: "non_canonical_trust_role",
        message: `${location} expected ${TRUST_ROLE_KEY}=${expectedRole} for handler ${handlerType}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_role: expectedRole,
        actual_role: trustRole,
        path: defaultViolationPath,
      });
    }

    if (trustDomain && trustDomain !== LOCAL_INTENTS_TRUST_DOMAIN) {
      violations.push({
        code: "non_canonical_trust_domain",
        message: `${location} expected ${TRUST_DOMAIN_KEY}=${LOCAL_INTENTS_TRUST_DOMAIN}`,
        node_id: node.id,
        handler_type: handlerType,
        expected_domain: LOCAL_INTENTS_TRUST_DOMAIN,
        actual_domain: trustDomain,
        path: defaultViolationPath,
      });
    }
  }

  const normalizedViolations = normalizeTrustContractViolations(violations, { defaultPath: defaultViolationPath });
  const hasViolations = normalizedViolations.length > 0;
  const ok = strict ? !hasViolations : true;

  return {
    ok,
    strict,
    trust_participants: trustParticipants,
    violations: normalizedViolations,
  };
}

export function migrateLocalIntentGraphTrustContracts({
  graphsDir = DEFAULT_LOCAL_INTENTS_GRAPHS_DIR,
  paths = [],
  write = false,
  activeOnly = false,
} = {}) {
  const targets = resolveTargetPaths({ graphsDir, paths, activeOnly });
  // @context:security Generated DOT must never replace executable authored source.
  // Validate/dry-run typed workflows, but require deliberate source edits for writes.
  if (write && targets.some(isWorkflowSourceModulePath)) throw new Error("typed_workflow_trust_migration_requires_source_edit");
  const files = [];
  let changedFiles = 0;

  for (const path of targets) {
    const before = loadGraphSemanticsText(path);
    const migrated = migrateTrustContractInDot(before, { sourcePath: path });
    if (migrated.changed && write) writeFileSync(path, migrated.content);
    if (migrated.changed) changedFiles += 1;
    files.push({
      path,
      changed: migrated.changed,
      changed_nodes: migrated.changed_nodes,
      trust_participants: migrated.trust_participants,
    });
  }

  return {
    graphs_dir: graphsDir,
    active_only: activeOnly,
    write,
    changed_files: changedFiles,
    files,
  };
}

export function validateLocalIntentGraphTrustContracts({
  graphsDir = DEFAULT_LOCAL_INTENTS_GRAPHS_DIR,
  paths = [],
  strict = false,
  activeOnly = false,
} = {}) {
  const targets = resolveTargetPaths({ graphsDir, paths, activeOnly });
  const files = [];
  const violations = [];
  let trustParticipants = 0;

  for (const path of targets) {
    const dot = loadGraphSemanticsText(path);
    const result = validateTrustContractInDot(dot, { sourcePath: path, strict });
    trustParticipants += result.trust_participants;
    files.push({
      path,
      ok: result.ok,
      trust_participants: result.trust_participants,
      violations: result.violations.length,
    });
    for (const violation of result.violations) violations.push(violation);
  }

  return {
    graphs_dir: graphsDir,
    active_only: activeOnly,
    strict,
    trust_participants: trustParticipants,
    ok: strict ? violations.length === 0 : true,
    files,
    violations,
  };
}

function resolveTargetPaths({ graphsDir, paths, activeOnly = false }) {
  if (Array.isArray(paths) && paths.length > 0) {
    return [...new Set(paths.map((value) => String(value || "").trim()).filter(Boolean))].sort();
  }
  if (activeOnly) return listActiveLocalIntentGraphPaths({ graphsDir });
  return listLocalIntentGraphPaths({ graphsDir });
}

function normalizeTrustContractViolations(violations, { defaultPath = "<dot>" } = {}) {
  return violations.map((violation) => {
    const normalizedPath = normalizeViolationPath(violation?.path || defaultPath) || defaultPath;
    const out = {
      ...violation,
      path: normalizedPath,
    };

    if (out.node_id) {
      out.node_location = toNodeLocation(normalizedPath, out.node_id);
    }

    return out;
  });
}

function normalizeViolationPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function toNodeLocation(path, nodeId) {
  return `${String(path || "<dot>")}#${String(nodeId || "")}`;
}

function isCanonicalTrustContract({ attrList, expectedRole, requireNoLegacy = false }) {
  const trustDomainEntries = attrList.entries.filter((entry) => entry.key === TRUST_DOMAIN_KEY);
  const trustRoleEntries = attrList.entries.filter((entry) => entry.key === TRUST_ROLE_KEY);
  if (trustDomainEntries.length !== 1 || trustRoleEntries.length !== 1) return false;

  if (requireNoLegacy) {
    const legacyEntries = attrList.entries.filter((entry) => isLegacyTrustIdentityKey(entry.key));
    if (legacyEntries.length > 0) return false;
  }

  return trustDomainEntries[0].value === LOCAL_INTENTS_TRUST_DOMAIN && trustRoleEntries[0].value === expectedRole;
}

function rewriteAttrListWithCanonicalTrustContract({ attrList, expectedRole }) {
  const entries = [];
  const seen = new Set();

  for (const entry of attrList.entries) {
    const key = String(entry.key || "").trim();
    if (!key || seen.has(key) || isLegacyTrustIdentityKey(key)) continue;
    seen.add(key);
    entries.push({ key: entry.keyRaw || key, keyNormalized: key, valueRaw: entry.valueRaw, value: entry.value });
  }

  ensureCanonicalAttr(entries, TRUST_DOMAIN_KEY, LOCAL_INTENTS_TRUST_DOMAIN);
  ensureCanonicalAttr(entries, TRUST_ROLE_KEY, expectedRole);

  return `[${entries.map((entry) => `${entry.key}=${entry.valueRaw}`).join(" ")}]`;
}

function ensureCanonicalAttr(entries, key, value) {
  const index = entries.findIndex((entry) => entry.keyNormalized === key);
  const canonicalRaw = quoteDotValue(value);
  if (index >= 0) {
    entries[index].value = value;
    entries[index].valueRaw = canonicalRaw;
    return;
  }
  entries.push({ key, keyNormalized: key, value, valueRaw: canonicalRaw });
}

function attrsFromAttrList(attrList) {
  if (!attrList) return {};
  const out = {};
  for (const entry of attrList.entries) {
    const key = String(entry.key || "").trim();
    if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = entry.value;
  }
  return out;
}

function parseClassList(rawClassValue) {
  return String(rawClassValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveClassDerivedTrustDefaults(attrs) {
  const derived = {};
  for (const className of parseClassList(attrs.class)) {
    const defaults = CLASS_DERIVED_TRUST_DEFAULTS[className];
    if (!defaults) continue;
    for (const [key, value] of Object.entries(defaults)) {
      if (!Object.prototype.hasOwnProperty.call(derived, key)) {
        derived[key] = value;
      }
    }
  }
  return derived;
}

function resolveAttrsWithClassDefaults(attrs) {
  return {
    ...resolveClassDerivedTrustDefaults(attrs),
    ...attrs,
  };
}

function hasCanonicalClassTrustDefaults(attrs, expectedRole) {
  const derived = resolveClassDerivedTrustDefaults(attrs);
  if (!derived[TRUST_DOMAIN_KEY] || !derived[TRUST_ROLE_KEY]) return false;
  return derived[TRUST_DOMAIN_KEY] === LOCAL_INTENTS_TRUST_DOMAIN && derived[TRUST_ROLE_KEY] === expectedRole;
}

function quoteDotValue(value) {
  return `"${String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

function applyPatches(input, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = input;
  for (const patch of sorted) {
    out = `${out.slice(0, patch.start)}${patch.text}${out.slice(patch.end)}`;
  }
  return out;
}

function parseDotGraph(input, sourcePath = "") {
  const parser = new DotParser(input, sourcePath);
  return parser.parse();
}

class DotParser {
  constructor(input, sourcePath = "") {
    this.input = String(input || "");
    this.sourcePath = sourcePath;
    this.pos = 0;
    this.nodes = [];
  }

  parse() {
    this.skipWhitespaceAndComments();
    this.consumeTopLevelImports();

    if (this.matchKeyword("strict")) {
      this.skipWhitespaceAndComments();
      this.consumeTopLevelImports();
    }

    if (!this.matchKeyword("digraph")) {
      throw this.error("expected 'digraph'");
    }

    this.skipWhitespaceAndComments();
    if (this.peek() !== "{") this.readIDToken(); // optional graph name

    this.skipWhitespaceAndComments();
    if (!this.matchChar("{")) throw this.error("expected '{'");

    this.parseBody();

    if (!this.matchChar("}")) throw this.error("expected '}'");

    return { nodes: this.nodes };
  }

  consumeTopLevelImports() {
    while (true) {
      this.skipWhitespaceAndComments();
      const start = this.pos;
      if (!this.matchChar("@")) return;
      if (!this.matchKeyword("import")) {
        this.pos = start;
        return;
      }

      this.skipWhitespaceAndComments();
      const importToken = this.readIDToken();
      if (!importToken) throw this.error("expected import path");

      this.skipWhitespaceAndComments();
      this.matchChar(";");
    }
  }

  parseBody() {
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length || this.peek() === "}") return;
      this.parseStatement();
      this.skipWhitespaceAndComments();
      this.matchChar(";");
    }
  }

  parseStatement() {
    this.skipWhitespaceAndComments();

    if (this.matchKeyword("subgraph")) {
      this.parseSubgraph();
      return;
    }

    const idToken = this.readIDToken();
    if (!idToken) throw this.error("expected identifier");

    this.skipWhitespaceAndComments();

    if (idToken.value === "node" || idToken.value === "edge") {
      if (this.peek() === "[") this.parseAttrList();
      return;
    }

    if (this.peek() === "=" && !this.lookingAtArrow()) {
      this.advance();
      this.readIDToken();
      return;
    }

    if (this.lookingAtArrow()) {
      this.parseEdgeStatementAfterFirstID();
      return;
    }

    let attrList = null;
    if (this.peek() === "[") attrList = this.parseAttrList();
    this.nodes.push({ id: idToken.value, idToken, attrList });
  }

  parseSubgraph() {
    this.skipWhitespaceAndComments();
    if (this.peek() !== "{") this.readIDToken();
    this.skipWhitespaceAndComments();
    if (!this.matchChar("{")) throw this.error("expected '{' in subgraph");
    this.parseBody();
    if (!this.matchChar("}")) throw this.error("expected '}' in subgraph");
  }

  parseEdgeStatementAfterFirstID() {
    while (true) {
      this.skipWhitespaceAndComments();
      if (!this.matchArrow()) break;
      this.skipWhitespaceAndComments();
      const idToken = this.readIDToken();
      if (!idToken) throw this.error("expected node id after '->'");
    }

    this.skipWhitespaceAndComments();
    if (this.peek() === "[") this.parseAttrList();
  }

  parseAttrList() {
    const start = this.pos;
    if (!this.matchChar("[")) throw this.error("expected '['");
    const entries = [];

    while (true) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length) throw this.error("unexpected EOF in attr list");
      if (this.peek() === "]") {
        this.advance();
        const end = this.pos;
        return {
          start,
          end,
          entries,
          raw: this.input.slice(start, end),
        };
      }

      const keyToken = this.readIDToken();
      if (!keyToken) throw this.error("expected attribute key");

      this.skipWhitespaceAndComments();
      if (!this.matchChar("=")) throw this.error("expected '=' in attribute");

      this.skipWhitespaceAndComments();
      const valueToken = this.readIDToken();
      if (!valueToken) throw this.error("expected attribute value");

      entries.push({
        key: keyToken.value,
        keyRaw: keyToken.raw,
        keyStart: keyToken.start,
        keyEnd: keyToken.end,
        value: valueToken.value,
        valueRaw: valueToken.raw,
        valueStart: valueToken.start,
        valueEnd: valueToken.end,
      });

      this.skipWhitespaceAndComments();
      if (this.peek() === "," || this.peek() === ";") this.advance();
    }
  }

  readIDToken() {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.input.length) return null;

    const start = this.pos;

    if (this.peek() === '"') {
      const value = this.readQuotedString();
      return { value, start, end: this.pos, raw: this.input.slice(start, this.pos) };
    }

    if (this.peek() === "<") {
      const value = this.readHTMLString();
      return { value, start, end: this.pos, raw: this.input.slice(start, this.pos) };
    }

    while (this.pos < this.input.length && isIDChar(this.input[this.pos])) this.pos += 1;
    if (this.pos === start) return null;
    return {
      value: this.input.slice(start, this.pos),
      start,
      end: this.pos,
      raw: this.input.slice(start, this.pos),
    };
  }

  readQuotedString() {
    this.advance(); // opening quote
    let out = "";

    while (this.pos < this.input.length) {
      const current = this.input[this.pos];

      if (current === "\\" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        switch (next) {
          case '"':
          case "\\":
            out += next;
            this.pos += 2;
            continue;
          case "n":
            out += "\n";
            this.pos += 2;
            continue;
          case "t":
            out += "\t";
            this.pos += 2;
            continue;
          default:
            out += next;
            this.pos += 2;
            continue;
        }
      }

      if (current === '"') {
        this.advance();
        return out;
      }

      out += current;
      this.advance();
    }

    throw this.error("unterminated quoted string");
  }

  readHTMLString() {
    this.advance(); // opening <
    let depth = 1;
    let out = "";

    while (this.pos < this.input.length && depth > 0) {
      const current = this.input[this.pos];
      if (current === "<") depth += 1;
      if (current === ">") {
        depth -= 1;
        if (depth === 0) {
          this.advance();
          return out;
        }
      }
      out += current;
      this.advance();
    }

    throw this.error("unterminated HTML string");
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.input.length) {
      const current = this.input[this.pos];

      if (current === " " || current === "\t" || current === "\n" || current === "\r") {
        this.pos += 1;
        continue;
      }

      if (current === "/" && this.input[this.pos + 1] === "/") {
        this.pos += 2;
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos += 1;
        continue;
      }

      if (current === "/" && this.input[this.pos + 1] === "*") {
        this.pos += 2;
        while (this.pos + 1 < this.input.length) {
          if (this.input[this.pos] === "*" && this.input[this.pos + 1] === "/") {
            this.pos += 2;
            break;
          }
          this.pos += 1;
        }
        continue;
      }

      if (current === "#") {
        this.pos += 1;
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos += 1;
        continue;
      }

      break;
    }
  }

  matchArrow() {
    if (!this.lookingAtArrow()) return false;
    this.pos += 2;
    return true;
  }

  lookingAtArrow() {
    return this.input[this.pos] === "-" && this.input[this.pos + 1] === ">";
  }

  matchKeyword(keyword) {
    const lower = String(keyword || "").toLowerCase();
    const fragment = this.input.slice(this.pos, this.pos + lower.length).toLowerCase();
    if (fragment !== lower) return false;
    const end = this.pos + lower.length;
    if (end < this.input.length && isIDChar(this.input[end])) return false;
    this.pos = end;
    return true;
  }

  matchChar(char) {
    if (this.input[this.pos] !== char) return false;
    this.pos += 1;
    return true;
  }

  peek() {
    return this.input[this.pos] || "\0";
  }

  advance() {
    if (this.pos < this.input.length) this.pos += 1;
  }

  error(message) {
    let line = 1;
    let col = 1;
    for (let i = 0; i < this.pos; i += 1) {
      if (this.input[i] === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
    }
    const prefix = this.sourcePath ? `${this.sourcePath}:` : "";
    return new Error(`${prefix}${line}:${col} ${message}`);
  }
}

function isIDChar(char) {
  return /[a-zA-Z0-9_.]/.test(char);
}
