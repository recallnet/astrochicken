import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { assertBackendAdapterContract } from "./backend-adapter.ts";
import {
  AUDIT_V1_SCHEMA,
  appendAuditRecord,
  validateAuditRecord,
} from "../../factory-ops/src/lib/audit-trail.ts";

function defaultGhFn(args: string[], options: Record<string, unknown> = {}): Record<string, unknown> {
  const p = spawnSync("gh", args, { encoding: "utf8", ...options });
  return {
    ok: p.status === 0,
    status: p.status ?? 1,
    signal: p.signal ?? "",
    error: p.error ?? null,
    stdout: String(p.stdout || ""),
    stderr: String(p.stderr || ""),
  };
}

function defaultGhPaginatedFn(apiPath: string, fallback: unknown[] = []): unknown[] {
  const p = spawnSync("gh", ["api", apiPath, "--paginate"], { encoding: "utf8" });
  if (p.status !== 0) return fallback;
  try {
    const raw = String(p.stdout || "");
    const normalized = "[" + raw.replace(/\]\s*\[/g, ",") + "]";
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed[0]) ? parsed.flat() : parsed;
  } catch {
    try {
      return String(p.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return fallback;
    }
  }
}

function parseJsonSafe(raw: string, fallback: unknown): unknown {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function ghGraphqlQuery(query: string, fallback: Record<string, unknown> = {}, ghFn: (args: string[], options?: Record<string, unknown>) => Record<string, unknown> = defaultGhFn): unknown {
  const result = ghFn(["api", "graphql", "-f", `query=${String(query || "")}`]);
  if (!result?.ok) {
    return fallback;
  }
  return parseJsonSafe(result.stdout as string, fallback);
}

function splitHttpHeadersBody(raw: string = ""): { headersRaw: string; bodyRaw: string } {
  const normalized = String(raw || "");
  const parts = normalized.split(/\r?\n\r?\n/);
  if (parts.length <= 1) return { headersRaw: "", bodyRaw: normalized };
  return {
    headersRaw: parts.slice(0, -1).join("\n\n"),
    bodyRaw: parts[parts.length - 1],
  };
}

function parseHeader(headersRaw: string = "", name: string = ""): string {
  if (!headersRaw || !name) return "";
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(headersRaw).match(new RegExp(`^\\s*${escaped}:\\s*(.+?)\\s*$`, "im"));
  return m ? m[1].trim() : "";
}

function normalizeIsoUtc(value: string = "", fallbackEpochMs: number = Date.now()): string {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(fallbackEpochMs).toISOString();
}

function trim(value: unknown = ""): string {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRepoSlug(value: unknown = ""): string {
  return trim(value).toLowerCase();
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = trim(value);
    if (normalized) return normalized;
  }
  return "";
}

function parseDestinations(value: unknown = {}): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value === "string") {
    const normalized = trim(value);
    if (!normalized) return {};
    const parsed = parseJsonSafe(normalized, null);
    return isPlainObject(parsed) ? parsed : {};
  }
  return {};
}

function parseMutationContext({ mutationContext = null, mutationContextJson = "", env = process.env }: { mutationContext?: unknown; mutationContextJson?: string; env?: Record<string, string | undefined> } = {}): Record<string, unknown> {
  if (isPlainObject(mutationContext)) return mutationContext;

  const explicitJson = trim(mutationContextJson);
  if (explicitJson) {
    const parsed = parseJsonSafe(explicitJson, null);
    return isPlainObject(parsed) ? parsed : {};
  }

  const envJson = trim(env?.HATCH_FACTORY_MUTATION_CONTEXT_JSON || "");
  if (!envJson) return {};
  const parsed = parseJsonSafe(envJson, null);
  return isPlainObject(parsed) ? parsed : {};
}

function resolveDestinationName({ mutationContext = {}, targetRepo = "" }: { mutationContext?: Record<string, unknown>; targetRepo?: string } = {}): string {
  const explicit = pickString(
    mutationContext.destination_name,
    mutationContext.destinationName,
    mutationContext.destination,
  );
  if (explicit) return explicit;

  const normalizedTargetRepo = normalizeRepoSlug(targetRepo);
  if (!normalizedTargetRepo) return "";

  const destinations = parseDestinations(
    mutationContext.destinations
    ?? mutationContext.destination_repos
    ?? mutationContext.destinationRepos
    ?? {},
  );

  for (const [destinationName, route] of Object.entries(destinations)) {
    const routeRecord = isPlainObject(route) ? route : {};
    const routeRepo = normalizeRepoSlug(routeRecord.repo || routeRecord.target_repo || routeRecord.targetRepo || "");
    if (routeRepo && routeRepo === normalizedTargetRepo) {
      return trim(destinationName);
    }
  }

  return "";
}

function resolveAuditBaseContext({
  repo = "",
  mutationContext = {},
  env = process.env,
}: {
  repo?: string;
  mutationContext?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
} = {}): Record<string, unknown> {
  const targetRepo = normalizeRepoSlug(repo);
  return {
    schema: AUDIT_V1_SCHEMA,
    instance_id: pickString(
      mutationContext.instance_id,
      mutationContext.instanceId,
      mutationContext.factory_id,
      mutationContext.factoryId,
      env?.HATCH_FACTORY_INSTANCE_ID,
      env?.HATCH_FACTORY_ID,
    ),
    installation_id: pickString(
      mutationContext.installation_id,
      mutationContext.installationId,
      env?.HATCH_INSTALLATION_ID,
    ),
    host_id: pickString(
      mutationContext.host_id,
      mutationContext.hostId,
      env?.HATCH_HOST_ID,
      env?.HOST_ID,
    ),
    run_id: pickString(
      mutationContext.run_id,
      mutationContext.runId,
      env?.HATCH_RUN_ID,
    ),
    tick_id: pickString(
      mutationContext.tick_id,
      mutationContext.tickId,
      env?.HATCH_TICK_ID,
    ),
    target_repo: targetRepo,
    destination_name: resolveDestinationName({ mutationContext, targetRepo }),
    capability_version: pickString(
      mutationContext.capability_version,
      mutationContext.capabilityVersion,
      env?.HATCH_CAPABILITY_VERSION,
    ),
    policy_profile: pickString(
      mutationContext.policy_profile,
      mutationContext.policyProfile,
      env?.HATCH_POLICY_PROFILE,
    ),
    runtime_version: pickString(
      mutationContext.runtime_version,
      mutationContext.runtimeVersion,
      env?.HATCH_RUNTIME_VERSION,
    ),
  };
}

function parseIssueNumberFromUrl(url: string = ""): string {
  const match = trim(url).match(/\/issues\/(\d+)(?:$|[/?#])/i);
  return trim(match?.[1] || "");
}

export function createAuditEmitter({
  repo,
  mutationContext = null,
  mutationContextJson = "",
  env = process.env,
  nowIsoFn = () => new Date().toISOString(),
  appendAuditRecordFn = appendAuditRecord,
  auditHostBaseDir = "",
  auditLogPath = "",
  auditHomeDir,
}: {
  repo?: string;
  mutationContext?: unknown;
  mutationContextJson?: string;
  env?: Record<string, string | undefined>;
  nowIsoFn?: () => string;
  appendAuditRecordFn?: (record: unknown, opts: Record<string, unknown>) => unknown;
  auditHostBaseDir?: string;
  auditLogPath?: string;
  auditHomeDir?: string;
} = {}): { assertContext: (action: string, targetRef: string) => void; emit: (action: string, targetRef: string) => unknown } {
  const parsedMutationContext = parseMutationContext({ mutationContext, mutationContextJson, env });
  const baseContext = resolveAuditBaseContext({
    repo,
    mutationContext: parsedMutationContext,
    env,
  });

  return {
    assertContext(action: string = "", targetRef: string = "issues/pending") {
      validateAuditRecord({
        ...baseContext,
        action,
        target_ref: targetRef,
        timestamp: nowIsoFn(),
      });
    },

    emit(action: string = "", targetRef: string = "") {
      const record = validateAuditRecord({
        ...baseContext,
        action,
        target_ref: targetRef,
        timestamp: nowIsoFn(),
      });
      return appendAuditRecordFn(record, {
        hostBaseDir: auditHostBaseDir,
        logPath: auditLogPath,
        homeDir: auditHomeDir,
      });
    },
  };
}

export function runGhCli(args: string[], { ghFn = defaultGhFn, options = {} }: { ghFn?: (args: string[], options?: Record<string, unknown>) => Record<string, unknown>; options?: Record<string, unknown> } = {}): Record<string, unknown> {
  return ghFn(args, options);
}

export function createGhApiClient({ ghFn = defaultGhFn, ghPaginatedFn = defaultGhPaginatedFn }: { ghFn?: (args: string[], options?: Record<string, unknown>) => Record<string, unknown>; ghPaginatedFn?: (apiPath: string, fallback?: unknown[]) => unknown[] } = {}): {
  apiReadJson: (opts?: Record<string, unknown>) => Record<string, unknown>;
  apiWriteJson: (opts?: Record<string, unknown>) => Record<string, unknown>;
  apiPaginatedJson: (opts?: Record<string, unknown>) => unknown[];
} {
  function apiReadJson({
    apiPath,
    includeHeaders = false,
    fallback = null,
    errorFallback = "gh_api_read_failed",
  }: Record<string, unknown> = {}): Record<string, unknown> {
    const args: string[] = ["api"];
    if (includeHeaders) args.push("-i");
    args.push(apiPath as string);
    const result = runGhCli(args, { ghFn });
    if (!result.ok) {
      return {
        ok: false,
        error: String(result.stderr || result.stdout || errorFallback),
        headersRaw: "",
        bodyRaw: "",
        json: fallback,
        etag: "",
        server_now_iso: normalizeIsoUtc("", Date.now()),
      };
    }

    const { headersRaw, bodyRaw } = splitHttpHeadersBody((result.stdout as string) || "");
    return {
      ok: true,
      headersRaw,
      bodyRaw,
      json: parseJsonSafe(bodyRaw || "{}", fallback),
      etag: parseHeader(headersRaw, "etag"),
      server_now_iso: normalizeIsoUtc(parseHeader(headersRaw, "date"), Date.now()),
    };
  }

  function apiWriteJson({
    apiPath,
    method = "PATCH",
    payload = null,
    includeHeaders = false,
    etag = "",
    payloadMode = "input",
    errorFallback = "gh_api_write_failed",
  }: Record<string, unknown> = {}): Record<string, unknown> {
    const args: string[] = ["api"];
    if (includeHeaders) args.push("-i");
    args.push("-X", method as string, apiPath as string);
    if (etag) {
      args.push("-H", `If-Match: ${etag}`);
    }

    const options: Record<string, unknown> = {};
    if (payloadMode === "input") {
      args.push("--input", "-");
      options.input = JSON.stringify(payload ?? {});
    } else if (payload && typeof payload === "object") {
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        args.push("-f", `${key}=${String(value ?? "")}`);
      }
    }

    const result = runGhCli(args, { ghFn, options });
    if (!result.ok) {
      const stderr = String(result.stderr || "");
      return {
        ok: false,
        precondition_failed: /412|precondition/i.test(stderr),
        error: stderr || String(result.stdout || errorFallback),
        etag: "",
        headersRaw: "",
        bodyRaw: "",
        json: null,
        server_now_iso: normalizeIsoUtc("", Date.now()),
      };
    }

    const { headersRaw, bodyRaw } = splitHttpHeadersBody((result.stdout as string) || "");
    return {
      ok: true,
      precondition_failed: false,
      error: "",
      etag: parseHeader(headersRaw, "etag"),
      headersRaw,
      bodyRaw,
      json: parseJsonSafe(bodyRaw || (result.stdout as string) || "{}", {}),
      server_now_iso: normalizeIsoUtc(parseHeader(headersRaw, "date"), Date.now()),
    };
  }

  function apiPaginatedJson({ apiPath, fallback = [] }: Record<string, unknown> = {}): unknown[] {
    return ghPaginatedFn(apiPath as string, fallback as unknown[]);
  }

  return {
    apiReadJson,
    apiWriteJson,
    apiPaginatedJson,
  };
}

export const GITHUB_CANONICAL_EVENT_FAMILIES = Object.freeze({
  ISSUE_SOURCE_READ: "github.issue_source.read",
  PROJECTION_RECEIPT: "github.projection.receipt",
});

function buildGitHubCanonicalEvent({
  eventFamily = "",
  factoryId = "",
  runId = "",
  emitter = "",
  payload = {},
}: {
  eventFamily?: string;
  factoryId?: string;
  runId?: string;
  emitter?: string;
  payload?: Record<string, unknown>;
} = {}): Record<string, unknown> | null {
  const normalizedFactoryId = trim(factoryId);
  const normalizedEmitter = trim(emitter);
  const normalizedFamily = trim(eventFamily);
  if (!normalizedFactoryId || !normalizedEmitter || !normalizedFamily) {
    return null;
  }
  return {
    schema: "canonical_event_envelope/v1",
    event_id: randomUUID(),
    event_family: normalizedFamily,
    event_version: 1,
    factory_id: normalizedFactoryId,
    run_id: trim(runId) || undefined,
    emitter: normalizedEmitter,
    emitted_at: new Date().toISOString(),
    event_origin: "runtime",
    payload: isPlainObject(payload) ? payload : {},
  };
}

function dispatchCanonicalGitHubEvent(event: Record<string, unknown> | null, emitCanonicalEventFn: unknown): Record<string, unknown> | null {
  if (event && typeof emitCanonicalEventFn === "function") {
    emitCanonicalEventFn(event);
  }
  return event;
}

export function createGitHubIssueSource({
  adapter,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
  emitterBase = "packages.github-adapter.issue-source",
}: {
  adapter?: unknown;
  factoryId?: string;
  runId?: string;
  emitCanonicalEventFn?: (event: Record<string, unknown>) => void;
  emitterBase?: string;
} = {}): Record<string, unknown> {
  const resolvedAdapter = assertBackendAdapterContract(adapter, { context: "github issue source adapter" });

  return {
    repo: resolvedAdapter.repo,
    issueList(args: Record<string, unknown> = {}) {
      const issues = (resolvedAdapter.issueList as (args: Record<string, unknown>) => unknown[])(args);
      for (const issue of Array.isArray(issues) ? issues : []) {
        dispatchCanonicalGitHubEvent(buildGitHubCanonicalEvent({
          eventFamily: GITHUB_CANONICAL_EVENT_FAMILIES.ISSUE_SOURCE_READ,
          factoryId,
          runId,
          emitter: `${emitterBase}.issueList`,
          payload: {
            operation: "issue_list",
            repo: resolvedAdapter.repo,
            issue_number: trim((issue as Record<string, unknown>)?.number),
            title: trim((issue as Record<string, unknown>)?.title),
          },
        }), emitCanonicalEventFn);
      }
      return issues;
    },
    issueView(args: Record<string, unknown> = {}) {
      const issue = (resolvedAdapter.issueView as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      const labels = Array.isArray(issue?.labels)
        ? issue.labels.map((entry: unknown) => trim((entry as Record<string, unknown>)?.name || entry)).filter(Boolean)
        : [];
      dispatchCanonicalGitHubEvent(buildGitHubCanonicalEvent({
        eventFamily: GITHUB_CANONICAL_EVENT_FAMILIES.ISSUE_SOURCE_READ,
        factoryId,
        runId,
        emitter: `${emitterBase}.issueView`,
        payload: {
          operation: "issue_view",
          repo: resolvedAdapter.repo,
          issue_number: trim(issue?.number || args?.number),
          title: trim(issue?.title),
          state: trim(issue?.state),
          labels,
        },
      }), emitCanonicalEventFn);
      return issue;
    },
  };
}

export function createGitHubProjectionTarget({
  adapter,
  factoryId = "",
  runId = "",
  emitCanonicalEventFn,
  emitterBase = "packages.github-adapter.projection-target",
}: {
  adapter?: unknown;
  factoryId?: string;
  runId?: string;
  emitCanonicalEventFn?: (event: Record<string, unknown>) => void;
  emitterBase?: string;
} = {}): Record<string, unknown> {
  const resolvedAdapter = assertBackendAdapterContract(adapter, { context: "github projection target adapter" });

  function emitReceipt({
    operation = "",
    targetRef = "",
    issueNumber = "",
    issueUrl = "",
    result = {},
    extraPayload = {},
  }: {
    operation?: string;
    targetRef?: string;
    issueNumber?: string;
    issueUrl?: string;
    result?: Record<string, unknown>;
    extraPayload?: Record<string, unknown>;
  } = {}): Record<string, unknown> | null {
    // @context:regression Receipt events must fire for failed mutations too; otherwise the
    // canonical log loses the exact outbound attempt that caused a factory-side stall.
    return dispatchCanonicalGitHubEvent(buildGitHubCanonicalEvent({
      eventFamily: GITHUB_CANONICAL_EVENT_FAMILIES.PROJECTION_RECEIPT,
      factoryId,
      runId,
      emitter: `${emitterBase}.${operation}`,
      payload: {
        operation: trim(operation),
        repo: resolvedAdapter.repo,
        target_ref: trim(targetRef),
        issue_number: trim(issueNumber),
        issue_url: trim(issueUrl),
        ok: result?.ok === true,
        status: Number.isFinite(Number(result?.status)) ? Number(result.status) : 0,
        stderr: trim(result?.stderr),
        ...extraPayload,
      },
    }), emitCanonicalEventFn);
  }

  return {
    repo: resolvedAdapter.repo,
    issueCreate(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.issueCreate as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      const issueUrl = trim(result?.url || result?.stdout || "");
      const issueNumber = parseIssueNumberFromUrl(issueUrl);
      emitReceipt({
        operation: "issue_create",
        targetRef: issueNumber ? `issues/${issueNumber}` : "issues/unknown",
        issueNumber,
        issueUrl,
        result,
        extraPayload: {
          labels: Array.isArray(args?.labels) ? (args.labels as unknown[]).map((label: unknown) => trim(label)).filter(Boolean) : [],
        },
      });
      return result;
    },
    issueEdit(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.issueEdit as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      emitReceipt({
        operation: "issue_edit",
        targetRef: `issues/${trim(args?.number)}`,
        issueNumber: trim(args?.number),
        result,
        extraPayload: {
          title: trim(args?.title),
          has_body: Boolean(trim(args?.body)),
          add_labels: Array.isArray(args?.addLabels) ? (args.addLabels as unknown[]).map((label: unknown) => trim(label)).filter(Boolean) : [],
          remove_labels: Array.isArray(args?.removeLabels) ? (args.removeLabels as unknown[]).map((label: unknown) => trim(label)).filter(Boolean) : [],
          milestone: trim(args?.milestone),
        },
      });
      return result;
    },
    issueComment(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.issueComment as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      emitReceipt({
        operation: "issue_comment",
        targetRef: `issues/${trim(args?.number)}`,
        issueNumber: trim(args?.number),
        result,
        extraPayload: {
          has_body: Boolean(trim(args?.body)),
        },
      });
      return result;
    },
    issueClose(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.issueClose as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      emitReceipt({
        operation: "issue_close",
        targetRef: `issues/${trim(args?.number)}`,
        issueNumber: trim(args?.number),
        result,
        extraPayload: {
          reason: trim(args?.reason),
        },
      });
      return result;
    },
    addSubIssue(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.addSubIssue as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      emitReceipt({
        operation: "add_sub_issue",
        targetRef: `issues/${trim(args?.parentNumber)}/sub_issues/${trim(args?.childNumber)}`,
        issueNumber: trim(args?.childNumber),
        result,
        extraPayload: {
          parent_issue_number: trim(args?.parentNumber),
          child_issue_number: trim(args?.childNumber),
        },
      });
      return result;
    },
    labelCreate(args: Record<string, unknown> = {}) {
      const result = (resolvedAdapter.labelCreate as (args: Record<string, unknown>) => Record<string, unknown>)(args);
      emitReceipt({
        operation: "label_create",
        targetRef: `labels/${trim(args?.name)}`,
        result,
        extraPayload: {
          label_name: trim(args?.name),
          description: trim(args?.description),
          color: trim(args?.color),
        },
      });
      return result;
    },
  };
}

/**
 * Create a GitHub adapter backed by the `gh` CLI.
 *
 * Every method uses structured arguments instead of raw CLI arg arrays.
 * The adapter owns the repo context -- callers never pass --repo.
 */
export function createGhCliAdapter({
  repo,
  ghFn = defaultGhFn,
  ghPaginatedFn = defaultGhPaginatedFn,
  mutationContext = null,
  mutationContextJson = "",
  env = process.env,
  nowIsoFn = () => new Date().toISOString(),
  appendAuditRecordFn = appendAuditRecord,
  auditHostBaseDir = "",
  auditLogPath = "",
  auditHomeDir,
}: {
  repo?: string;
  ghFn?: (args: string[], options?: Record<string, unknown>) => Record<string, unknown>;
  ghPaginatedFn?: (apiPath: string, fallback?: unknown[]) => unknown[];
  mutationContext?: unknown;
  mutationContextJson?: string;
  env?: Record<string, string | undefined>;
  nowIsoFn?: () => string;
  appendAuditRecordFn?: (record: unknown, opts?: Record<string, unknown>) => unknown;
  auditHostBaseDir?: string;
  auditLogPath?: string;
  auditHomeDir?: string;
} = {}): Record<string, unknown> {
  if (!repo) throw new Error("repo is required");

  const auditEmitter = createAuditEmitter({
    repo,
    mutationContext,
    mutationContextJson,
    env,
    nowIsoFn,
    appendAuditRecordFn,
    auditHostBaseDir,
    auditLogPath,
    auditHomeDir,
  });

  function ghJsonCall(args: string[], fallback: unknown): unknown {
    const r = ghFn(args);
    if (!r.ok) return fallback;
    return parseJsonSafe(r.stdout as string, fallback);
  }

  const adapter: Record<string, unknown> = {
    repo,

    issueList({
      state = "open",
      labels,
      limit = 50,
      fields = "number,title",
      search,
      milestone,
    }: {
      state?: string;
      labels?: string[];
      limit?: number;
      fields?: string;
      search?: string;
      milestone?: string;
    } = {}) {
      const args: string[] = ["issue", "list", "--repo", repo as string, "--state", state];
      if (labels && labels.length > 0) {
        args.push("--label", labels.join(","));
      }
      args.push("--limit", String(limit));
      if (milestone) {
        args.push("--milestone", milestone);
      }
      if (search) {
        args.push("--search", search);
      }
      args.push("--json", fields);
      return ghJsonCall(args, []);
    },

    issueView({ number, fields = "number,title" }: { number?: unknown; fields?: string } = {}) {
      return ghJsonCall(
        ["issue", "view", String(number), "--repo", repo as string, "--json", fields],
        {},
      );
    },

    issueComment({ number, body }: { number?: unknown; body?: string } = {}) {
      const targetRef = `issues/${String(number)}`;
      auditEmitter.assertContext("comment_create", targetRef);
      const result = ghFn(["issue", "comment", String(number), "--repo", repo as string, "--body", body as string]);
      if (result.ok) {
        auditEmitter.emit("comment_create", targetRef);
      }
      return result;
    },

    issueEdit({ number, title, body, addLabels = [], removeLabels = [], milestone }: { number?: unknown; title?: string; body?: string; addLabels?: string[]; removeLabels?: string[]; milestone?: string } = {}) {
      const targetRef = `issues/${String(number)}`;
      auditEmitter.assertContext("issue_label", targetRef);
      const args: string[] = ["issue", "edit", String(number), "--repo", repo as string];
      if (title) {
        args.push("--title", title);
      }
      if (body) {
        args.push("--body", body);
      }
      for (const label of addLabels) {
        args.push("--add-label", label);
      }
      for (const label of removeLabels) {
        args.push("--remove-label", label);
      }
      if (milestone) {
        args.push("--milestone", milestone);
      }
      const result = ghFn(args);
      if (result.ok) {
        auditEmitter.emit("issue_label", targetRef);
      }
      return result;
    },

    issueClose({ number, reason = "completed" }: { number?: unknown; reason?: string } = {}) {
      const targetRef = `issues/${String(number)}`;
      auditEmitter.assertContext("issue_close", targetRef);
      const result = ghFn(["issue", "close", String(number), "--repo", repo as string, "--reason", reason]);
      if (result.ok) {
        auditEmitter.emit("issue_close", targetRef);
      }
      return result;
    },

    issueCreate({ title, body, labels = [] }: { title?: string; body?: string; labels?: string[] } = {}) {
      auditEmitter.assertContext("issue_create", "issues/new");
      const args: string[] = ["issue", "create", "--repo", repo as string, "--title", title as string];
      if (body) {
        args.push("--body", body);
      }
      for (const label of labels) {
        args.push("--label", label);
      }
      const result = ghFn(args);
      const url = result.ok ? String(result.stdout || "").trim() : "";
      if (result.ok) {
        const issueNumber = parseIssueNumberFromUrl(url);
        auditEmitter.emit("issue_create", issueNumber ? `issues/${issueNumber}` : "issues/unknown");
      }
      return {
        ...result,
        url,
      };
    },

    addSubIssue({ parentNumber, childNumber }: { parentNumber?: unknown; childNumber?: unknown } = {}) {
      const parent = trim(parentNumber);
      const child = trim(childNumber);
      if (!parent || !child) {
        return { ok: false, parent, child, error: "missing_required_args" };
      }

      const targetRef = `issues/${parent}/sub_issues/${child}`;
      auditEmitter.assertContext("issue_label", targetRef);

      // @context:integration !critical GitHub exposes sub-issue reads over
      // REST, but creating the relationship has to go through GraphQL with
      // node IDs; the REST create endpoint rejects node IDs and leaves live
      // goal/sub-issue wiring broken.
      const maxRetries = 3;
      function resolveIssueNodeId(issueNumber: string = "", role: string = "issue"): { ok: boolean; error: string; nodeId: string } {
        let result: Record<string, unknown> | undefined;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          result = ghFn(["api", `repos/${repo}/issues/${issueNumber}`, "--jq", ".node_id"]);
          if (result.ok) break;
          const errMsg = (result.stderr || result.stdout || "") as string;
          if (!errMsg.includes("404")) break;
          if (attempt < maxRetries - 1) {
            const ms = (attempt + 1) * 1000;
            const end = Date.now() + ms;
            while (Date.now() < end) { /* spin */ }
          }
        }
        if (!result?.ok) {
          return {
            ok: false,
            error: `failed_to_resolve_${role}_node_id: ${result?.stderr || result?.stdout}`.trim(),
            nodeId: "",
          };
        }
        const nodeId = trim(result.stdout);
        if (!nodeId) {
          return { ok: false, error: `empty_${role}_node_id`, nodeId: "" };
        }
        return { ok: true, error: "", nodeId };
      }

      const parentNode = resolveIssueNodeId(parent, "parent");
      if (!parentNode.ok) return { ok: false, parent, child, error: parentNode.error };

      const childNode = resolveIssueNodeId(child, "child");
      if (!childNode.ok) return { ok: false, parent, child, error: childNode.error };

      const result = ghFn([
        "api", "graphql",
        "-f", "query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{number} subIssue{number}}}",
        "-F", `parent=${parentNode.nodeId}`,
        "-F", `child=${childNode.nodeId}`,
      ]);
      if (result.ok) {
        auditEmitter.emit("issue_label", targetRef);
        return { ok: true, parent, child, error: "" };
      }
      return { ok: false, parent, child, error: `add_sub_issue_failed: ${result.stderr || result.stdout}`.trim() };
    },

    listSubIssues({ number }: { number?: unknown } = {}) {
      return ghPaginatedFn(`repos/${repo}/issues/${number}/sub_issues?per_page=100`, []);
    },

    issueBlockedBy({ number }: { number?: unknown } = {}) {
      const parsedNumber = Number.parseInt(String(number || ""), 10);
      if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) return [];
      const [owner, name] = String(repo || "").split("/");
      if (!owner || !name) return [];
      const query = `query { repository(owner:"${owner}", name:"${name}") { issue(number:${parsedNumber}) { blockedBy(first:100){ nodes { number state milestone { title } } } } } }`;
      const out = ghJsonCall(["api", "graphql", "-f", `query=${query}`], {}) as Record<string, unknown>;
      return (out?.data as Record<string, unknown>)?.repository
        ? ((((out.data as Record<string, unknown>).repository as Record<string, unknown>)?.issue as Record<string, unknown>)?.blockedBy as Record<string, unknown>)?.nodes || []
        : [];
    },

    issueComments({ number }: { number?: unknown } = {}) {
      const parsedNumber = Number.parseInt(String(number || ""), 10);
      if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) return [];
      return ghJsonCall(["api", `repos/${repo}/issues/${parsedNumber}/comments?per_page=100`], []);
    },

    labelCreate({ name, description, color }: { name?: string; description?: string; color?: string } = {}) {
      const targetRef = `labels/${String(name || "")}`;
      auditEmitter.assertContext("issue_label", targetRef);
      const args: string[] = ["label", "create", name as string, "--repo", repo as string];
      if (description) {
        args.push("--description", description);
      }
      if (color) {
        args.push("--color", color);
      }
      args.push("--force");
      const result = ghFn(args);
      if (result.ok) {
        auditEmitter.emit("issue_label", targetRef);
      }
      return result;
    },
  };

  return assertBackendAdapterContract(adapter, { context: "github adapter" });
}
