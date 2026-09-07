import { trim } from "../../lib/cli-helpers.ts";

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
  if (fromFlag) return { webhookUrl: fromFlag, webhookSource: "flag" };

  const fromFactoryEnv = trim(env?.FACTORY_SLACK_WEBHOOK_URL || "");
  if (fromFactoryEnv) return { webhookUrl: fromFactoryEnv, webhookSource: "env_factory" };

  const fromFactoryConfig = resolveFactoryConfigWebhookValue(factoryConfigWebhookUrl, env);
  if (fromFactoryConfig) return { webhookUrl: fromFactoryConfig, webhookSource: "factory_config" };

  return { webhookUrl: "", webhookSource: "" };
}

export function resolveLensScheduledWebhook({ webhookUrl = "", env = {}, factoryConfigWebhookUrl = "" } = {}) {
  return resolveWebhookUrl({ webhookUrl, env, factoryConfigWebhookUrl });
}

function isRetryableStatus(status = 0) {
  return status === 429 || status >= 500;
}

export async function postLensToSlack({
  payload,
  webhookUrl = "",
  maxAttempts = 3,
  retryDelayMs = 250,
  fetchFn = globalThis.fetch,
  sleepFn = defaultSleep,
  env = process.env,
  factoryConfigWebhookUrl = "",
} = {}) {
  const resolved = resolveLensScheduledWebhook({ webhookUrl, env, factoryConfigWebhookUrl });
  if (!resolved.webhookUrl) {
    return { ok: false, delivered: false, status: "failed", error: "missing_webhook_url", webhook_source: resolved.webhookSource };
  }
  let attempt = 0;
  let lastStatus = 0;
  while (attempt < Math.max(1, Number(maxAttempts) || 3)) {
    attempt += 1;
    const response = await fetchFn(resolved.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).catch((error) => ({
      ok: false,
      status: 0,
      async text() {
        return String(error?.message || error);
      },
    }));
    lastStatus = Number(response?.status || 0);
    if (response?.ok) {
      return {
        ok: true,
        delivered: true,
        status: "delivered",
        attempts: attempt,
        webhook_source: resolved.webhookSource,
      };
    }
    if (attempt < maxAttempts && isRetryableStatus(lastStatus)) {
      await sleepFn(retryDelayMs);
      continue;
    }
    return {
      ok: false,
      delivered: false,
      status: "failed",
      attempts: attempt,
      webhook_source: resolved.webhookSource,
      http_status: lastStatus || null,
      error: trim(await response.text()),
    };
  }

  return {
    ok: false,
    delivered: false,
    status: "failed",
    attempts: attempt,
    webhook_source: resolved.webhookSource,
    http_status: lastStatus || null,
    error: "slack_delivery_failed",
  };
}
