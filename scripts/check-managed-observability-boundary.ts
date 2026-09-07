#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertPayloadWithinBoundary,
  sanitizeMirroredPayload,
} from "../packages/factory-ops/src/lib/managed-observability-boundary.ts";

const TELEMETRY_PREFIX = "managed-observability-boundary-contract";
const DEFAULT_FIXTURE_SUMMARY = "scripts/fixtures/managed-factory-observability-boundary/summary.json";
const DEFAULT_FIXTURE_CONTRACT = "scripts/fixtures/managed-factory-observability-boundary/contract.json";

function trim(value = "") {
  return String(value ?? "").trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildTelemetry({ ok, violationsCount }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok violations=0`;
  }
  return `[${TELEMETRY_PREFIX}] result=fail violations=${Math.max(0, Number(violationsCount) || 0)}`;
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    summaryPath: DEFAULT_FIXTURE_SUMMARY,
    contractPath: DEFAULT_FIXTURE_CONTRACT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifests") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--manifests requires a path");
      }
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--summary") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--summary requires a path");
      }
      options.summaryPath = value;
      index += 1;
      continue;
    }

    if (arg === "--contract") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--contract requires a path");
      }
      options.contractPath = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return "Usage: node scripts/check-managed-observability-boundary.ts [--manifests <path>] [--summary <path>] [--contract <path>]";
}

function normalizeContract(contract = {}, diagnostics = []) {
  if (!isPlainObject(contract)) {
    diagnostics.push("invalid_contract reason=contract_must_be_json_object");
    return {
      allowedKeys: [],
      forbiddenKeys: [],
      requiredTopLevelKeys: [],
    };
  }

  const allowedKeys = Array.isArray(contract.allowed_keys)
    ? [...new Set(contract.allowed_keys.map((key) => trim(key)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "en"))
    : [];

  const forbiddenKeys = Array.isArray(contract.forbidden_keys)
    ? [...new Set(contract.forbidden_keys.map((key) => trim(key)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "en"))
    : [];

  const requiredTopLevelKeys = Array.isArray(contract.required_top_level_keys)
    ? [...new Set(contract.required_top_level_keys.map((key) => trim(key)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "en"))
    : [];

  if (allowedKeys.length === 0) {
    diagnostics.push("invalid_contract reason=missing_allowed_keys");
  }

  if (forbiddenKeys.length === 0) {
    diagnostics.push("invalid_contract reason=missing_forbidden_keys");
  }

  return {
    allowedKeys,
    forbiddenKeys,
    requiredTopLevelKeys,
  };
}

export function validateManagedObservabilityBoundary({
  manifestsRoot = process.cwd(),
  summaryPath = DEFAULT_FIXTURE_SUMMARY,
  contractPath = DEFAULT_FIXTURE_CONTRACT,
} = {}) {
  const repoRoot = resolve(manifestsRoot);
  const diagnostics = [];

  const resolvedSummaryPath = resolve(repoRoot, summaryPath);
  const resolvedContractPath = resolve(repoRoot, contractPath);

  if (!existsSync(resolvedSummaryPath)) {
    diagnostics.push(`missing_fixture file=${resolvedSummaryPath}`);
  }
  if (!existsSync(resolvedContractPath)) {
    diagnostics.push(`missing_contract file=${resolvedContractPath}`);
  }

  let summary = {};
  let contract = {};

  if (diagnostics.length === 0) {
    try {
      summary = readJson(resolvedSummaryPath);
    } catch (error) {
      diagnostics.push(`invalid_fixture_json file=${resolvedSummaryPath} message=${String(error?.message || error)}`);
    }

    try {
      contract = readJson(resolvedContractPath);
    } catch (error) {
      diagnostics.push(`invalid_contract_json file=${resolvedContractPath} message=${String(error?.message || error)}`);
    }
  }

  const normalizedContract = normalizeContract(contract, diagnostics);

  if (diagnostics.length === 0 && !isPlainObject(summary)) {
    diagnostics.push("invalid_fixture reason=summary_must_be_json_object");
  }

  if (diagnostics.length === 0) {
    for (const topLevelKey of normalizedContract.requiredTopLevelKeys) {
      if (!(topLevelKey in summary)) {
        diagnostics.push(`missing_required_top_level_key key=${topLevelKey}`);
      }
    }

    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload(summary, {
      allowedKeys: normalizedContract.allowedKeys,
      forbiddenKeys: normalizedContract.forbiddenKeys,
    });

    if (droppedKeys.length > 0) {
      diagnostics.push(...droppedKeys.map((path) => `fixture_not_sanitized path=${path}`));
    }

    if (JSON.stringify(sanitizedPayload) !== JSON.stringify(summary)) {
      diagnostics.push("fixture_not_sanitized reason=sanitizer_changed_fixture");
    }

    try {
      assertPayloadWithinBoundary(summary, {
        allowedKeys: normalizedContract.allowedKeys,
        forbiddenKeys: normalizedContract.forbiddenKeys,
      });
    } catch (error) {
      const violations = Array.isArray(error?.violations)
        ? error.violations
        : [`unknown_violation message=${trim(error?.message || error)}`];
      diagnostics.push(...violations);
    }
  }

  const sortedDiagnostics = [...new Set(diagnostics)]
    .sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    diagnostics: sortedDiagnostics,
    telemetry: buildTelemetry({ ok, violationsCount: sortedDiagnostics.length }),
    summaryPath: resolvedSummaryPath,
    contractPath: resolvedContractPath,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateManagedObservabilityBoundary({
    manifestsRoot: options.repoRoot,
    summaryPath: options.summaryPath,
    contractPath: options.contractPath,
  });

  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.stderr.write(`${result.telemetry}\n`);
    process.exit(1);
    return;
  }

  process.stdout.write(`${result.telemetry}\n`);
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.stderr.write(`${buildTelemetry({ ok: false, violationsCount: 1 })}\n`);
    process.exit(1);
  }
}
