import { trim } from "../lib/cli-helpers.ts";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeMetricCount(value) {
  const parsed = toFiniteNumber(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeOutcomeTotals(context = {}) {
  if (!isRecord(context)) {
    return { ok: false, error: "context must be a JSON object", totals: null };
  }

  const metrics = context.metrics;
  if (!isRecord(metrics)) {
    return { ok: false, error: "context.metrics is required", totals: null };
  }

  const goalsClosed = normalizeMetricCount(metrics.goals_closed ?? metrics.goalsClosed);
  if (!Number.isFinite(goalsClosed)) {
    return { ok: false, error: "context.metrics.goals_closed must be a finite number", totals: null };
  }

  const issuesClosed = normalizeMetricCount(metrics.issues_closed ?? metrics.issuesClosed);
  if (!Number.isFinite(issuesClosed)) {
    return { ok: false, error: "context.metrics.issues_closed must be a finite number", totals: null };
  }

  const commitsLanded = normalizeMetricCount(metrics.commits_landed ?? metrics.commitsLanded);
  if (!Number.isFinite(commitsLanded)) {
    return { ok: false, error: "context.metrics.commits_landed must be a finite number", totals: null };
  }

  return {
    ok: true,
    error: "",
    totals: {
      goals_closed: goalsClosed,
      issues_closed: issuesClosed,
      commits_landed: commitsLanded,
      total_outcomes: goalsClosed + issuesClosed + commitsLanded,
    },
  };
}

function isRetryableStatus(status = 0) {
  return status === 429 || status >= 500;
}

function normalizeAttempts(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, Math.trunc(fallback));
  return Math.max(1, Math.trunc(parsed));
}

function normalizeDelayMs(value, fallback = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.trunc(fallback));
  return Math.max(0, Math.trunc(parsed));
}

function buildBaseResult({
  status = "failed",
  ok = false,
  delivered = false,
  skipped = false,
  attempts = 0,
  maxAttempts = 0,
  totals = null,
  webhookSource = "",
  httpStatus = null,
  error = "",
  retryable = false,
  responseBody = "",
} = {}) {
  return {
    ok,
    status,
    delivered,
    skipped,
    attempts,
    max_attempts: maxAttempts,
    goals_closed: Number(totals?.goals_closed || 0),
    issues_closed: Number(totals?.issues_closed || 0),
    commits_landed: Number(totals?.commits_landed || 0),
    total_outcomes: Number(totals?.total_outcomes || 0),
    webhook_source: webhookSource || "",
    http_status: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null,
    retryable: Boolean(retryable),
    error: trim(error),
    response_body: trim(responseBody),
  };
}

async function readResponseBody(response) {
  try {
    return trim(await response.text());
  } catch {
    return "";
  }
}

function defaultSleep(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveFactoryConfigWebhookValue(value = "", env = {}) {
  const raw = trim(value);
  if (!raw) return "";
  const placeholderMatch = raw.match(/^\$\{([A-Z0-9_]+)\}$/i);
  if (!placeholderMatch?.[1]) return raw;
  return trim(env?.[placeholderMatch[1]] || "");
}

function resolveWebhookUrl({ webhookUrl = "", env = {}, factoryConfigWebhookUrl = "" } = {}) {
  const fromFlag = trim(webhookUrl);
  if (fromFlag) {
    return { webhookUrl: fromFlag, webhookSource: "flag" };
  }

  const fromFactoryEnv = trim(env?.FACTORY_SLACK_WEBHOOK_URL || "");
  if (fromFactoryEnv) {
    return { webhookUrl: fromFactoryEnv, webhookSource: "env_factory" };
  }

  const fromFactoryConfig = resolveFactoryConfigWebhookValue(factoryConfigWebhookUrl, env);
  if (fromFactoryConfig) {
    return { webhookUrl: fromFactoryConfig, webhookSource: "factory_config" };
  }

  return { webhookUrl: "", webhookSource: "" };
}

export async function postReleaseToSlack(options = {}) {
  const {
    context,
    payload,
    webhookUrl = "",
    maxAttempts = 3,
    retryDelayMs = 250,
    fetchFn = globalThis.fetch,
    sleepFn = defaultSleep,
    env = process.env,
    factoryConfigWebhookUrl = "",
  } = options;

  const totalsResult = normalizeOutcomeTotals(context);
  if (!totalsResult.ok) {
    return buildBaseResult({
      status: "failed",
      ok: false,
      attempts: 0,
      maxAttempts: normalizeAttempts(maxAttempts, 3),
      error: totalsResult.error,
    });
  }

  const totals = totalsResult.totals;
  const normalizedMaxAttempts = normalizeAttempts(maxAttempts, 3);
  const normalizedRetryDelayMs = normalizeDelayMs(retryDelayMs, 250);

  // Skip only when there is truly nothing to report (all metrics zero).
  // The upstream worthiness evaluator and graph routing already decide
  // whether this node is reached — commits alone are a valid outcome
  // when the evaluator routes delivery_decision=slack_and_issue.
  if ((totals.goals_closed + totals.issues_closed + totals.commits_landed) <= 0) {
    return buildBaseResult({
      status: "skipped_no_outcomes",
      ok: true,
      delivered: false,
      skipped: true,
      attempts: 0,
      maxAttempts: normalizedMaxAttempts,
      totals,
    });
  }

  if (!isRecord(payload)) {
    return buildBaseResult({
      status: "failed",
      ok: false,
      delivered: false,
      skipped: false,
      attempts: 0,
      maxAttempts: normalizedMaxAttempts,
      totals,
      error: "payload must be a JSON object",
    });
  }

  const resolvedWebhookResult = resolveWebhookUrl({
    webhookUrl,
    env,
    factoryConfigWebhookUrl,
  });
  const resolvedWebhook = resolvedWebhookResult.webhookUrl;
  const webhookSource = resolvedWebhookResult.webhookSource;

  if (!resolvedWebhook) {
    return buildBaseResult({
      status: "failed",
      ok: false,
      delivered: false,
      skipped: false,
      attempts: 0,
      maxAttempts: normalizedMaxAttempts,
      totals,
      webhookSource,
      error: "missing_webhook_url",
    });
  }

  if (typeof fetchFn !== "function") {
    return buildBaseResult({
      status: "failed",
      ok: false,
      attempts: 0,
      maxAttempts: normalizedMaxAttempts,
      totals,
      webhookSource,
      error: "fetch_unavailable",
    });
  }

  let attempt = 0;
  let lastStatus = null;
  let lastError = "";
  let lastResponseBody = "";
  let lastRetryable = false;

  while (attempt < normalizedMaxAttempts) {
    attempt += 1;
    try {
      const response = await fetchFn(resolvedWebhook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      lastStatus = Number(response?.status) || null;

      if (response?.ok) {
        return buildBaseResult({
          status: "delivered",
          ok: true,
          delivered: true,
          skipped: false,
          attempts: attempt,
          maxAttempts: normalizedMaxAttempts,
          totals,
          webhookSource,
          httpStatus: lastStatus,
          retryable: false,
        });
      }

      lastRetryable = isRetryableStatus(lastStatus || 0);
      lastResponseBody = await readResponseBody(response);
      lastError = `http_${lastStatus || 0}`;

      if (!lastRetryable) {
        return buildBaseResult({
          status: "failed",
          ok: false,
          delivered: false,
          skipped: false,
          attempts: attempt,
          maxAttempts: normalizedMaxAttempts,
          totals,
          webhookSource,
          httpStatus: lastStatus,
          retryable: false,
          error: lastError,
          responseBody: lastResponseBody,
        });
      }

      if (attempt < normalizedMaxAttempts && normalizedRetryDelayMs > 0) {
        await sleepFn(normalizedRetryDelayMs);
      }
    } catch (error) {
      lastRetryable = true;
      lastError = `network_error:${trim(error?.message || error) || "unknown_error"}`;
      lastResponseBody = "";

      if (attempt < normalizedMaxAttempts && normalizedRetryDelayMs > 0) {
        await sleepFn(normalizedRetryDelayMs);
      }
    }
  }

  return buildBaseResult({
    status: "failed",
    ok: false,
    delivered: false,
    skipped: false,
    attempts: normalizedMaxAttempts,
    maxAttempts: normalizedMaxAttempts,
    totals,
    webhookSource,
    httpStatus: lastStatus,
    retryable: lastRetryable,
    error: lastError || "delivery_failed",
    responseBody: lastResponseBody,
  });
}
