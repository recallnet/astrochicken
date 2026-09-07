import { classifyManagedWorktreePath, isCanonicalCheckout, resolveApprovedDisposableWorktreeRoots } from "./canonical-worktree.ts";
import { parseJson, trim } from "./cli-helpers.ts";
import {
  buildFactoryRepoRoleContext,
  normalizeDestinationRepos,
  normalizeRepoSlug,
} from "./factory-repo-roles.ts";
import { evaluateManagedFactoryMutationPolicy } from "./mutation-policy-contract.ts";

const READ_ONLY_CANONICAL_OPERATIONS: Set<string> = new Set(["status", "fetch"]);
const MAIN_SAFE_CANONICAL_OPERATIONS: Set<string> = new Set([
  "pull_ff_only_main",
  "fast_forward_main_only",
  "push_main_verified",
  "checkout_main_only",
  "merge_abort_main_only",
  "rebase_abort_main_only",
]);

const READ_ONLY_OPERATIONS: Set<string> = new Set([
  "",
  "status",
  "fetch",
  "rev_parse",
  "show_ref",
  "log",
  "diff",
]);

/**
 * Expected managed-factory mutation context contract (snake_case preferred):
 * {
 *   target_repo: string,
 *   destinations: Record<string, { repo: string, labels?: string[] }>,
 *   control_plane_repo: string,
 *   instance_id: string,
 *   ...optional metadata
 * }
 *
 * guardGitMutation() and guardDisposableCleanup() accept camelCase aliases for
 * backward compatibility, but fail closed when required identity keys cannot be
 * resolved.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function resolveMutationContextFromEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Record<string, unknown> | null {
  const raw: string = trim(env?.HATCH_FACTORY_MUTATION_CONTEXT_JSON || "");
  if (!raw) return null;
  const parsed: unknown = parseJson(raw, null);
  return isObject(parsed) ? parsed : null;
}

function resolveEffectiveMutationContext(mutationContext: Record<string, unknown> | null = null): Record<string, unknown> | null {
  if (mutationContext != null) return mutationContext;
  return resolveMutationContextFromEnv(process.env as Record<string, string | undefined>);
}

function mutationContextHasIdentity(mutationContext: unknown = null): boolean {
  if (!isObject(mutationContext)) return false;
  const targetRepoPresent: boolean = hasOwn(mutationContext, "target_repo") || hasOwn(mutationContext, "targetRepo");
  const destinationsPresent: boolean = hasOwn(mutationContext, "destinations")
    || hasOwn(mutationContext, "destination_repos")
    || hasOwn(mutationContext, "destinationRepos");
  const controlPlanePresent: boolean = hasOwn(mutationContext, "control_plane_repo") || hasOwn(mutationContext, "controlPlaneRepo");
  const instancePresent: boolean = hasOwn(mutationContext, "instance_id") || hasOwn(mutationContext, "instanceId");
  return targetRepoPresent && destinationsPresent && controlPlanePresent && instancePresent;
}

function isMainBranch(branch: string = ""): boolean {
  return trim(branch) === "main";
}

function isMainSafeCanonicalOperationAllowed({ operation = "", currentBranch = "", targetBranch = "" }: { operation?: string; currentBranch?: string; targetBranch?: string } = {}): boolean {
  const op: string = trim(operation);
  if (!MAIN_SAFE_CANONICAL_OPERATIONS.has(op)) return false;
  const branch: string = trim(currentBranch) || trim(targetBranch);
  const checkoutMainAllowed: boolean = op === "checkout_main_only" && isMainBranch(branch) && trim(targetBranch) === "main";
  const otherMainSafeAllowed: boolean = op !== "checkout_main_only" && isMainBranch(branch);
  return checkoutMainAllowed || otherMainSafeAllowed;
}

function classifyOperationMutation(operation: string = ""): string {
  const op: string = trim(operation);
  if (READ_ONLY_OPERATIONS.has(op)) return "read_only";
  if (op.startsWith("read_") || op.startsWith("query_")) return "read_only";
  return "mutating";
}

function resolveEffectiveRepoRole({
  repoSlug = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationRepos = [],
}: {
  repoSlug?: string;
  targetRepo?: string;
  controlPlaneRepo?: string;
  destinationRepos?: string[];
} = {}): { role: string; role_reason: string } {
  const normalizedRepoSlug: string = normalizeRepoSlug(repoSlug);
  const normalizedTargetRepo: string = normalizeRepoSlug(targetRepo);
  const normalizedControlPlaneRepo: string = normalizeRepoSlug(controlPlaneRepo);
  const normalizedDestinationRepos: string[] = normalizeDestinationRepos(destinationRepos);

  if (!normalizedRepoSlug) {
    return { role: "unknown", role_reason: "repo_role_unresolved_slug" };
  }
  if (normalizedTargetRepo && normalizedRepoSlug === normalizedTargetRepo) {
    return { role: "home", role_reason: "repo_role_home" };
  }
  if (normalizedControlPlaneRepo && normalizedRepoSlug === normalizedControlPlaneRepo) {
    return { role: "control_plane", role_reason: "repo_role_control_plane" };
  }
  if (normalizedDestinationRepos.includes(normalizedRepoSlug)) {
    return { role: "destination", role_reason: "repo_role_destination" };
  }
  return { role: "unknown", role_reason: "repo_role_undeclared_destination_repo" };
}

function evaluateRepoRoleMutationPolicy({
  operation = "",
  currentBranch = "",
  targetBranch = "",
  repoSlug = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationRepos = [],
  enforceRepoRoles = false,
  allowControlPlaneMainSafeFlow = false,
}: {
  operation?: string;
  currentBranch?: string;
  targetBranch?: string;
  repoSlug?: string;
  targetRepo?: string;
  controlPlaneRepo?: string;
  destinationRepos?: string[];
  enforceRepoRoles?: boolean;
  allowControlPlaneMainSafeFlow?: boolean;
} = {}): { ok: boolean; blocked: boolean; reason: string } {
  if (!enforceRepoRoles) {
    return { ok: true, blocked: false, reason: "" };
  }

  const operationClass: string = classifyOperationMutation(operation);
  if (operationClass === "read_only") {
    return { ok: true, blocked: false, reason: "" };
  }

  const role = resolveEffectiveRepoRole({
    repoSlug,
    targetRepo,
    controlPlaneRepo,
    destinationRepos,
  });

  if (role.role === "home") {
    return { ok: true, blocked: false, reason: "" };
  }

  if (role.role === "destination") {
    return {
      ok: false,
      blocked: true,
      reason: "repo_role_destination_mutation_blocked",
    };
  }

  if (role.role === "control_plane") {
    if (allowControlPlaneMainSafeFlow && isMainSafeCanonicalOperationAllowed({ operation, currentBranch, targetBranch })) {
      return { ok: true, blocked: false, reason: "" };
    }
    return {
      ok: false,
      blocked: true,
      reason: "repo_role_control_plane_mutation_blocked",
    };
  }

  if (role.role_reason === "repo_role_unresolved_slug") {
    return {
      ok: false,
      blocked: true,
      reason: "repo_role_unresolved_slug",
    };
  }

  return {
    ok: false,
    blocked: true,
    reason: "repo_role_undeclared_destination_repo",
  };
}

function mapGuardOperationToPolicyOperation(operation: string = ""): string {
  const op: string = trim(operation);
  if (!op) return "";
  if (op.includes(":")) return op;

  const explicit: Record<string, string> = {
    pull_ff_only_main: "git:pull",
    fast_forward_main_only: "git:fast-forward-main",
    push_main_verified: "git:push",
    checkout_main_only: "git:checkout",
    merge_abort_main_only: "git:merge-abort",
    rebase_abort_main_only: "git:rebase-abort",
    merge_branch: "git:merge",
    rebase_branch: "git:rebase",
    reset_hard: "git:reset-hard",
    status: "status",
    fetch: "fetch",
  };
  if (explicit[op]) return explicit[op];
  return `git:${op.replace(/_/g, "-")}`;
}

function buildPolicyMutationContext({
  mutationContext = {},
  operation = "",
  targetPath = "",
  targetBranch = "",
  repoSlug = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationRepos = [],
}: {
  mutationContext?: Record<string, unknown>;
  operation?: string;
  targetPath?: string;
  targetBranch?: string;
  repoSlug?: string;
  targetRepo?: string;
  controlPlaneRepo?: string;
  destinationRepos?: string[];
} = {}): Record<string, unknown> {
  const raw: Record<string, unknown> = isObject(mutationContext) ? mutationContext : {};
  const flags: Record<string, unknown> = isObject(raw.flags) ? { ...raw.flags } : {};

  return {
    ...raw,
    target_repo: raw.target_repo ?? raw.targetRepo ?? raw.repo_slug ?? raw.repoSlug ?? repoSlug,
    destinations: raw.destinations ?? {},
    destination_repos: raw.destination_repos ?? raw.destinationRepos ?? destinationRepos,
    control_plane_repo: raw.control_plane_repo ?? raw.controlPlaneRepo ?? controlPlaneRepo,
    instance_id: raw.instance_id ?? raw.instanceId ?? trim(process.env.HATCH_FACTORY_INSTANCE_ID || ""),
    kind_id: raw.kind_id ?? raw.kindId ?? "",
    host_id: raw.host_id ?? raw.hostId ?? "",
    operation: raw.operation ?? mapGuardOperationToPolicyOperation(operation),
    target_path: raw.target_path ?? raw.targetPath ?? targetPath,
    target_branch: raw.target_branch ?? raw.targetBranch ?? targetBranch,
    approvedWorktreeRoots: raw.approvedWorktreeRoots ?? resolveApprovedDisposableWorktreeRoots({ repoPath: process.cwd() }),
    flags,
  };
}

export function failClosedForUnknownContext({ mutationContext = null }: { mutationContext?: unknown } = {}): Record<string, unknown> {
  if (!isObject(mutationContext)) {
    return {
      ok: false,
      blocked: true,
      reason: "mutation_context_missing",
    };
  }

  const targetRepoPresent: boolean = hasOwn(mutationContext, "target_repo") || hasOwn(mutationContext, "targetRepo");
  const destinationsPresent: boolean = hasOwn(mutationContext, "destinations")
    || hasOwn(mutationContext, "destination_repos")
    || hasOwn(mutationContext, "destinationRepos");
  const controlPlanePresent: boolean = hasOwn(mutationContext, "control_plane_repo") || hasOwn(mutationContext, "controlPlaneRepo");
  const instancePresent: boolean = hasOwn(mutationContext, "instance_id") || hasOwn(mutationContext, "instanceId");

  if (!targetRepoPresent) {
    return { ok: false, blocked: true, reason: "mutation_context_missing_required_identity:target_repo" };
  }
  if (!destinationsPresent) {
    return { ok: false, blocked: true, reason: "mutation_context_missing_required_identity:destinations" };
  }
  if (!controlPlanePresent) {
    return { ok: false, blocked: true, reason: "mutation_context_missing_required_identity:control_plane_repo" };
  }
  if (!instancePresent) {
    return { ok: false, blocked: true, reason: "mutation_context_missing_required_identity:instance_id" };
  }

  let roleContext: { targetRepo: string; controlPlaneRepo: string; destinationRepos: string[] };
  try {
    roleContext = buildFactoryRepoRoleContext({
      targetRepo: String(mutationContext.target_repo ?? mutationContext.targetRepo ?? ""),
      controlPlaneRepo: String(mutationContext.control_plane_repo ?? mutationContext.controlPlaneRepo ?? ""),
      destinations: mutationContext.destinations ?? {},
    });
  } catch (error: unknown) {
    return {
      ok: false,
      blocked: true,
      reason: `mutation_context_invalid_destinations:${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const mergedDestinations: string[] = normalizeDestinationRepos([
    ...(roleContext.destinationRepos || []),
    ...(Array.isArray(mutationContext.destination_repos) ? mutationContext.destination_repos : []),
    ...(Array.isArray(mutationContext.destinationRepos) ? mutationContext.destinationRepos : []),
  ]);

  const normalizedTargetRepo: string = normalizeRepoSlug(roleContext.targetRepo || String(mutationContext.target_repo ?? mutationContext.targetRepo ?? ""));
  const normalizedControlPlaneRepo: string = normalizeRepoSlug(
    roleContext.controlPlaneRepo || String(mutationContext.control_plane_repo ?? mutationContext.controlPlaneRepo ?? ""),
  );
  const normalizedInstanceId: string = trim(mutationContext.instance_id ?? mutationContext.instanceId ?? "");

  if (!normalizedTargetRepo) {
    return { ok: false, blocked: true, reason: "mutation_context_unresolved_identity:target_repo" };
  }
  if (!normalizedControlPlaneRepo) {
    return { ok: false, blocked: true, reason: "mutation_context_unresolved_identity:control_plane_repo" };
  }
  if (!normalizedInstanceId) {
    return { ok: false, blocked: true, reason: "mutation_context_unresolved_identity:instance_id" };
  }

  return {
    ok: true,
    blocked: false,
    reason: "",
    normalized_context: {
      target_repo: normalizedTargetRepo,
      control_plane_repo: normalizedControlPlaneRepo,
      destination_repos: mergedDestinations,
      instance_id: normalizedInstanceId,
    },
  };
}

export function guardGitMutation({
  operation = "",
  repoPath = "",
  targetPath = "",
  canonicalCheckoutPath = "",
  currentBranch = "",
  targetBranch = "",
  targetRepo = "",
  controlPlaneRepo = "",
  destinationRepos = [],
  repoSlug = "",
  enforceRepoRoles = false,
  allowControlPlaneMainSafeFlow = false,
  mutationContext = null,
}: {
  operation?: string;
  repoPath?: string;
  targetPath?: string;
  canonicalCheckoutPath?: string;
  currentBranch?: string;
  targetBranch?: string;
  targetRepo?: string;
  controlPlaneRepo?: string;
  destinationRepos?: string[];
  repoSlug?: string;
  enforceRepoRoles?: boolean;
  allowControlPlaneMainSafeFlow?: boolean;
  mutationContext?: Record<string, unknown> | null;
} = {}): Record<string, unknown> {
  const op: string = trim(operation);
  const repoIsCanonical: boolean = isCanonicalCheckout(repoPath, { canonicalCheckoutPath });
  const targetIsCanonical: boolean = isCanonicalCheckout(targetPath, { canonicalCheckoutPath });
  if (repoIsCanonical || targetIsCanonical) {
    if (READ_ONLY_CANONICAL_OPERATIONS.has(op)) {
      // canonical read-only operations remain allowed
    } else if (isMainSafeCanonicalOperationAllowed({ operation: op, currentBranch, targetBranch })) {
      // canonical main-safe operations remain allowed
    } else {
      return {
        ok: false,
        blocked: true,
        reason: `canonical_checkout_${op || "mutation"}_blocked`,
      };
    }
  }

  const effectiveMutationContext: Record<string, unknown> | null = resolveEffectiveMutationContext(mutationContext);
  if (effectiveMutationContext != null) {
    const contextGuard: Record<string, unknown> = failClosedForUnknownContext({ mutationContext: effectiveMutationContext });
    if (!contextGuard.ok) return contextGuard;

    const policyContext: Record<string, unknown> = buildPolicyMutationContext({
      mutationContext: effectiveMutationContext,
      operation: op,
      targetPath,
      targetBranch,
      repoSlug,
      targetRepo,
      controlPlaneRepo,
      destinationRepos,
    });

    const policyDecision: Record<string, unknown> = evaluateManagedFactoryMutationPolicy({
      mutationContext: policyContext,
    });

    if (!policyDecision.allowed) {
      return {
        ok: false,
        blocked: true,
        reason: trim(policyDecision.denied_reason || policyDecision.reason || "mutation_policy_denied"),
        policy_decision: policyDecision,
      };
    }

    return {
      ok: true,
      blocked: false,
      reason: "",
      policy_decision: policyDecision,
    };
  }

  return evaluateRepoRoleMutationPolicy({
    operation: op,
    currentBranch,
    targetBranch,
    repoSlug,
    targetRepo,
    controlPlaneRepo,
    destinationRepos,
    enforceRepoRoles,
    allowControlPlaneMainSafeFlow: Boolean(allowControlPlaneMainSafeFlow && (repoIsCanonical || targetIsCanonical)),
  });
}

export function guardDisposableCleanup({
  worktreePath = "",
  repoPath = "",
  canonicalCheckoutPath = "",
  operation = "cleanup_worktree",
  mutationContext = null,
  enforceMutationContext = false,
}: {
  worktreePath?: string;
  repoPath?: string;
  canonicalCheckoutPath?: string;
  operation?: string;
  mutationContext?: Record<string, unknown> | null;
  enforceMutationContext?: boolean;
} = {}): Record<string, unknown> {
  const classification = classifyManagedWorktreePath({
    candidatePath: worktreePath,
    repoPath,
    canonicalCheckoutPath,
  });

  const effectiveMutationContext: Record<string, unknown> | null = resolveEffectiveMutationContext(mutationContext);
  if (enforceMutationContext && (effectiveMutationContext != null || mutationContextHasIdentity(mutationContext))) {
    const policyContext: Record<string, unknown> = buildPolicyMutationContext({
      mutationContext: effectiveMutationContext as Record<string, unknown>,
      operation: `fs:${trim(operation) || "cleanup_worktree"}`,
      targetPath: worktreePath,
      repoSlug: "",
      targetRepo: "",
      controlPlaneRepo: "",
      destinationRepos: [],
    });

    const policyDecision: Record<string, unknown> = evaluateManagedFactoryMutationPolicy({
      mutationContext: policyContext,
    });

    if (!policyDecision.allowed) {
      return {
        ok: false,
        blocked: true,
        reason: trim(policyDecision.denied_reason || policyDecision.reason || "mutation_policy_denied"),
        classification,
        policy_decision: policyDecision,
      };
    }
  }

  if (classification.canonical) {
    return {
      ok: false,
      blocked: true,
      reason: `canonical_checkout_${trim(operation) || "cleanup_worktree"}_blocked`,
      classification,
    };
  }
  if (classification.repoRoot) {
    return {
      ok: false,
      blocked: true,
      reason: `repo_root_${trim(operation) || "cleanup_worktree"}_blocked`,
      classification,
    };
  }
  if (!classification.approvedDisposable) {
    return {
      ok: false,
      blocked: true,
      reason: `disposable_worktree_path_not_approved:${trim(operation) || "cleanup_worktree"}`,
      classification,
    };
  }
  return { ok: true, blocked: false, reason: "", classification };
}
