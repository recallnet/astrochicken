#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  buildFactoryLabelSnapshot,
  listFactoryIdsWithLabelOverlays,
  resolveFactoryLabelContract,
  validateFactoryLabelContract,
} from "../packages/factory-ops/src/lib/factory-label-contract.ts";

export const FACTORY_LABEL_CONTRACT_SNAPSHOT_PATH = "docs/contracts/factory-label-contract.json";

export const RAW_LABEL_BOUNDARY_ALLOWLIST = Object.freeze([
  "packages/factory-ops/src/lib/factory-label-contract.ts",
  "packages/factory-ops/src/cli/commands/labels.ts",
  "packages/factory-ops/src/commands/artifact-emit-issue.ts",
  "packages/factory-ops/src/commands/factory-outcomes.ts",
  "packages/factory-ops/src/commands/goal-auto-ready-artifacts.ts",
  "packages/factory-ops/src/cli/commands/brainstorm.ts",
  "packages/factory-ops/src/commands/brainstorm-next-issue.ts",
  "packages/factory-ops/src/commands/brainstorm-create-goal.ts",
  "packages/factory-ops/src/commands/research-stage-label.ts",
  "packages/factory-ops/src/commands/triage-apply-status.ts",
  "packages/factory-ops/src/commands/goal-final-state-review.ts",
  "packages/factory-ops/src/commands/goal-queue-ops.ts",
  "packages/factory-ops/src/commands/goal-sanitize-duplicates.ts",
  "packages/factory-ops/src/commands/goal-sweep-completed.ts",
  "packages/factory-ops/src/commands/human-blocker.ts",
  "packages/factory-ops/src/commands/observability-trace.ts",
  "packages/factory-ops/src/commands/quarantine-status.ts",
  "packages/factory-ops/src/commands/release-manifest.ts",
  "packages/factory-ops/src/commands/supervisor-artifact.ts",
  "packages/factory-ops/src/lib/command-owners/release-manifest.ts",
  "packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts",
  "packages/factory-ops/src/commands/supervisor-audit-blocked-labels.ts",
  "packages/factory-ops/src/commands/supervisor-close-merge-followups.ts",
  "packages/factory-ops/src/commands/supervisor-close-non-goals.ts",
  "packages/factory-ops/src/commands/supervisor-detect-orphan-features.ts",
  "packages/factory-ops/src/commands/supervisor-force-ops.ts",
  "packages/factory-ops/src/commands/supervisor-health-check.ts",
  "packages/factory-ops/src/commands/supervisor-merge-failure-metrics.ts",
  "packages/factory-ops/src/commands/supervisor-normalize-feature-labels.ts",
  "packages/factory-ops/src/commands/supervisor-sanitize-artifact-labels.ts",
  "packages/factory-ops/src/commands/supervisor-sanitize-goals.ts",
  "packages/factory-ops/src/commands/supervisor-state-collector.ts",
  "packages/factory-ops/src/commands/supervisor-state-snapshot.ts",
  "packages/factory-ops/src/commands/supervisor-state-snapshot-actions.ts",
  "packages/factory-ops/src/commands/supervisor-status.ts",
  "packages/factory-ops/src/commands/supervisor-update-priorities-from-merge-failures.ts",
]);

const LABEL_OPERATION_REGEX = /"--(?:label|add-label|remove-label)"\s*,\s*"([^"]+)"/g;
const DOT_GH_LABEL_CREATE_REGEX = /gh label create ([a-z0-9:-]+)/g;

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listKnownFactoryLabelNames() {
  const snapshot = buildFactoryLabelSnapshot();
  return new Set(
    snapshot.factories.flatMap((factory) => factory.labels.map((label) => String(label.name || "").trim())).filter(Boolean),
  );
}

export function collectRawLabelUsages(source = "") {
  const text = String(source || "");
  const matches = [];
  for (const regex of [LABEL_OPERATION_REGEX, DOT_GH_LABEL_CREATE_REGEX]) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      matches.push(String(match[1] || "").trim());
    }
  }
  return matches.filter(Boolean);
}

export function validateFactoryLabelCoverage({ fileExists = existsSync } = {}) {
  const results = listFactoryIdsWithLabelOverlays().map((factoryId) => validateFactoryLabelContract(factoryId));
  const errors = [];
  for (const result of results) {
    if (!result.ok) errors.push(...result.errors.map((error) => `${result.factory_id}:${error}`));
  }

  return { ok: errors.length === 0, errors };
}

export function validateFactoryLabelReaderWriterPaths({ fileExists = existsSync } = {}) {
  const errors = [];
  for (const factoryId of listFactoryIdsWithLabelOverlays()) {
    const contract = resolveFactoryLabelContract(factoryId);
    for (const spec of contract.labels) {
      if (spec.informational) continue;
      for (const path of [...spec.reader_paths, ...spec.writer_paths]) {
        if (!fileExists(path)) {
          errors.push(`missing_reader_writer_path:${factoryId}:${spec.key}:${path}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateFactoryLabelSnapshot({ snapshotPath = FACTORY_LABEL_CONTRACT_SNAPSHOT_PATH } = {}) {
  if (!existsSync(snapshotPath)) {
    return { ok: false, error: `missing_snapshot:${snapshotPath}` };
  }
  const actual = readJsonFile(snapshotPath);
  const expected = buildFactoryLabelSnapshot();
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    return { ok: false, error: `snapshot_drift:${snapshotPath}` };
  }
  return { ok: true, error: "" };
}

export function validateRawLabelBoundaries({ paths, readFile = (path) => readFileSync(path, "utf8") } = {}) {
  const knownLabels = listKnownFactoryLabelNames();
  const violations = [];

  for (const path of paths) {
    const source = String(readFile(path) || "");
    const usages = collectRawLabelUsages(source);
    if (usages.length === 0) continue;

    if (!RAW_LABEL_BOUNDARY_ALLOWLIST.includes(path)) {
      violations.push(`raw_label_boundary_violation:${path}`);
      continue;
    }

    for (const label of usages) {
      if (!knownLabels.has(label)) {
        violations.push(`undeclared_label_usage:${path}:${label}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function collectProductionPaths() {
  const raw = execFileSync("git", ["ls-files", "-z", "packages/factory-ops/src", "factories"], { encoding: "buffer" });
  const decoded = raw.toString("utf8").split("\0").filter(Boolean);
  return decoded.filter((path) =>
    existsSync(path)
    && (
      (path.startsWith("packages/factory-ops/src/") && (path.endsWith(".mjs") || path.endsWith(".ts")))
      || (path.startsWith("factories/") && path.includes("/graphs/") && path.endsWith(".dot"))
    ));
}

async function main() {
  const coverage = validateFactoryLabelCoverage();
  if (!coverage.ok) {
    coverage.errors.forEach((error) => console.error(error));
    console.error(`[factory-label-contract] result=fail errors=${coverage.errors.length}`);
    process.exit(1);
  }

  const snapshot = validateFactoryLabelSnapshot();
  if (!snapshot.ok) {
    console.error(snapshot.error);
    console.error("[factory-label-contract] result=fail errors=1");
    process.exit(1);
  }

  const pathCoverage = validateFactoryLabelReaderWriterPaths();
  if (!pathCoverage.ok) {
    pathCoverage.errors.forEach((error) => console.error(error));
    console.error(`[factory-label-contract] result=fail errors=${pathCoverage.errors.length}`);
    process.exit(1);
  }

  const boundaries = validateRawLabelBoundaries({ paths: collectProductionPaths() });
  if (!boundaries.ok) {
    boundaries.violations.forEach((violation) => console.error(violation));
    console.error(`[factory-label-contract] result=fail errors=${boundaries.violations.length}`);
    process.exit(1);
  }

  process.stdout.write("[factory-label-contract] result=ok errors=0\n");
}

const isEntryPoint = process.argv[1]
  ? new URL(`file://${process.argv[1]}`).href === import.meta.url
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error?.message || error);
    console.error("[factory-label-contract] result=fail errors=1");
    process.exit(1);
  });
}
