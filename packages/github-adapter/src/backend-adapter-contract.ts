/**
 * Shared backend adapter contract used by GitHub and local-first adapters.
 *
 * @typedef {Object} BackendAdapter
 * @property {string} repo
 * @property {(args?: { state?: string, labels?: string[], limit?: number, fields?: string, search?: string, milestone?: string }) => unknown[]} issueList
 * @property {(args?: { number?: number|string, fields?: string }) => Record<string, unknown>} issueView
 * @property {(args?: { number?: number|string, body?: string }) => { ok: boolean, [key: string]: unknown }} issueComment
 * @property {(args?: { number?: number|string, title?: string, body?: string, addLabels?: string[], removeLabels?: string[], milestone?: string }) => { ok: boolean, [key: string]: unknown }} issueEdit
 * @property {(args?: { number?: number|string, reason?: string }) => { ok: boolean, [key: string]: unknown }} issueClose
 * @property {(args?: { title?: string, body?: string, labels?: string[] }) => { ok: boolean, url?: string, [key: string]: unknown }} issueCreate
 * @property {(args?: { parentNumber?: number|string, childNumber?: number|string }) => { ok: boolean, [key: string]: unknown }} addSubIssue
 * @property {(args?: { number?: number|string }) => unknown[]} listSubIssues
 * @property {(args?: { number?: number|string }) => unknown[]} issueBlockedBy
 * @property {(args?: { number?: number|string }) => unknown[]} issueComments
 * @property {(args?: { name?: string, description?: string, color?: string }) => { ok: boolean, [key: string]: unknown }} labelCreate
 */

export const BACKEND_ADAPTER_METHODS: readonly string[] = Object.freeze([
  "issueList",
  "issueView",
  "issueComment",
  "issueEdit",
  "issueClose",
  "issueCreate",
  "addSubIssue",
  "listSubIssues",
  "issueBlockedBy",
  "issueComments",
  "labelCreate",
]);

export function isBackendAdapter(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (typeof (value as Record<string, unknown>).repo !== "string" || ((value as Record<string, unknown>).repo as string).trim() === "") return false;

  return BACKEND_ADAPTER_METHODS.every((methodName) => typeof (value as Record<string, unknown>)[methodName] === "function");
}

export function assertBackendAdapterContract(value: unknown, { context = "backend adapter" }: { context?: string } = {}): Record<string, unknown> {
  if (isBackendAdapter(value)) return value as Record<string, unknown>;

  const subject: Record<string, unknown> = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const missing: string[] = [];
  if (typeof subject.repo !== "string" || String(subject.repo).trim() === "") {
    missing.push("repo");
  }

  for (const methodName of BACKEND_ADAPTER_METHODS) {
    if (typeof subject[methodName] !== "function") {
      missing.push(methodName);
    }
  }

  throw new Error(`${context} does not satisfy BackendAdapter contract: missing ${missing.join(", ")}`);
}
