import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyzeReactorCollectorContract } from "./lib/reactor-collector-contract.ts";

test("reactor collector contract fails bespoke runtime telemetry imports", () => {
  const analysis = analyzeReactorCollectorContract({
    files: [
      "apps/hatch/src/cli.ts",
      "apps/hatch/src/server/server.ts",
    ],
    fileExists(path) {
      return path === "packages/factory-telemetry/config/otel-collector.yaml"
        || path === "apps/hatch/src/pipeline/reactor-instrumentation.ts"
        || path === "packages/factory-telemetry/src/otel-stdout.ts";
    },
    readFile(path) {
      if (path.endsWith("otel-collector.yaml")) {
        return "receivers:\n  otlp:\nprocessors:\n  batch:\nexporters:\n  debug:\nservice:\n  pipelines:\n";
      }
      if (path.endsWith("otel-stdout.ts")) {
        return 'import "@opentelemetry/sdk-logs"; import "@opentelemetry/exporter-logs-otlp-http";';
      }
      return `
        import { bindLangfuseLifecycleTelemetry, createLangfuseTelemetry } from "@recallnet/factory-telemetry";
        import { createRuntimeRedisTelemetrySink } from "./pipeline/redis-telemetry.js";
      `;
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("reactor_collector_custom_transport_import")));
});

test("reactor collector contract fails missing helper import", () => {
  const analysis = analyzeReactorCollectorContract({
    files: ["apps/hatch/src/cli.ts", "apps/hatch/src/server/server.ts"],
    fileExists() {
      return true;
    },
    readFile(path) {
      if (path.endsWith("otel-collector.yaml")) {
        return "receivers:\n  otlp:\nprocessors:\n  batch:\nexporters:\n  debug:\nservice:\n  pipelines:\n";
      }
      if (path.endsWith("otel-stdout.ts")) {
        return 'import "@opentelemetry/sdk-logs"; import "@opentelemetry/exporter-logs-otlp-http";';
      }
      return "import { EventBus } from '@recallnet/factory-telemetry';";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("reactor_collector_helper_missing")));
});

test("reactor collector contract fails manual OTLP transport", () => {
  const analysis = analyzeReactorCollectorContract({
    files: ["apps/hatch/src/cli.ts", "apps/hatch/src/server/server.ts"],
    fileExists() {
      return true;
    },
    readFile(path) {
      if (path.endsWith("otel-collector.yaml")) {
        return "receivers:\n  otlp:\nprocessors:\n  batch:\nexporters:\n  debug:\nservice:\n  pipelines:\n";
      }
      if (path.endsWith("otel-stdout.ts")) {
        return "async function send() { await fetch(endpoint, { body: JSON.stringify({ resourceLogs: [], scopeLogs: [] }) }); }";
      }
      return "import { createReactorInstrumentationHelpers } from './pipeline/reactor-instrumentation.js';";
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("reactor_collector_manual_otlp_transport")));
});

test("reactor collector contract passes collector-backed control-plane routing", () => {
  const analysis = analyzeReactorCollectorContract({
    files: ["apps/hatch/src/cli.ts", "apps/hatch/src/server/server.ts"],
    fileExists() {
      return true;
    },
    readFile(path) {
      if (path.endsWith("otel-collector.yaml")) {
        return "receivers:\n  otlp:\nprocessors:\n  batch:\nexporters:\n  debug:\nservice:\n  pipelines:\n";
      }
      if (path.endsWith("otel-stdout.ts")) {
        return 'import "@opentelemetry/sdk-logs"; import "@opentelemetry/exporter-logs-otlp-http";';
      }
      return "import { createReactorInstrumentationHelpers } from './pipeline/reactor-instrumentation.js';";
    },
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.helper_consumer_files, 2);
});

test("reactor collector contract can skip report drift enforcement for staged scope", () => {
  const analysis = analyzeReactorCollectorContract({
    files: ["apps/hatch/src/cli.ts", "apps/hatch/src/server/server.ts"],
    expectedJson: '{"drift":true}\n',
    expectedMarkdown: "# drift\n",
    enforceReportDrift: false,
    fileExists() {
      return true;
    },
    readFile(path) {
      if (path.endsWith("otel-collector.yaml")) {
        return "receivers:\n  otlp:\nprocessors:\n  batch:\nexporters:\n  debug:\nservice:\n  pipelines:\n";
      }
      if (path.endsWith("otel-stdout.ts")) {
        return 'import "@opentelemetry/sdk-logs"; import "@opentelemetry/exporter-logs-otlp-http";';
      }
      return "import { createReactorInstrumentationHelpers } from './pipeline/reactor-instrumentation.js';";
    },
  });

  assert.equal(analysis.ok, true);
  assert.ok(!analysis.diagnostics.includes("reactor_collector_contract_json_drift"));
  assert.ok(!analysis.diagnostics.includes("reactor_collector_contract_markdown_drift"));
});

test("reactor collector analysis completes on the real control-plane cli entrypoint", () => {
  const analysis = analyzeReactorCollectorContract({
    files: ["apps/hatch/src/cli.ts"],
    fileExists(path) {
      return path === "packages/factory-telemetry/config/otel-collector.yaml"
        || path === "apps/hatch/src/pipeline/reactor-instrumentation.ts"
        || path === "packages/factory-telemetry/src/otel-stdout.ts";
    },
    readFile(path) {
      return readFileSync(path, "utf8");
    },
    enforceReportDrift: false,
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.helper_consumer_files, 1);
});
