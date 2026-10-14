import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import { createSuccessfulSlackFetch } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { postReleaseToSlack } from "../../src/commands/release-post-to-slack.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const fixturesDir = join(repoRoot, "packages/factory-ops/test/commands/fixtures/release");


function fixtureJson(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

test("release post-to-slack CLI wiring includes payload transport and retry flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/release-delivery-cmds.ts", "utf8");
  assert.match(source, /class ReleasePostToSlackCommand/);
  assert.match(source, /static paths = \[\["release", "post-to-slack"\]\]/);
  assert.match(source, /Option\.String\("--context", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--context-b64", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--payload", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--payload-b64", \{ required: false \}\)/);
  assert.match(source, /Option\.String\("--webhook-url", ""\)/);
  assert.match(source, /Option\.String\("--factory-root", ""\)/);
  assert.match(source, /Option\.String\("--config-path", ""\)/);
  assert.match(source, /Option\.String\("--max-attempts", "3"\)/);
  assert.match(source, /Option\.String\("--retry-delay-ms", "250"\)/);
});

test("postReleaseToSlack delivers webhook payload when outcomes exist", async () => {
  const context = fixtureJson("report-context.typical.json");
  const payload = { blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }], text: "Hello" };

  const calls = [];
  const result = await postReleaseToSlack({
    context,
    payload,
    webhookUrl: "https://hooks.slack.test/abc",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => "ok",
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "delivered");
  assert.equal(result.delivered, true);
  assert.equal(result.skipped, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.http_status, 200);
  assert.equal(result.total_outcomes, 21);
  assert.equal(result.webhook_source, "flag");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.slack.test/abc");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
});

test("postReleaseToSlack returns skipped_no_outcomes and performs zero fetch calls", async () => {
  const context = fixtureJson("report-context.zero-goals.json");

  let fetchCalls = 0;
  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "No-op" },
    fetchFn: async () => {
      fetchCalls += 1;
      throw new Error("must not call fetch");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "skipped_no_outcomes");
  assert.equal(result.skipped, true);
  assert.equal(result.delivered, false);
  assert.equal(result.attempts, 0);
  assert.equal(result.total_outcomes, 0);
  assert.equal(fetchCalls, 0);
});

test("postReleaseToSlack posts when only commits landed (worthiness evaluator routed here)", async () => {
  const context = {
    ...fixtureJson("report-context.zero-goals.json"),
    metrics: { goals_closed: 0, issues_closed: 0, commits_landed: 9 },
  };

  let fetchCalls = 0;
  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [{ type: "section", text: { type: "mrkdwn", text: "commits only" } }], text: "commits only" },
    webhookUrl: "https://hooks.slack.com/test",
    fetchFn: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, text: async () => "ok" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "delivered");
  assert.equal(result.delivered, true);
  assert.equal(result.commits_landed, 9);
  assert.equal(fetchCalls, 1, "should have posted to webhook");
});

test("postReleaseToSlack fails with deterministic missing_webhook_url when outcomes exist", async () => {
  const context = fixtureJson("report-context.typical.json");

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    webhookUrl: "",
    env: {},
    fetchFn: async () => {
      throw new Error("must not call fetch");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "missing_webhook_url");
  assert.equal(result.webhook_source, "");
  assert.equal(result.attempts, 0);
});

test("postReleaseToSlack uses FACTORY_SLACK_WEBHOOK_URL when flag is absent", async () => {
  const context = fixtureJson("report-context.typical.json");
  const calls = [];

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    env: { FACTORY_SLACK_WEBHOOK_URL: "https://hooks.slack.test/factory-env" },
    fetchFn: createSuccessfulSlackFetch(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.webhook_source, "env_factory");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://hooks.slack.test/factory-env");
});

test("postReleaseToSlack uses factoryConfigWebhookUrl when flag/env are absent", async () => {
  const context = fixtureJson("report-context.typical.json");
  const calls = [];

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    env: {},
    factoryConfigWebhookUrl: "https://hooks.slack.test/factory-config",
    fetchFn: createSuccessfulSlackFetch(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.webhook_source, "factory_config");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://hooks.slack.test/factory-config");
});


test("postReleaseToSlack resolves ${ENV_VAR} placeholders from factoryConfigWebhookUrl", async () => {
  const context = fixtureJson("report-context.typical.json");
  const calls = [];

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    env: { MOTHERSHIP_SLACK_WEBHOOK_URL: "https://hooks.slack.test/mothership-config-env" },
    factoryConfigWebhookUrl: "${MOTHERSHIP_SLACK_WEBHOOK_URL}",
    fetchFn: createSuccessfulSlackFetch(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.webhook_source, "factory_config");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://hooks.slack.test/mothership-config-env");
});

test("postReleaseToSlack webhook precedence is flag > env > factory config", async () => {
  const context = fixtureJson("report-context.typical.json");
  const calls = [];

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    webhookUrl: "https://hooks.slack.test/from-flag",
    env: { FACTORY_SLACK_WEBHOOK_URL: "https://hooks.slack.test/from-env" },
    factoryConfigWebhookUrl: "https://hooks.slack.test/from-config",
    fetchFn: createSuccessfulSlackFetch(calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.webhook_source, "flag");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://hooks.slack.test/from-flag");
});

test("postReleaseToSlack does not use legacy SLACK_WEBHOOK_URL", async () => {
  const context = fixtureJson("report-context.typical.json");

  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    env: { SLACK_WEBHOOK_URL: "https://hooks.slack.test/legacy-only" },
    fetchFn: async () => {
      throw new Error("must not call fetch");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_webhook_url");
  assert.equal(result.webhook_source, "");
});

test("postReleaseToSlack retries transient failures and eventually succeeds", async () => {
  const context = fixtureJson("report-context.typical.json");
  const payload = { blocks: [], text: "hello" };

  const sleeps = [];
  let attempts = 0;
  const result = await postReleaseToSlack({
    context,
    payload,
    webhookUrl: "https://hooks.slack.test/retry",
    maxAttempts: 3,
    retryDelayMs: 5,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    fetchFn: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => "upstream unavailable",
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "ok",
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "delivered");
  assert.equal(result.attempts, 2);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [5]);
});

test("postReleaseToSlack fails fast on non-retryable 4xx response", async () => {
  const context = fixtureJson("report-context.typical.json");

  let attempts = 0;
  const result = await postReleaseToSlack({
    context,
    payload: { blocks: [], text: "hello" },
    webhookUrl: "https://hooks.slack.test/400",
    maxAttempts: 5,
    fetchFn: async () => {
      attempts += 1;
      return {
        ok: false,
        status: 400,
        text: async () => "bad payload",
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, false);
  assert.equal(result.http_status, 400);
  assert.equal(result.error, "http_400");
  assert.equal(result.response_body, "bad payload");
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});

test("release post-to-slack CLI supports raw and base64 transports with parity", () => {
  const context = fixtureJson("report-context.zero-goals.json");
  const payload = { blocks: [], text: "noop" };

  const rawRun = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context",
      JSON.stringify(context),
      "--payload",
      JSON.stringify(payload)
    ]);

  assert.equal(rawRun.status, 0, rawRun.stderr || rawRun.stdout);
  const rawOut = JSON.parse(rawRun.stdout || "{}");

  const b64Run = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context-b64",
      Buffer.from(JSON.stringify(context), "utf8").toString("base64"),
      "--payload-b64",
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
    ]);

  assert.equal(b64Run.status, 0, b64Run.stderr || b64Run.stdout);
  const b64Out = JSON.parse(b64Run.stdout || "{}");

  assert.deepEqual(rawOut, b64Out);
  assert.equal(rawOut.status, "skipped_no_outcomes");
  assert.equal(rawOut.total_outcomes, 0);
});

test("release post-to-slack CLI resolves webhook from explicit config path", () => {
  const context = fixtureJson("report-context.typical.json");
  const payload = { blocks: [], text: "hello" };
  const tempRoot = mkdtempSync(join(tmpdir(), "release-post-to-slack-config-"));
  const configPath = join(tempRoot, "factory.config.json");
  writeFileSync(configPath, JSON.stringify({ slack_webhook_url: "http://127.0.0.1:9/from-config" }, null, 2));

  const run = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context",
      JSON.stringify(context),
      "--payload",
      JSON.stringify(payload),
      "--config-path",
      configPath
    ]);

  assert.equal(run.status, 0, "config-only path should resolve webhook and attempt delivery");
  const output = JSON.parse(run.stdout || "{}");
  assert.equal(output.webhook_source, "factory_config");
  assert.equal(output.status, "failed");
  assert.equal(output.ok, false);
  assert.equal(output.error.startsWith("network_error:") || output.error.startsWith("http_"), true);
});

test("release post-to-slack resolves ${ENV_VAR} webhook from explicit config path", () => {
  const context = fixtureJson("report-context.typical.json");
  const payload = { blocks: [], text: "hello" };
  const tempRoot = mkdtempSync(join(tmpdir(), "release-post-to-slack-config-env-"));
  const configPath = join(tempRoot, "factory.config.json");
  writeFileSync(configPath, JSON.stringify({ slack_webhook_url: "${MOTHERSHIP_SLACK_WEBHOOK_URL}" }, null, 2));

  const run = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context",
      JSON.stringify(context),
      "--payload",
      JSON.stringify(payload),
      "--config-path",
      configPath
    ], {
      env: {
      ...process.env,
      MOTHERSHIP_SLACK_WEBHOOK_URL: "http://127.0.0.1:9/from-mothership-config-env",
    }
    });

  assert.equal(run.status, 0, "config placeholder path should resolve webhook and attempt delivery");
  const output = JSON.parse(run.stdout || "{}");
  assert.equal(output.webhook_source, "factory_config");
  assert.equal(output.status, "failed");
  assert.equal(output.ok, false);
  assert.equal(output.error.startsWith("network_error:") || output.error.startsWith("http_"), true);
});

test("release post-to-slack CLI gives deterministic error for invalid explicit --config-path", () => {
  const context = fixtureJson("report-context.zero-goals.json");
  const payload = { blocks: [], text: "noop" };

  const run = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context",
      JSON.stringify(context),
      "--payload",
      JSON.stringify(payload),
      "--config-path",
      "does/not/exist/factory.config.json"
    ]);

  assert.equal(run.status, 1);
  assert.equal((run.stdout || "").trim(), "");
  assert.match(run.stderr, /release post-to-slack config load failed:/);
  assert.match(run.stderr, /Unable to read factory config at does\/not\/exist\/factory\.config\.json/);
});

test("release post-to-slack resolves webhook from HATCH_FACTORY_CONFIG_PATH context", () => {
  const context = fixtureJson("report-context.typical.json");
  const payload = { blocks: [], text: "hello" };

  const tempRoot = mkdtempSync(join(tmpdir(), "release-post-to-slack-hatch-config-"));
  const factoryRoot = join(tempRoot, "factories", "example-trading");
  const configPath = join(factoryRoot, "factory.config.json");
  mkdirSync(factoryRoot, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    factory_id: "example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: 407,
    model: "openai/gpt-5.3-codex",
    provider: "openrouter",
    slack_webhook_url: "http://127.0.0.1:9/from-example-trading-config",
  }, null, 2));

  const run = spawnOpsCli([
      "release",
      "post-to-slack",
      "--context",
      JSON.stringify(context),
      "--payload",
      JSON.stringify(payload)
    ], {
      env: {
      ...process.env,
      HATCH_FACTORY_ROOT: factoryRoot,
      HATCH_FACTORY_CONFIG_PATH: configPath,
    }
    });

  assert.equal(run.status, 0, "runtime-context config should resolve webhook and attempt delivery");
  const output = JSON.parse(run.stdout || "{}");
  assert.equal(output.webhook_source, "factory_config");
  assert.equal(output.status, "failed");
  assert.equal(output.ok, false);
  assert.equal(output.error.startsWith("network_error:") || output.error.startsWith("http_"), true);
});
