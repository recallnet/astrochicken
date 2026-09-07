import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runRationaleDocsCheck,
  validateRationaleDoc,
} from "./docs-check-rationale-docs.mjs";

function writeRepoFile(root, relativePath, content) {
  const fullPath = join(root, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), "rationale-doc-check-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
  return root;
}

function validRationaleDoc() {
  return `---
doc_type: architecture
owner: factory
status: draft
last_updated: 2026-03-19
summary: Explain the durable routing change for future maintainers.
tags: [rationale]
---

## What Changed
The routing contract now persists understanding risk in [goal-execution-path.mjs](/repo/packages/factory-ops/src/commands/goal-execution-path.ts) so downstream flows can append a rationale issue deterministically.

## Why Now
High-risk goals were shipping without durable explanation, which made later ownership and review materially harder.

## Subsystem Map
This touches [goal-execution-path-packet.mjs](/repo/packages/factory-ops/src/lib/goal-execution-path-packet.ts), the goal decomposition graph, and the docs check pipeline.

## Assumptions
The execution-path classifier continues to produce stable routing signals, and hard-path goals remain the conservative default for rationale-required work.

## Known Unknowns
We have not yet tightened the upstream classifier prompt to emit understanding risk directly, so current rollout derives from existing routing and signals.

## What Future Humans Need To Know
If a high-risk goal decomposes without a rationale issue, inspect the execution-path packet first because that is now the canonical owner of the requirement.

## Verification
Focused tests cover packet metadata, hard-plan materialization, and the docs rationale checker contract.

## Follow-ups
Tighten the classifier prompt and extend Daily Lens to surface rationale coverage once the doc path is stable.
`;
}

test("validateRationaleDoc accepts a fully structured rationale doc", () => {
  const report = validateRationaleDoc({
    path: "docs/rationale/2026-03-19-routing-contract.md",
    markdown: validRationaleDoc(),
  });
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics, null, 2));
});

test("validateRationaleDoc rejects malformed rationale docs deterministically", () => {
  const report = validateRationaleDoc({
    path: "docs/rationale/bad-name.md",
    markdown: `---
doc_type: architecture
owner: factory
status: draft
last_updated: 2026-03-19
summary: TBD
tags: [rationale, extra]
---

## What Changed
TBD

## Why Now
various changes
`,
  });

  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some((entry) => entry.code === "rationale.invalid_filename"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "rationale.invalid_tags"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "rationale.missing_heading"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "rationale.banned_phrase"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "rationale.missing_concrete_ref"));
});

test("runRationaleDocsCheck scans tracked rationale docs inside the repo", () => {
  const repo = initRepo();
  writeRepoFile(repo, "docs/rationale/2026-03-19-routing-contract.md", validRationaleDoc());
  execFileSync("git", ["add", "docs/rationale/2026-03-19-routing-contract.md"], { cwd: repo, stdio: "ignore" });

  const report = runRationaleDocsCheck({ cwd: repo });
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics, null, 2));
  assert.equal(report.file_count, 1);
});
