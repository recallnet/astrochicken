import path from "node:path";

import { assertBackendAdapterContract } from "./backend-adapter.ts";
import {
  appendLineAtomicSync,
  readJsonFileSync,
  resolveRepoStore,
  writeJsonAtomicSync,
} from "./fs-utils.ts";
import { createAuditEmitter } from "./github-adapter.ts";

function trim(value: unknown = ""): string {
  return String(value || "").trim();
}

function toPositiveInt(value: unknown = 0, fallback: number = 0): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toStringArray(value: unknown = []): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => trim(entry)).filter(Boolean);
}

function uniqueStrings(values: unknown[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = trim(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseFields(fields: string = ""): string[] {
  return uniqueStrings(String(fields || "")
    .split(",")
    .map((entry: string) => trim(entry))
    .filter(Boolean));
}

function parseIssueNumber(value: unknown = 0): number {
  return toPositiveInt(value, 0);
}

function parseIssueRecord(value: Record<string, unknown> = {}): Record<string, unknown> {
  const number = toPositiveInt(value.number, 0);
  return {
    number,
    title: trim(value.title),
    body: String(value.body || ""),
    labels: uniqueStrings(toStringArray(value.labels)),
    state: trim(value.state || "open") || "open",
    comments: Array.isArray(value.comments)
      ? value.comments.map((comment: unknown) => ({
          body: String((comment as Record<string, unknown>)?.body || ""),
          created_at: trim((comment as Record<string, unknown>)?.created_at || (comment as Record<string, unknown>)?.createdAt || ""),
        }))
      : [],
    blockedBy: Array.isArray(value.blockedBy)
      ? value.blockedBy.map((entry: unknown) => ({
          number: toPositiveInt((entry as Record<string, unknown>)?.number, 0),
          state: trim((entry as Record<string, unknown>)?.state || ""),
          milestone: trim((entry as Record<string, unknown>)?.milestone?.toString() || (entry as Record<string, unknown>)?.milestone || ""),
        }))
      : [],
    milestone: trim(value.milestone || ""),
    created_at: trim(value.created_at || ""),
    updated_at: trim(value.updated_at || ""),
    closed_reason: trim(value.closed_reason || ""),
  };
}

function issueMatchesLabels(issue: Record<string, unknown> = {}, labels: unknown = []): boolean {
  const required = uniqueStrings(toStringArray(labels));
  if (required.length === 0) return true;
  const issueLabels = new Set(uniqueStrings(issue.labels as unknown[] || []));
  return required.every((label: string) => issueLabels.has(label));
}

function issueMatchesSearch(issue: Record<string, unknown> = {}, search: string = ""): boolean {
  const term = trim(search).toLowerCase();
  if (!term) return true;

  const haystack = [
    issue.title,
    issue.body,
    ...((issue.labels || []) as unknown[]),
    ...((issue.comments || []) as Array<Record<string, unknown>>).map((entry) => entry.body),
  ].join("\n").toLowerCase();

  return haystack.includes(term);
}

function projectIssue(issue: Record<string, unknown> = {}, fields: string = "number,title"): Record<string, unknown> {
  const parsedIssue = parseIssueRecord(issue);
  const keys = parseFields(fields);
  if (keys.length === 0) {
    return {
      number: parsedIssue.number,
      title: parsedIssue.title,
    };
  }

  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "labels") {
      projected.labels = (parsedIssue.labels as string[]).map((name: string) => ({ name }));
      continue;
    }
    if (key === "comments") {
      projected.comments = (parsedIssue.comments as Array<Record<string, unknown>>).map((entry) => ({
        body: entry.body,
        created_at: entry.created_at,
      }));
      continue;
    }
    if (key === "blockedBy") {
      projected.blockedBy = (parsedIssue.blockedBy as Array<Record<string, unknown>>).map((entry) => ({
        number: entry.number,
        state: entry.state,
        milestone: entry.milestone ? { title: entry.milestone } : { title: "" },
      }));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(parsedIssue, key)) {
      projected[key] = parsedIssue[key];
    }
  }
  return projected;
}

/**
 * Local JSON-backed backend adapter.
 *
 * Store layout:
 *   <storeRoot>/<owner>~<repo>/issues.json
 *   <storeRoot>/<owner>~<repo>/next_id.json
 *   <storeRoot>/<owner>~<repo>/audit.log
 *   <storeRoot>/<owner>~<repo>/labels.json
 *   <storeRoot>/<owner>~<repo>/subissues/<parent>.json
 */
export function createLocalFsAdapter({
  repo,
  storeRoot,
  mutationContext = null,
  mutationContextJson = "",
  env = process.env,
  nowIsoFn = () => new Date().toISOString(),
  appendAuditRecordFn = (record: unknown) => ({ ok: true, record }),
  auditHostBaseDir = "",
  auditLogPath = "",
  auditHomeDir,
}: {
  repo?: string;
  storeRoot?: string;
  mutationContext?: unknown;
  mutationContextJson?: string;
  env?: Record<string, string | undefined>;
  nowIsoFn?: () => string;
  appendAuditRecordFn?: (record: unknown, opts?: Record<string, unknown>) => unknown;
  auditHostBaseDir?: string;
  auditLogPath?: string;
  auditHomeDir?: string;
} = {}): Record<string, unknown> {
  const normalizedRepo = trim(repo).toLowerCase();
  if (!normalizedRepo) throw new Error("repo is required");
  if (!storeRoot) throw new Error("storeRoot is required for local_fs backend");

  const repoDir = resolveRepoStore(storeRoot, normalizedRepo);
  const issuesPath = path.join(repoDir, "issues.json");
  const nextIdPath = path.join(repoDir, "next_id.json");
  const labelsPath = path.join(repoDir, "labels.json");
  const auditPath = path.join(repoDir, "audit.log");
  const subIssuesDir = path.join(repoDir, "subissues");

  const auditEmitter = createAuditEmitter({
    repo: normalizedRepo,
    mutationContext,
    mutationContextJson,
    env,
    nowIsoFn,
    appendAuditRecordFn,
    auditHostBaseDir,
    auditLogPath,
    auditHomeDir,
  });

  function readIssues(): Record<string, unknown>[] {
    const parsed = readJsonFileSync(issuesPath, []);
    if (!Array.isArray(parsed)) {
      throw new Error(`invalid local_fs issues payload: ${issuesPath}`);
    }
    return parsed.map((issue: unknown) => parseIssueRecord(issue as Record<string, unknown>)).filter((issue) => (issue.number as number) > 0);
  }

  function writeIssues(issues: Record<string, unknown>[] = []): void {
    const normalized = issues
      .map((issue) => parseIssueRecord(issue))
      .filter((issue) => (issue.number as number) > 0)
      .sort((left, right) => (left.number as number) - (right.number as number));
    writeJsonAtomicSync(issuesPath, normalized);
  }

  function readNextId(issues: Record<string, unknown>[] = []): number {
    const fallback = issues.length > 0
      ? Math.max(...issues.map((entry) => toPositiveInt(entry.number, 0))) + 1
      : 1;

    const parsed = readJsonFileSync(nextIdPath, { next: fallback }) as Record<string, unknown> | null;
    const next = toPositiveInt(parsed?.next, fallback);
    return next > 0 ? next : fallback;
  }

  function writeNextId(next: number = 1): void {
    const normalizedNext = toPositiveInt(next, 1);
    writeJsonAtomicSync(nextIdPath, { next: normalizedNext });
  }

  function appendLocalAudit(action: string = "", targetRef: string = ""): void {
    const recordResult = auditEmitter.emit(action, targetRef) as Record<string, unknown> | null;
    const record = recordResult?.record || null;
    if (!record) return;
    appendLineAtomicSync(auditPath, JSON.stringify(record));
  }

  function findIssueIndex(issues: Record<string, unknown>[] = [], number: number = 0): number {
    return issues.findIndex((entry) => toPositiveInt(entry.number, 0) === number);
  }

  const adapter: Record<string, unknown> = {
    repo: normalizedRepo,

    issueList({
      state = "open",
      labels,
      limit = 50,
      fields = "number,title",
      search,
      milestone,
    }: {
      state?: string;
      labels?: unknown;
      limit?: number;
      fields?: string;
      search?: string;
      milestone?: string;
    } = {}) {
      const normalizedState = trim(state || "open").toLowerCase() || "open";
      const normalizedLimit = toPositiveInt(limit, 50);
      const normalizedMilestone = trim(milestone);

      const filtered = readIssues()
        .filter((issue) => {
          if (normalizedState === "all") return true;
          return trim(issue.state).toLowerCase() === normalizedState;
        })
        .filter((issue) => !normalizedMilestone || trim(issue.milestone) === normalizedMilestone)
        .filter((issue) => issueMatchesLabels(issue, labels))
        .filter((issue) => issueMatchesSearch(issue, search))
        .slice(0, normalizedLimit);

      return filtered.map((issue) => projectIssue(issue, fields));
    },

    issueView({ number, fields = "number,title" }: { number?: unknown; fields?: string } = {}) {
      const parsedNumber = parseIssueNumber(number);
      if (!parsedNumber) return {};

      const issue = readIssues().find((entry) => entry.number === parsedNumber);
      if (!issue) return {};
      return projectIssue(issue, fields);
    },

    issueComment({ number, body }: { number?: unknown; body?: string } = {}) {
      const parsedNumber = parseIssueNumber(number);
      const targetRef = `issues/${String(parsedNumber || "")}`;
      auditEmitter.assertContext("comment_create", targetRef);
      if (!parsedNumber) {
        return { ok: false, stderr: "issue number is required" };
      }

      const issues = readIssues();
      const issueIndex = findIssueIndex(issues, parsedNumber);
      if (issueIndex < 0) {
        return { ok: false, stderr: `issue not found: ${parsedNumber}` };
      }

      issues[issueIndex] = {
        ...issues[issueIndex],
        comments: [
          ...((issues[issueIndex].comments || []) as unknown[]),
          { body: String(body || "") },
        ],
        updated_at: nowIsoFn(),
      };
      writeIssues(issues);
      appendLocalAudit("comment_create", targetRef);
      return { ok: true };
    },

    issueEdit({ number, addLabels = [], removeLabels = [], milestone }: { number?: unknown; addLabels?: string[]; removeLabels?: string[]; milestone?: string } = {}) {
      const parsedNumber = parseIssueNumber(number);
      const targetRef = `issues/${String(parsedNumber || "")}`;
      auditEmitter.assertContext("issue_label", targetRef);
      if (!parsedNumber) {
        return { ok: false, stderr: "issue number is required" };
      }

      const issues = readIssues();
      const issueIndex = findIssueIndex(issues, parsedNumber);
      if (issueIndex < 0) {
        return { ok: false, stderr: `issue not found: ${parsedNumber}` };
      }

      const current = issues[issueIndex];
      const removeSet = new Set(uniqueStrings(removeLabels));
      const nextLabels = uniqueStrings([
        ...(current.labels as string[]).filter((label: string) => !removeSet.has(label)),
        ...uniqueStrings(addLabels),
      ]);

      issues[issueIndex] = {
        ...current,
        labels: nextLabels,
        milestone: trim(milestone || current.milestone || ""),
        updated_at: nowIsoFn(),
      };

      writeIssues(issues);
      appendLocalAudit("issue_label", targetRef);
      return { ok: true };
    },

    issueClose({ number, reason = "completed" }: { number?: unknown; reason?: string } = {}) {
      const parsedNumber = parseIssueNumber(number);
      const targetRef = `issues/${String(parsedNumber || "")}`;
      auditEmitter.assertContext("issue_close", targetRef);
      if (!parsedNumber) {
        return { ok: false, stderr: "issue number is required" };
      }

      const issues = readIssues();
      const issueIndex = findIssueIndex(issues, parsedNumber);
      if (issueIndex < 0) {
        return { ok: false, stderr: `issue not found: ${parsedNumber}` };
      }

      issues[issueIndex] = {
        ...issues[issueIndex],
        state: "closed",
        closed_reason: trim(reason || "completed") || "completed",
        updated_at: nowIsoFn(),
      };
      writeIssues(issues);
      appendLocalAudit("issue_close", targetRef);
      return { ok: true };
    },

    issueCreate({ title, body, labels = [] }: { title?: string; body?: string; labels?: string[] } = {}) {
      auditEmitter.assertContext("issue_create", "issues/new");

      const issues = readIssues();
      const number = readNextId(issues);
      const nowIso = nowIsoFn();
      const created = parseIssueRecord({
        number,
        title,
        body,
        labels,
        state: "open",
        comments: [],
        milestone: "",
        created_at: nowIso,
        updated_at: nowIso,
      });

      writeIssues([...issues, created]);
      writeNextId(number + 1);
      appendLocalAudit("issue_create", `issues/${number}`);

      return {
        ok: true,
        number,
        url: `local://${normalizedRepo}/issues/${number}`,
      };
    },

    addSubIssue({ parentNumber, childNumber }: { parentNumber?: unknown; childNumber?: unknown } = {}) {
      const parsedParent = parseIssueNumber(parentNumber);
      const parsedChild = parseIssueNumber(childNumber);
      if (!parsedParent || !parsedChild) {
        return { ok: false, stderr: "parentNumber and childNumber are required" };
      }

      const issues = readIssues();
      const parentIssue = issues.find((entry) => entry.number === parsedParent);
      const childIssue = issues.find((entry) => entry.number === parsedChild);
      if (!parentIssue) {
        return { ok: false, stderr: `parent issue not found: ${parsedParent}` };
      }
      if (!childIssue) {
        return { ok: false, stderr: `child issue not found: ${parsedChild}` };
      }

      const filePath = path.join(subIssuesDir, `${parsedParent}.json`);
      const existing = readJsonFileSync(filePath, []);
      const next = Array.isArray(existing)
        ? existing.filter((entry: unknown) => Number((entry as Record<string, unknown>)?.number) !== parsedChild)
        : [];
      next.push({
        number: parsedChild,
        title: String(childIssue.title || ""),
        state: String(childIssue.state || "open"),
        labels: Array.isArray(childIssue.labels) ? childIssue.labels : [],
        issue_dependencies_summary: { blocked_by: 0 },
      });
      writeJsonAtomicSync(filePath, next);
      appendLocalAudit("issue_label", `issues/${parsedParent}/sub_issues/${parsedChild}`);
      return { ok: true, parent: String(parsedParent), child: String(parsedChild), error: "" };
    },

    listSubIssues({ number }: { number?: unknown } = {}) {
      const parsedNumber = parseIssueNumber(number);
      if (!parsedNumber) return [];

      const filePath = path.join(subIssuesDir, `${parsedNumber}.json`);
      const parsed = readJsonFileSync(filePath, []);
      return Array.isArray(parsed) ? parsed : [];
    },

    issueBlockedBy({ number }: { number?: unknown } = {}) {
      const parsedNumber = parseIssueNumber(number);
      if (!parsedNumber) return [];

      const issue = readIssues().find((entry) => entry.number === parsedNumber);
      return Array.isArray(issue?.blockedBy)
        ? (issue.blockedBy as Array<Record<string, unknown>>).map((entry) => ({
            number: entry.number,
            state: entry.state,
            milestone: entry.milestone ? { title: entry.milestone } : { title: "" },
          }))
        : [];
    },

    issueComments({ number }: { number?: unknown } = {}) {
      const parsedNumber = parseIssueNumber(number);
      if (!parsedNumber) return [];

      const issue = readIssues().find((entry) => entry.number === parsedNumber);
      return Array.isArray(issue?.comments)
        ? (issue.comments as Array<Record<string, unknown>>).map((entry) => ({
            body: String(entry?.body || ""),
            created_at: trim(entry?.created_at || ""),
          }))
        : [];
    },

    labelCreate({ name, description, color }: { name?: string; description?: string; color?: string } = {}) {
      const normalizedName = trim(name);
      const targetRef = `labels/${normalizedName}`;
      auditEmitter.assertContext("issue_label", targetRef);
      if (!normalizedName) {
        return { ok: false, stderr: "label name is required" };
      }

      const parsed = readJsonFileSync(labelsPath, []);
      const labelsList = Array.isArray(parsed) ? parsed : [];
      const withoutExisting = labelsList
        .filter((entry: unknown) => trim((entry as Record<string, unknown>)?.name).toLowerCase() !== normalizedName.toLowerCase())
        .map((entry: unknown) => ({
          name: trim((entry as Record<string, unknown>)?.name),
          description: trim((entry as Record<string, unknown>)?.description),
          color: trim((entry as Record<string, unknown>)?.color),
        }));

      const nextLabels = [
        ...withoutExisting,
        {
          name: normalizedName,
          description: trim(description),
          color: trim(color),
        },
      ].filter((entry) => entry.name);

      writeJsonAtomicSync(labelsPath, nextLabels);
      appendLocalAudit("issue_label", targetRef);
      return { ok: true };
    },
  };

  return assertBackendAdapterContract(adapter, { context: "local_fs adapter" });
}
