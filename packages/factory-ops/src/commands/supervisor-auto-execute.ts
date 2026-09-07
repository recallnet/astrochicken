import { spawnSync } from "node:child_process";

import { isDispatchBlocker } from "./supervisor-managed-action-item-gate.ts";

/**
 * Predicate: can this action item be auto-executed without LLM judgment?
 *
 * Auto-executable when ALL of:
 *   - Has a remediation_packet object
 *   - execution_commands is a non-empty array
 *   - requires_commit !== true
 *   - requires_repo_fix !== true
 *   - ownership_decision is "local_fix" (not "wait" or "control_plane")
 */
export function isAutoExecutable(item) {
  if (!item || typeof item !== "object") return false;
  const ownership = String(item.ownership_decision || "");
  if (ownership === "wait" || ownership === "control_plane") return false;
  const packet = item.remediation_packet;
  if (!packet || typeof packet !== "object") return false;
  if (packet.requires_commit === true) return false;
  if (packet.requires_repo_fix === true || packet.requiresRepoFix === true) return false;
  const cmds = packet.execution_commands;
  if (!Array.isArray(cmds) || cmds.length === 0) return false;
  return true;
}

/**
 * Execute a single auto-executable action item.
 * Runs execution_commands, then verify_commands.
 * Returns { ok, item, error?, verify_error? }.
 */
export function autoExecuteActionItem(item, { execFn } = {}) {
  const exec = execFn || defaultExecFn;
  const packet = item?.remediation_packet;
  if (!packet) return { ok: false, item, error: "no_remediation_packet" };
  const cmds = Array.isArray(packet.execution_commands) ? packet.execution_commands : [];
  if (cmds.length === 0) return { ok: false, item, error: "no_execution_commands" };

  for (const cmd of cmds) {
    const result = exec(String(cmd || ""));
    if (!result.ok) {
      return { ok: false, item, error: `exec_failed: ${result.stderr || result.error || "unknown"}` };
    }
  }

  const verifyCmds = Array.isArray(packet.verify_commands) ? packet.verify_commands : [];
  for (const cmd of verifyCmds) {
    const result = exec(String(cmd || ""));
    if (!result.ok) {
      return { ok: false, item, verify_error: `verify_failed: ${result.stderr || result.error || "unknown"}` };
    }
  }

  return { ok: true, item };
}

/**
 * Partition action items into auto-executable and needs-judgment.
 * Auto-execute the deterministic ones. Return remaining items that need LLM.
 *
 * Items with ownership_decision "wait" are dropped (nothing to do this tick).
 * Items with ownership_decision "control_plane" are dropped (handled elsewhere).
 */
export function processActionItems(actionItems, { execFn } = {}) {
  const items = Array.isArray(actionItems) ? actionItems : [];
  const executed = [];
  const failed = [];
  const needsJudgment = [];
  const skipped = [];

  for (const item of items) {
    if (!isDispatchBlocker(item)) {
      skipped.push({ item, reason: "non_blocking_packet" });
      continue;
    }
    const ownership = String(item?.ownership_decision || "");
    if (ownership === "wait") {
      skipped.push({ item, reason: "wait" });
      continue;
    }
    if (ownership === "control_plane") {
      skipped.push({ item, reason: "control_plane" });
      continue;
    }
    if (!isAutoExecutable(item)) {
      needsJudgment.push(item);
      continue;
    }
    const result = autoExecuteActionItem(item, { execFn });
    if (result.ok) {
      executed.push(result);
    } else {
      // Auto-exec failed — escalate to LLM
      failed.push(result);
      needsJudgment.push(item);
    }
  }

  return { executed, failed, needsJudgment, skipped };
}

function defaultExecFn(cmd) {
  const p = spawnSync("sh", ["-c", cmd], { encoding: "utf8", timeout: 60_000 });
  return {
    ok: p.status === 0,
    stdout: p.stdout || "",
    stderr: p.stderr || "",
  };
}
