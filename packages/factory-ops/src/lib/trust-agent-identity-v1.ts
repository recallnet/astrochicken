/**
 * Runtime-pinned v1 agent identity taxonomy for trust-participant contract checks.
 *
 * This module is the explicit source for ops-runtime strict trust validation.
 * We intentionally keep it in .mjs so `node packages/factory-ops/src/cli.ts ...`
 * never depends on importing TypeScript sources at runtime.
 *
 * Keep these values aligned with apps/hatch/src/pipeline/governance.ts:
 *   - AGENT_IDS_V1
 *   - AGENT_ROLES_V1
 */
export const AGENT_ID_KEY = "agent_id";
export const AGENT_ROLE_KEY = "agent_role";

export const AGENT_IDS_V1 = Object.freeze([
  "unknown",
  "tool.shell",
  "tool.python",
  "tool.http",
  "tool.generic",
  "stack.manager_loop",
  "agent.worktree",
  "agent.kw",
]);

export const AGENT_ROLES_V1 = Object.freeze([
  "unknown",
  "tool.operator",
  "manager.supervisor",
  "worktree.implementer",
  "knowledge.researcher",
]);

const AGENT_IDS_V1_SET = new Set(AGENT_IDS_V1);
const AGENT_ROLES_V1_SET = new Set(AGENT_ROLES_V1);

export function isValidAgentIdV1(value) {
  return AGENT_IDS_V1_SET.has(String(value || ""));
}

export function isValidAgentRoleV1(value) {
  return AGENT_ROLES_V1_SET.has(String(value || ""));
}
