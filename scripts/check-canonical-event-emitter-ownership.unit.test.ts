import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkCanonicalEventEmitterOwnership } from "./check-canonical-event-emitter-ownership.ts";

test("canonical event emitter ownership gate rejects prompt-surface violations", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-emitter-ownership-"));
  const forbiddenFile = path.join(repoRoot, "apps", "hatch", "src", "pipeline", "handler", "manager.ts");
  mkdirSync(path.dirname(forbiddenFile), { recursive: true });
  writeFileSync(
    forbiddenFile,
    "import { buildIssueCreatedEvent } from '../../../../../../packages/factory-ops/src/lib/canonical-domain-events.ts';\nvoid buildIssueCreatedEvent;\n",
    "utf8",
  );

  try {
    const result = checkCanonicalEventEmitterOwnership({
      repoRoot,
      files: [forbiddenFile],
    });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0], /canonical_event_emitter_forbidden_in_prompt_surface/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("canonical event emitter ownership gate allows deterministic command owners", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-emitter-ownership-"));
  const allowedFile = path.join(repoRoot, "packages", "factory-ops", "src", "commands", "factory-control-state.mjs");
  mkdirSync(path.dirname(allowedFile), { recursive: true });
  writeFileSync(
    allowedFile,
    "import { buildControlActionAppliedEvent } from '../lib/canonical-domain-events.ts';\nvoid buildControlActionAppliedEvent;\n",
    "utf8",
  );

  try {
    const result = checkCanonicalEventEmitterOwnership({
      repoRoot,
      files: [allowedFile],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
