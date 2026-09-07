import { trim } from "./cli-helpers.ts";
import {
  buildRemediationPacket,
  persistRemediationPacket,
} from "./remediation-packet.ts";

export function persistCanonicalCheckoutPacket({
  context = {},
  failedChecks = [],
  deadendReason = "",
  detail = "",
} = {}) {
  const persistenceRepo = trim(context.source_repo_path || context.repo_root);
  if (!persistenceRepo) return null;
  const packet = buildRemediationPacket({
    packetType: "canonical_checkout_recovery",
    intent: "Recover the protected canonical checkout and restore deterministic supervisor startup invariants.",
    inspectionCommands: [
      `git -C '${trim(context.source_repo_path || context.repo_root)}' worktree list --porcelain`,
      trim(context.canonical_checkout_path)
        ? `git -C '${trim(context.canonical_checkout_path)}' status --short --branch`
        : "",
      `readlink '${trim(context.link_path)}' || true`,
    ].filter(Boolean),
    executionCommands: [
      "node packages/factory-ops/src/cli.ts doctor repair-canonical-checkout",
      trim(context.canonical_checkout_path)
        ? `git -C '${trim(context.canonical_checkout_path)}' checkout --force main`
        : "",
      "node packages/factory-ops/src/cli.ts doctor relink-cli",
    ].filter(Boolean),
    verifyCommands: [
      "node packages/factory-ops/src/cli.ts doctor canonical-checkout",
      trim(context.canonical_checkout_path)
        ? "node scripts/check-runtime-startup-probe.ts --json"
        : "",
    ].filter(Boolean),
    expectedPostconditions: [
      "canonical checkout exists as a protected git worktree on branch main",
      "global hatch-ops symlink points to the canonical checkout",
      "runtime startup probe succeeds from the canonical checkout",
    ],
    retryPolicy: {
      max_attempts: 1,
      on_failure: "escalate_with_packet_context",
      recheck_after: "after_canonical_checkout_repair",
    },
    requiresRepoFix: true,
    resourceRefs: {
      repo_root: trim(context.repo_root),
      source_repo_path: trim(context.source_repo_path),
      canonical_checkout_path: trim(context.canonical_checkout_path),
      origin_url: trim(context.origin_url),
      link_path: trim(context.link_path),
      mirror_path: trim(context.mirror_path),
      deadend_reason: trim(deadendReason),
      detail: trim(detail),
      failed_checks: failedChecks.map((check) => ({
        id: trim(check?.id),
        reason: trim(check?.reason),
      })),
    },
    preserveWork: {
      preserve_work_required: true,
      cleanup_blocked_until_preserved: true,
      preserve_actions: [
        "Do not delete protected worktrees or relink hatch-ops to a wave worktree while this packet is open.",
      ],
    },
    operatorPrompt: [
      "Recover the canonical AstroChicken checkout deterministically from the packet context.",
      trim(deadendReason) ? `Dead-end reason: ${trim(deadendReason)}.` : "",
      trim(detail) ? `Failure detail: ${trim(detail)}.` : "",
      "Correct outcome: the canonical checkout exists on main, the global CLI targets it, and runtime startup succeeds.",
    ].filter(Boolean).join(" "),
    factoryId: trim(context.factory_id || "mothership"),
  });
  const persisted = persistRemediationPacket({ repo: persistenceRepo, packet });
  return {
    packet_id: packet.packet_id,
    packet_type: packet.packet_type,
    packet_path: persisted.packet_path,
    packet_storage_class: persisted.storage_class,
  };
}
