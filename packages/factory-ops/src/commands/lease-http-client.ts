import { loadFactoryConfig } from "./factory-config-loader.ts";
import { parseFactoryDistributedLeaseFromComment } from "./lease-codec.ts";
import {
  FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_RECLAIM_GRACE_MS,
  MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS,
  normalizeManagedInstanceLeaseRecord,
  validateManagedInstanceLeaseRecord,
} from "./lease-holder.ts";
import { createGhApiClient } from "../../../github-adapter/src/github-adapter.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";

export const DEFAULT_MAX_ATTEMPTS = 5;
export const CONFLICT_BACKOFF_MS = [25, 50, 100, 200, 400];

export function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseEpochMs(iso) {
  const t = Date.parse(String(iso || "").trim());
  return Number.isFinite(t) ? t : Number.NaN;
}

export function toIso(value) {
  const epoch = Number(value);
  return new Date(Number.isFinite(epoch) ? epoch : Date.now()).toISOString();
}

function normalizeIsoUtc(value, fallbackEpochMs = Date.now()) {
  const t = parseEpochMs(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : toIso(fallbackEpochMs);
}

export function sleepMs(ms) {
  const wait = Math.max(0, Number(ms) || 0);
  const until = Date.now() + wait;
  while (Date.now() < until) {
    // synchronous retry loop
  }
}

function parseHeader(headersRaw = "", name = "") {
  if (!headersRaw || !name) return "";
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(headersRaw).match(new RegExp(`^\\s*${escaped}:\\s*(.+?)\\s*$`, "im"));
  return m ? m[1].trim() : "";
}

function parseDateHeaderIso(headersRaw = "", fallbackEpochMs = Date.now()) {
  const raw = parseHeader(headersRaw, "date");
  return normalizeIsoUtc(raw, fallbackEpochMs);
}

export function parseIssueNumber(value) {
  const raw = trim(value);
  if (!raw) return 0;
  const direct = raw.match(/^\d+$/);
  if (direct) return Math.trunc(Number(direct[0]));
  const issueUrl = raw.match(/\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (issueUrl?.[1]) return Math.trunc(Number(issueUrl[1]));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function resolveFactoryConfigLeaseDefaults({ repo = "", factoryRoot = "", configPath = "", factoryConfig = null } = {}) {
  const explicitRepo = trim(repo);
  let config = factoryConfig && typeof factoryConfig === "object" ? factoryConfig : null;
  if (!config) {
    try { config = loadFactoryConfig({ factoryRoot, configPath }).config; } catch { config = null; }
  }
  if (!config) return { config, configTargetRepo: "", trackingIssueNumber: 0, repo: explicitRepo };
  const configTargetRepo = trim(config?.target_repo || "");
  return {
    config,
    configTargetRepo,
    trackingIssueNumber: parseIssueNumber(config?.tracking_issue || ""),
    repo: explicitRepo || configTargetRepo,
  };
}


function normalizeFactoryDistributedLease(raw, {
  factoryId = "",
  leaseName = "",
  trackingIssueNumber = "",
  nowIso = "",
  nowEpochMs = Date.now(),
} = {}) {
  const requiredMissingField = MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS.find((field) => !trim(raw?.[field]));
  const normalized = normalizeManagedInstanceLeaseRecord(raw, {
    factoryId,
    leaseName,
    trackingIssueNumber,
    nowIso,
    nowEpochMs,
    requireRawManagedFields: true,
  });
  if (!normalized) {
    return {
      _validation_ok: false,
      _validation_reason_code: "missing-field",
      _validation_reason_detail: `missing-field:${requiredMissingField || "record"}`,
    };
  }

  const validation = validateManagedInstanceLeaseRecord(normalized, {
    nowIso,
    clockSkewToleranceMs: Math.max(0, toInt(normalized.clock_skew_tolerance_ms, DEFAULT_CLOCK_SKEW_TOLERANCE_MS)),
  });
  if (!validation.ok) {
    return {
      ...normalized,
      _validation_ok: false,
      _validation_reason_code: validation.reason_code,
      _validation_reason_detail: validation.reason_detail,
    };
  }

  return {
    ...normalized,
    _validation_ok: true,
    _validation_reason_code: "",
    _validation_reason_detail: "",
  };
}

export function evaluateLeaseSnapshot(lease, {
  nowIso,
  clockSkewToleranceMs = DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
  reclaimGraceMs = DEFAULT_RECLAIM_GRACE_MS,
} = {}) {
  if (!lease) {
    return {
      present: false,
      active: false,
      released: false,
      reclaimable: false,
      reason: "lease_missing",
      expired_ms: Number.NaN,
    };
  }

  if (trim(lease.status) === "released") {
    return {
      present: true,
      active: false,
      released: true,
      reclaimable: true,
      reason: "lease_released",
      expired_ms: Number.NaN,
    };
  }

  const nowMs = parseEpochMs(nowIso);
  const expiresMs = parseEpochMs(lease.expires_at);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) {
    return {
      present: true,
      active: false,
      released: false,
      reclaimable: true,
      reason: "lease_expiry_invalid",
      expired_ms: Number.NaN,
    };
  }

  const expiredMs = nowMs - expiresMs;
  const tolerance = Math.max(0, Number(clockSkewToleranceMs) || 0);
  const grace = Math.max(0, Number(reclaimGraceMs) || 0);
  const reclaimThreshold = tolerance + grace;

  if (expiredMs < reclaimThreshold) {
    return {
      present: true,
      active: true,
      released: false,
      reclaimable: false,
      reason: "lease_active",
      expired_ms: expiredMs,
    };
  }

  return {
    present: true,
    active: false,
    released: false,
    reclaimable: true,
    reason: "lease_expired_reclaimable",
    expired_ms: expiredMs,
  };
}

function normalizeNowIso(serverNowIso = "", nowEpochMs = Date.now()) {
  return normalizeIsoUtc(serverNowIso, nowEpochMs);
}

export function sameOwner(a, b) {
  return trim(a?.holder_id) && trim(a?.holder_id) === trim(b?.holder_id)
    && trim(a?.run_id) && trim(a?.run_id) === trim(b?.run_id);
}

export function matchingIdempotency(current = {}, incoming = "") {
  const existing = trim(current?.idempotency_key);
  const next = trim(incoming);
  if (!existing || !next) return true;
  return existing === next;
}

function normalizeLeaseCommentRow(row = {}) {
  return {
    id: Number(row?.id || 0),
    body: String(row?.body || ""),
    updated_at: String(row?.updated_at || ""),
  };
}

function collectMatchingLeaseComments(comments = [], {
  factoryId = "",
  leaseName = "",
  nowIso = "",
  nowEpochMs = Date.now(),
} = {}) {
  const out = [];
  for (const row of Array.isArray(comments) ? comments : []) {
    const normalized = normalizeLeaseCommentRow(row);
    if (!normalized.id) continue;

    const parsed = parseFactoryDistributedLeaseFromComment(normalized.body, null);
    if (!parsed || typeof parsed !== "object") continue;

    const parsedFactoryId = trim(parsed.factory_id);
    const parsedLeaseName = trim(parsed.lease_name);
    if (parsedFactoryId !== trim(factoryId) || parsedLeaseName !== trim(leaseName)) continue;

    const lease = normalizeFactoryDistributedLease(parsed, {
      factoryId,
      leaseName,
      nowIso,
      nowEpochMs,
    });
    const validationOk = Boolean(lease?._validation_ok);
    out.push({
      comment: normalized,
      lease,
      payload_invalid: !lease || !validationOk,
      validation_reason_code: validationOk ? "" : trim(lease?._validation_reason_code || "missing-field"),
      validation_reason_detail: validationOk ? "" : trim(lease?._validation_reason_detail || "missing-field:record"),
    });
  }
  out.sort((a, b) => a.comment.id - b.comment.id);
  return out;
}

function toLeaseCandidate(match = {}, { nowIso = "" } = {}) {
  const lease = match?.lease && typeof match.lease === "object" ? match.lease : null;
  const commentId = Number(match?.comment?.id || 0);
  const payloadInvalid = Boolean(match?.payload_invalid);
  const state = payloadInvalid
    ? {
      active: false,
      released: false,
      reclaimable: false,
      reason: "payload_invalid",
    }
    : evaluateLeaseSnapshot(lease, {
      nowIso,
      clockSkewToleranceMs: Math.max(0, toInt(lease?.clock_skew_tolerance_ms, DEFAULT_CLOCK_SKEW_TOLERANCE_MS)),
      reclaimGraceMs: Math.max(0, toInt(lease?.reclaim_grace_ms, DEFAULT_RECLAIM_GRACE_MS)),
    });

  return {
    comment_id: commentId,
    holder_id: trim(lease?.holder_id || ""),
    run_id: trim(lease?.run_id || ""),
    expires_at: trim(lease?.expires_at || lease?.lease_expires_at || ""),
    status: trim(lease?.status || ""),
    payload_invalid: payloadInvalid,
    active: Boolean(state?.active),
    released: Boolean(state?.released),
    reclaimable: Boolean(state?.reclaimable),
    state_reason: trim(state?.reason || ""),
  };
}

function collectLeaseCandidates(matches = [], { nowIso = "" } = {}) {
  const candidates = (Array.isArray(matches) ? matches : []).map((match) => toLeaseCandidate(match, { nowIso }));
  const activeCandidates = candidates.filter((candidate) => candidate.active && !candidate.released);
  return {
    candidates,
    activeCandidates,
    ambiguous: activeCandidates.length > 1,
  };
}

export function createFactoryDistributedLeaseGhClient({ spawn } = {}) {
  const customApiClient = createGhApiClient({
    ghFn: (args, options = {}) => {
      const runner = spawn;
      if (typeof runner !== "function") {
        throw new Error("createFactoryDistributedLeaseGhClient requires spawn when custom transport is provided");
      }
      const result = runner("gh", args, { encoding: "utf8", ...options });
      return {
        ok: result.status === 0,
        status: result.status ?? 1,
        stdout: String(result.stdout || ""),
        stderr: String(result.stderr || ""),
      };
    },
    ghPaginatedFn: (apiPath, fallback = []) => {
      const runner = spawn;
      if (typeof runner !== "function") {
        throw new Error("createFactoryDistributedLeaseGhClient requires spawn when custom transport is provided");
      }
      const result = runner("gh", ["api", apiPath, "--paginate"], { encoding: "utf8" });
      if (result.status !== 0) return fallback;
      try {
        const raw = String(result.stdout || "");
        const normalized = `[${raw.replace(/\]\s*\[/g, ",")}]`;
        const parsed = JSON.parse(normalized);
        return Array.isArray(parsed[0]) ? parsed.flat() : parsed;
      } catch {
        try {
          return String(result.stdout || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch {
          return fallback;
        }
      }
    },
  });
  const apiClient = typeof spawn === "function" ? customApiClient : createGhApiClient();

  function listLeaseComments({ repo, issueNumber }) {
    const listed = apiClient.apiPaginatedJson({
      apiPath: `repos/${repo}/issues/${issueNumber}/comments`,
      fallback: null,
    });
    if (!Array.isArray(listed)) {
      return { ok: false, error: "gh_list_comments_failed", comments: [] };
    }

    const comments = listed
      .map((entry) => ({
        id: Number(entry?.id || 0),
        body: String(entry?.body || ""),
        updated_at: String(entry?.updated_at || ""),
      }))
      .filter((entry) => entry.id > 0);

    return {
      ok: true,
      comments,
      // list uses paginated output without HTTP headers; canonical per-comment fetch still
      // provides server Date header for authoritative clock normalization.
      server_now_iso: normalizeNowIso("", Date.now()),
    };
  }

  function getComment({ repo, commentId }) {
    const loaded = apiClient.apiReadJson({
      apiPath: `repos/${repo}/issues/comments/${commentId}`,
      includeHeaders: true,
      fallback: {},
      errorFallback: "gh_get_comment_failed",
    });
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    return {
      ok: true,
      etag: loaded.etag,
      comment: loaded.json,
      server_now_iso: loaded.server_now_iso,
    };
  }

  function updateComment({ repo, commentId, body, etag = "" }) {
    // Note: GitHub Comments API does not support If-Match conditional headers.
    // CAS safety relies on lease version tokens, not HTTP-level ETags.
    const updated = apiClient.apiWriteJson({
      apiPath: `repos/${repo}/issues/comments/${commentId}`,
      method: "PATCH",
      payload: { body: String(body || "") },
      includeHeaders: true,
      payloadMode: "input",
      errorFallback: "gh_update_comment_failed",
    });
    if (!updated.ok) {
      return {
        ok: false,
        precondition_failed: updated.precondition_failed,
        error: updated.error,
      };
    }
    return {
      ok: true,
      etag: updated.etag,
      server_now_iso: updated.server_now_iso,
    };
  }

  function createComment({ repo, issueNumber, body }) {
    const created = apiClient.apiWriteJson({
      apiPath: `repos/${repo}/issues/${issueNumber}/comments`,
      method: "POST",
      payload: { body: String(body || "") },
      payloadMode: "input",
      errorFallback: "gh_create_comment_failed",
    });
    if (!created.ok) {
      return { ok: false, error: created.error };
    }
    return {
      ok: true,
      comment: created.json,
    };
  }

  function listOpenIssues({ repo, label = "" }) {
    const encodedLabel = encodeURIComponent(String(label || ""));
    const path = label
      ? `repos/${repo}/issues?state=open&labels=${encodedLabel}&per_page=100`
      : `repos/${repo}/issues?state=open&per_page=100`;
    const loaded = apiClient.apiReadJson({
      apiPath: path,
      fallback: [],
      errorFallback: "gh_list_issues_failed",
    });
    if (!loaded.ok) {
      return { ok: false, error: loaded.error, issues: [] };
    }
    const issues = loaded.json;
    const filtered = (Array.isArray(issues) ? issues : []).filter((entry) => !entry?.pull_request);
    return { ok: true, issues: filtered };
  }

  return {
    listLeaseComments,
    getComment,
    updateComment,
    createComment,
    listOpenIssues,
  };
}

export function loadLeaseSnapshot({
  repo,
  trackingIssueNumber,
  factoryId,
  leaseName,
  client,
  nowEpochMs,
} = {}) {
  const listed = client.listLeaseComments({ repo, issueNumber: trackingIssueNumber });
  if (!listed?.ok) {
    return {
      ok: false,
      reason: "lease_backend_unavailable",
      error: listed?.error || "list_comments_failed",
      now_iso: normalizeNowIso("", nowEpochMs),
      candidates: [],
      ambiguous: false,
    };
  }

  const nowIso = normalizeNowIso(listed?.server_now_iso || "", nowEpochMs);
  const matches = collectMatchingLeaseComments(listed.comments, {
    factoryId,
    leaseName,
    nowIso,
    nowEpochMs,
  });
  const candidateInfo = collectLeaseCandidates(matches, { nowIso });

  if (matches.length === 0) {
    return {
      ok: true,
      present: false,
      comment_id: 0,
      etag: "",
      lease: null,
      payload_invalid: false,
      now_iso: nowIso,
      candidate_comment_ids: [],
      candidates: candidateInfo.candidates,
      ambiguous: candidateInfo.ambiguous,
    };
  }

  const canonical = matches[0];
  const loaded = client.getComment({ repo, commentId: canonical.comment.id });
  if (!loaded?.ok) {
    return {
      ok: false,
      reason: "lease_backend_unavailable",
      error: loaded?.error || "get_comment_failed",
      now_iso: nowIso,
      candidates: candidateInfo.candidates,
      ambiguous: candidateInfo.ambiguous,
    };
  }

  const loadedNowIso = normalizeNowIso(loaded?.server_now_iso || nowIso, nowEpochMs);
  const parsed = parseFactoryDistributedLeaseFromComment(String(loaded?.comment?.body || ""), null);
  const lease = normalizeFactoryDistributedLease(parsed, {
    factoryId,
    leaseName,
    trackingIssueNumber: String(trackingIssueNumber),
    nowIso: loadedNowIso,
    nowEpochMs,
  });

  const refreshedCandidates = collectLeaseCandidates(matches.map((match) => {
    if (Number(match?.comment?.id || 0) !== Number(loaded?.comment?.id || canonical.comment.id || 0)) return match;
    const validationOk = Boolean(lease?._validation_ok);
    return {
      ...match,
      lease,
      payload_invalid: !lease || !validationOk,
      validation_reason_code: validationOk ? "" : trim(lease?._validation_reason_code || "missing-field"),
      validation_reason_detail: validationOk ? "" : trim(lease?._validation_reason_detail || "missing-field:record"),
    };
  }), { nowIso: loadedNowIso });

  const validationOk = Boolean(lease?._validation_ok);
  return {
    ok: true,
    present: true,
    comment_id: Number(loaded?.comment?.id || canonical.comment.id || 0),
    etag: trim(loaded?.etag || ""),
    lease,
    payload_invalid: !lease || !validationOk,
    payload_invalid_reason_code: validationOk ? "" : trim(lease?._validation_reason_code || "missing-field"),
    payload_invalid_reason_detail: validationOk ? "" : trim(lease?._validation_reason_detail || "missing-field:record"),
    now_iso: loadedNowIso,
    candidate_comment_ids: matches.map((item) => Number(item.comment.id || 0)).filter((id) => id > 0),
    candidates: refreshedCandidates.candidates,
    ambiguous: refreshedCandidates.ambiguous,
  };
}
