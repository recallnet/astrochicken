import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJson, trim } from "./cli-helpers.ts";
import {
  buildFactoryRepoRoleContext,
  normalizeDestinationRepos,
  normalizeRepoSlug,
} from "./factory-repo-roles.ts";
import { resolvePhysicalPath } from "./filesystem-path.ts";

const DEFAULT_CONTRACT_URL: URL = new URL("../../../docs/contracts/managed-factory-mutation-policy.json", import.meta.url);

export const MANAGED_FACTORY_MUTATION_POLICY_CONTRACT_PATH: string = fileURLToPath(DEFAULT_CONTRACT_URL);

const SUPPORTED_SCHEMAS: Set<string> = new Set(["managed_factory_mutation_policy/v1"]);
const REQUIRED_BOUNDARIES: string[] = ["target_repo", "destination_repo", "control_plane_repo", "local_filesystem"];

let cachedContract: Record<string, unknown> | null = null;
let cachedContractPath: string = "";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function toCamelCase(value: string = ""): string {
  return String(value || "").replace(/_([a-z])/g, (_match: string, group: string) => String(group || "").toUpperCase());
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized: string = trim(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry: unknown) => trim(entry).toLowerCase()).filter(Boolean)));
}

function isPathLike(value: string = ""): boolean {
  const targetPath: string = trim(value);
  if (!targetPath) return false;
  if (targetPath.startsWith("~")) return true;
  if (targetPath.startsWith(".")) return true;
  if (targetPath.includes(path.sep)) return true;
  return path.isAbsolute(targetPath);
}

function resolvePathWithHome(rawPath: string = "", { homeDirectory = homedir() }: { homeDirectory?: string } = {}): string {
  const value: string = trim(rawPath);
  if (!value) return "";
  if (value === "~") return homeDirectory;
  if (value.startsWith("~/")) return path.join(homeDirectory, value.slice(2));
  return value;
}

function isWithinPath(candidatePath: string = "", parentPath: string = ""): boolean {
  const candidate: string = trim(candidatePath);
  const parent: string = trim(parentPath);
  if (!candidate || !parent) return false;
  if (candidate === parent) return true;
  return candidate.startsWith(`${parent}${path.sep}`);
}

export function isLocalFilesystemPath(targetPath: string = "", { instanceId = "", cwd = process.cwd(), homeDirectory = homedir(), approvedWorktreeRoots = [] as string[] }: { instanceId?: string; cwd?: string; homeDirectory?: string; approvedWorktreeRoots?: string[] } = {}): boolean {
  const normalizedInstanceId: string = trim(instanceId);
  const resolvedTarget: string = resolvePathWithHome(targetPath, { homeDirectory });
  if (!normalizedInstanceId || !resolvedTarget) return false;

  try {
    const absoluteTarget = resolvePhysicalPath(resolvedTarget, { baseDir: cwd });
    const allowedRepoScopedRoot = resolvePhysicalPath(`.hatch${path.sep}${normalizedInstanceId}`, { baseDir: cwd });
    const allowedHostScopedRoot = resolvePhysicalPath(`${homeDirectory}${path.sep}.hatch-hosts${path.sep}installations${path.sep}${normalizedInstanceId}`, { baseDir: cwd });

    if (isWithinPath(absoluteTarget, allowedRepoScopedRoot)
      || isWithinPath(absoluteTarget, allowedHostScopedRoot)) return true;

    // Disposable worktree roots may be outside .hatch/<instanceId> but must
    // contain the physical target, not merely its symlink spelling.
    const roots: string[] = Array.isArray(approvedWorktreeRoots) ? approvedWorktreeRoots : [];
    return roots.some((root: string) => isWithinPath(absoluteTarget, resolvePhysicalPath(root, { baseDir: cwd })));
  } catch {
    return false;
  }
}

export function isTargetRepo(targetRepo: string = "", context: Record<string, unknown> = {}): boolean {
  const normalizedTarget: string = normalizeRepoSlug(targetRepo);
  const normalizedContextTarget: string = normalizeRepoSlug(String(context.targetRepo || context.target_repo || ""));
  return Boolean(normalizedTarget && normalizedContextTarget && normalizedTarget === normalizedContextTarget);
}

export function isDestination(targetRepo: string = "", context: Record<string, unknown> = {}): boolean {
  const normalizedTarget: string = normalizeRepoSlug(targetRepo);
  const destinations: string[] = normalizeDestinationRepos(
    (context.destinationRepos as unknown)
      || (context.destination_repos as unknown)
      || (context.destinations as unknown)
      || [],
  );
  return Boolean(normalizedTarget && destinations.includes(normalizedTarget));
}

export function isControlPlane(targetRepo: string = "", context: Record<string, unknown> = {}): boolean {
  const normalizedTarget: string = normalizeRepoSlug(targetRepo);
  const normalizedControlPlane: string = normalizeRepoSlug(String(context.controlPlaneRepo || context.control_plane_repo || ""));
  return Boolean(normalizedTarget && normalizedControlPlane && normalizedTarget === normalizedControlPlane);
}

function validateContractShape(contract: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(contract)) {
    throw new Error("Invalid managed-factory mutation policy contract: expected top-level object");
  }

  const schemaVersion: string = trim(contract.schema_version || contract.schema || "");
  if (!SUPPORTED_SCHEMAS.has(schemaVersion)) {
    throw new Error(`Unsupported managed-factory mutation policy schema: ${schemaVersion || "(empty)"}`);
  }

  if (!isObject(contract.metadata)) {
    throw new Error("Invalid managed-factory mutation policy contract: missing metadata");
  }

  const metadata = contract.metadata as Record<string, unknown>;
  if (!Array.isArray(metadata.required_context_keys) || metadata.required_context_keys.length === 0) {
    throw new Error("Invalid managed-factory mutation policy contract: missing metadata.required_context_keys");
  }

  if (!isObject(contract.boundaries)) {
    throw new Error("Invalid managed-factory mutation policy contract: missing boundaries");
  }

  const boundaries = contract.boundaries as Record<string, unknown>;
  for (const boundary of REQUIRED_BOUNDARIES) {
    const rule = boundaries[boundary] as Record<string, unknown> | undefined;
    if (!isObject(rule)) {
      throw new Error(`Invalid managed-factory mutation policy contract: missing boundary ${boundary}`);
    }
    if (!Array.isArray(rule.allowed_operations)) {
      throw new Error(`Invalid managed-factory mutation policy contract: boundary ${boundary} missing allowed_operations`);
    }
    if (!Array.isArray(rule.forbidden_operations)) {
      throw new Error(`Invalid managed-factory mutation policy contract: boundary ${boundary} missing forbidden_operations`);
    }
  }

  return contract;
}

export function loadManagedFactoryMutationPolicyContract({
  contractPath = MANAGED_FACTORY_MUTATION_POLICY_CONTRACT_PATH,
  forceReload = false,
}: {
  contractPath?: string;
  forceReload?: boolean;
} = {}): Record<string, unknown> {
  const resolvedPath: string = trim(contractPath) || MANAGED_FACTORY_MUTATION_POLICY_CONTRACT_PATH;
  if (!forceReload && cachedContract && cachedContractPath === resolvedPath) {
    return cachedContract;
  }

  const raw: string = readFileSync(resolvedPath, "utf8");
  const parsed: unknown = parseJson(raw, null);
  if (!parsed) {
    throw new Error("Invalid managed-factory mutation policy contract JSON");
  }

  const validated: Record<string, unknown> = validateContractShape(parsed as Record<string, unknown>);
  cachedContract = validated;
  cachedContractPath = resolvedPath;
  return validated;
}

function resolveFlag(context: Record<string, unknown>, flagName: string = ""): boolean {
  const normalizedFlag: string = trim(flagName);
  if (!normalizedFlag) return false;
  const camelFlag: string = toCamelCase(normalizedFlag);
  const flags: Record<string, unknown> = isObject(context.flags) ? context.flags : {};

  if (hasOwn(flags, normalizedFlag)) return normalizeBoolean(flags[normalizedFlag]);
  if (hasOwn(flags, camelFlag)) return normalizeBoolean(flags[camelFlag]);
  const raw = context.raw as Record<string, unknown> | undefined;
  if (hasOwn(raw, normalizedFlag)) return normalizeBoolean((raw as Record<string, unknown>)[normalizedFlag]);
  if (hasOwn(raw, camelFlag)) return normalizeBoolean((raw as Record<string, unknown>)[camelFlag]);
  return false;
}

function resolveConstraintMatch(constraints: Record<string, unknown> = {}, context: Record<string, unknown> = {}): boolean {
  if (!isObject(constraints) || Object.keys(constraints).length === 0) {
    return true;
  }

  for (const [key, rawValue] of Object.entries(constraints)) {
    if (key === "target_branch") {
      if (trim(context.targetBranch) !== trim(rawValue)) return false;
      continue;
    }

    if (key === "requires_flag") {
      if (!resolveFlag(context, String(rawValue || ""))) return false;
      continue;
    }

    if (key === "requires_flag_absent") {
      if (resolveFlag(context, String(rawValue || ""))) return false;
      continue;
    }

    if (key === "path_scope") {
      const pathOpts = { instanceId: context.instanceId as string, approvedWorktreeRoots: context.approvedWorktreeRoots as string[] };
      if (rawValue === "factory_scoped_paths_only") {
        if (!isLocalFilesystemPath(context.targetPath as string, pathOpts)) return false;
        continue;
      }
      if (rawValue === "outside_factory_scoped_paths") {
        if (isLocalFilesystemPath(context.targetPath as string, pathOpts)) return false;
        continue;
      }
      return false;
    }

    if (key === "labels_scope") {
      if (rawValue !== "declared_destination_only") return false;
      const issueLabels = (context.issueLabels || []) as string[];
      const declaredLabels = (context.declaredDestinationLabels || []) as string[];
      if (!issueLabels.length) continue;
      if (!declaredLabels.length) return false;
      if (!issueLabels.every((label: string) => declaredLabels.includes(label))) return false;
      continue;
    }

    if (key === "require_owned_incident") {
      if (!normalizeBoolean(rawValue)) continue;
      const owner: string = trim(context.incidentOwnerInstanceId);
      if (!owner || owner !== trim(context.instanceId)) return false;
      continue;
    }

    return false;
  }

  return true;
}

function operationMatches(pattern: string = "", operation: string = ""): boolean {
  const normalizedPattern: string = trim(pattern);
  const normalizedOperation: string = trim(operation);
  if (!normalizedPattern || !normalizedOperation) return false;
  if (normalizedPattern === normalizedOperation) return true;
  if (normalizedPattern.endsWith("*")) {
    const prefix: string = normalizedPattern.slice(0, -1);
    return normalizedOperation.startsWith(prefix);
  }
  return false;
}

function classifyOperation(operation: string = ""): string {
  const normalizedOperation: string = trim(operation);
  if (!normalizedOperation) return "unknown";
  if (normalizedOperation.endsWith(":read")) return "read_only";
  if (normalizedOperation.startsWith("read:")) return "read_only";
  if (normalizedOperation === "status" || normalizedOperation === "fetch") return "read_only";
  if (normalizedOperation.startsWith("git:read")) return "read_only";
  return "mutating";
}

function normalizeMutationContext(mutationContext: Record<string, unknown> = {}): Record<string, unknown> {
  const raw: Record<string, unknown> = isObject(mutationContext) ? mutationContext : {};

  const keyPresence: Record<string, boolean> = {
    target_repo: hasOwn(raw, "target_repo") || hasOwn(raw, "targetRepo"),
    destinations: hasOwn(raw, "destinations") || hasOwn(raw, "destination_repos") || hasOwn(raw, "destinationRepos"),
    control_plane_repo: hasOwn(raw, "control_plane_repo") || hasOwn(raw, "controlPlaneRepo"),
    instance_id: hasOwn(raw, "instance_id") || hasOwn(raw, "instanceId"),
  };

  const rawTargetRepo: string = String(raw.target_repo ?? raw.targetRepo ?? "");
  const rawControlPlaneRepo: string = String(raw.control_plane_repo ?? raw.controlPlaneRepo ?? "");
  const rawDestinations: unknown = raw.destinations ?? {};
  const rawDestinationRepos: unknown = raw.destination_repos ?? raw.destinationRepos ?? [];

  const roleContext = buildFactoryRepoRoleContext({
    targetRepo: rawTargetRepo,
    controlPlaneRepo: rawControlPlaneRepo,
    destinations: rawDestinations,
  });

  const destinationRepos: string[] = normalizeDestinationRepos([
    ...(roleContext.destinationRepos || []),
    ...(Array.isArray(rawDestinationRepos) ? rawDestinationRepos : []),
  ]);

  return {
    raw,
    keyPresence,
    // @context:security !critical Factory identity and the requested mutation repo
    // must remain separate, or every repo compares equal to its own allowlist.
    factoryTargetRepo: roleContext.targetRepo,
    targetRepo: normalizeRepoSlug(String(raw.repo_slug ?? raw.repoSlug ?? raw.target_repo ?? raw.targetRepo ?? "")),
    controlPlaneRepo: roleContext.controlPlaneRepo || normalizeRepoSlug(rawControlPlaneRepo),
    destinationRepos,
    instanceId: trim(raw.instance_id ?? raw.instanceId ?? ""),
    kindId: trim(raw.kind_id ?? raw.kindId ?? ""),
    hostId: trim(raw.host_id ?? raw.hostId ?? ""),
    operation: trim(raw.operation || ""),
    targetPath: trim(raw.target_path ?? raw.targetPath ?? ""),
    targetBranch: trim(raw.target_branch ?? raw.targetBranch ?? ""),
    flags: isObject(raw.flags) ? { ...raw.flags } : {},
    issueLabels: parseLabels(raw.issue_labels ?? raw.issueLabels ?? []),
    declaredDestinationLabels: parseLabels(raw.declared_destination_labels ?? raw.declaredDestinationLabels ?? []),
    incidentOwnerInstanceId: trim(raw.incident_owner_instance_id ?? raw.incidentOwnerInstanceId ?? ""),
    approvedWorktreeRoots: Array.isArray(raw.approvedWorktreeRoots) ? raw.approvedWorktreeRoots : [],
  };
}

function resolveBoundary(context: Record<string, unknown> = {}): string {

  const operation: string = trim(context.operation);
  if (operation.startsWith("fs:")) return "local_filesystem";
  if (!context.targetRepo && isPathLike(context.targetPath as string)) return "local_filesystem";
  if (isTargetRepo(context.targetRepo as string, { targetRepo: context.factoryTargetRepo })) return "target_repo";
  if (isControlPlane(context.targetRepo as string, context)) return "control_plane_repo";
  if (isDestination(context.targetRepo as string, context)) return "destination_repo";
  return "unknown";
}

function deny(reason: string = "mutation_policy_denied", context: Record<string, unknown> = {}, { boundary = "unknown" }: { boundary?: string } = {}): Record<string, unknown> {
  const deniedReason: string = trim(reason) || "mutation_policy_denied";
  return {
    allowed: false,
    reason: deniedReason,
    denied_reason: deniedReason,
    boundary,
    normalized_context: {
      target_repo: context.targetRepo || "",
      destinations: context.destinationRepos || [],
      control_plane_repo: context.controlPlaneRepo || "",
      instance_id: context.instanceId || "",
      kind_id: context.kindId || "",
      host_id: context.hostId || "",
      operation: context.operation || "",
      target_path: context.targetPath || "",
      target_branch: context.targetBranch || "",
    },
  };
}

function allow(reason: string = "mutation_policy_allowed", context: Record<string, unknown> = {}, { boundary = "" }: { boundary?: string } = {}): Record<string, unknown> {
  return {
    allowed: true,
    reason: trim(reason) || "mutation_policy_allowed",
    boundary,
    normalized_context: {
      target_repo: context.targetRepo || "",
      destinations: context.destinationRepos || [],
      control_plane_repo: context.controlPlaneRepo || "",
      instance_id: context.instanceId || "",
      kind_id: context.kindId || "",
      host_id: context.hostId || "",
      operation: context.operation || "",
      target_path: context.targetPath || "",
      target_branch: context.targetBranch || "",
    },
  };
}

function evaluateBoundary(boundaryRule: Record<string, unknown>, context: Record<string, unknown>, { boundary = "" }: { boundary?: string } = {}): Record<string, unknown> {
  const forbiddenOps = (boundaryRule.forbidden_operations || []) as Record<string, unknown>[];
  for (const forbidden of forbiddenOps) {
    if (!isObject(forbidden)) continue;
    if (!operationMatches(forbidden.operation as string, context.operation as string)) continue;
    if (!resolveConstraintMatch((forbidden.constraints || {}) as Record<string, unknown>, context)) continue;
    return deny(String(forbidden.reason || boundaryRule.default_denied_reason || "mutation_policy_denied"), context, { boundary });
  }

  const allowedOps = (boundaryRule.allowed_operations || []) as Record<string, unknown>[];
  for (const allowedEntry of allowedOps) {
    if (!isObject(allowedEntry)) continue;
    if (!operationMatches(allowedEntry.operation as string, context.operation as string)) continue;
    if (!resolveConstraintMatch((allowedEntry.constraints || {}) as Record<string, unknown>, context)) continue;
    return allow(`mutation_policy_allowed:${boundary}:${context.operation}`, context, { boundary });
  }

  return deny(String(boundaryRule.default_denied_reason || "mutation_policy_denied"), context, { boundary });
}

export function evaluateManagedFactoryMutationPolicy({
  mutationContext = {},
  contract = null,
  contractPath = MANAGED_FACTORY_MUTATION_POLICY_CONTRACT_PATH,
}: {
  mutationContext?: Record<string, unknown>;
  contract?: Record<string, unknown> | null;
  contractPath?: string;
} = {}): Record<string, unknown> {
  const resolvedContract: Record<string, unknown> = contract || loadManagedFactoryMutationPolicyContract({ contractPath });

  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeMutationContext(mutationContext);
  } catch (error: unknown) {
    return deny(`mutation_policy_context_normalization_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  const metadata = resolvedContract?.metadata as Record<string, unknown> | undefined;
  const requiredContextKeys: string[] = Array.isArray(metadata?.required_context_keys)
    ? metadata!.required_context_keys as string[]
    : [];

  const keyPresence = normalized.keyPresence as Record<string, boolean>;
  const missingContextKeys: string[] = requiredContextKeys.filter((key: string) => !keyPresence[key]);
  if (missingContextKeys.length > 0) {
    return deny(`mutation_policy_missing_required_context:${missingContextKeys.join(",")}`, normalized);
  }

  if (!normalized.targetRepo) {
    return deny("mutation_policy_unresolved_target_repo", normalized);
  }
  if (!normalized.controlPlaneRepo) {
    return deny("mutation_policy_unresolved_control_plane_repo", normalized);
  }
  if (!normalized.instanceId) {
    return deny("mutation_policy_unresolved_instance_id", normalized);
  }
  if (!trim(normalized.operation)) {
    return deny("mutation_policy_missing_operation", normalized);
  }

  if (classifyOperation(normalized.operation as string) === "read_only") {
    return allow("mutation_policy_read_only_operation_allowed", normalized);
  }

  const boundary: string = resolveBoundary(normalized);
  if (boundary === "unknown") {
    return deny("mutation_policy_unknown_boundary", normalized, { boundary });
  }

  const boundaries = resolvedContract?.boundaries as Record<string, unknown> | undefined;
  const boundaryRule: unknown = boundaries?.[boundary];
  if (!isObject(boundaryRule)) {
    return deny(`mutation_policy_boundary_not_defined:${boundary}`, normalized, { boundary });
  }

  return evaluateBoundary(boundaryRule, normalized, { boundary });
}
