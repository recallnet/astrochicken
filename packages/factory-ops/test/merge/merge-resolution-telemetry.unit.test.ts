import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emitResolutionFailure,
  countResolutionFailures,
} from "../../src/commands/merge-item-ops.ts";

const RECURRENCE_KEY = "wave_execute::set_resolution_source_llm::merge_conflict_llm_resolution";

test("emitResolutionFailure appends one ndjson event under factory events dir", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-resolution-telemetry-"));
  const runsDir = join(root, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  const out = emitResolutionFailure({
    recurrenceKey: RECURRENCE_KEY,
    resolutionNotes: "Unmerged paths remain: file.txt",
    resolutionCheck: "verify-resolution returned unresolved",
    branch: "wave/goal-1730-wave-1",
    issue: "1748",
    runId: "run-1748",
    factoryId: "mothership",
    runsDir,
  });

  const eventsPath = join(root, ".hatch", "mothership", "events", "merge_conflict_resolution_failures.ndjson");
  assert.equal(existsSync(eventsPath), true);

  const lines = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);

  const event = JSON.parse(lines[0]);
  assert.equal(out.event, "merge_conflict_llm_resolution_failure");
  assert.equal(event.recurrence_key, RECURRENCE_KEY);
  assert.equal(event.resolution_notes, "Unmerged paths remain: file.txt");
  assert.equal(event.resolution_check, "verify-resolution returned unresolved");
  assert.equal(event.branch, "wave/goal-1730-wave-1");
  assert.equal(event.issue, "1748");
  assert.equal(event.run_id, "run-1748");
  assert.equal(event.factory_id, "mothership");
  assert.match(String(event.timestamp || ""), /^\d{4}-\d{2}-\d{2}T/);
});

test("countResolutionFailures returns count_24h and last_occurrence for matching recurrence key", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-resolution-telemetry-"));
  const eventsDir = join(root, ".hatch", "mothership", "events");
  mkdirSync(eventsDir, { recursive: true });
  const filePath = join(eventsDir, "merge_conflict_resolution_failures.ndjson");

  const now = Date.now();
  const oldTs = new Date(now - (72 * 60 * 60 * 1000)).toISOString();
  const inWindowA = new Date(now - (2 * 60 * 60 * 1000)).toISOString();
  const inWindowB = new Date(now - (30 * 60 * 1000)).toISOString();

  const payload = [
    {
      event: "merge_conflict_llm_resolution_failure",
      recurrence_key: RECURRENCE_KEY,
      timestamp: oldTs,
    },
    {
      event: "merge_conflict_llm_resolution_failure",
      recurrence_key: RECURRENCE_KEY,
      timestamp: inWindowA,
    },
    {
      event: "merge_conflict_llm_resolution_failure",
      recurrence_key: "different::key",
      timestamp: inWindowB,
    },
    {
      event: "merge_conflict_llm_resolution_failure",
      recurrence_key: RECURRENCE_KEY,
      timestamp: inWindowB,
    },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";

  writeFileSync(filePath, payload, "utf8");

  const out = countResolutionFailures({
    recurrenceKey: RECURRENCE_KEY,
    lookbackHours: 24,
    factoryId: "mothership",
    runsDir: join(root, ".hatch", "mothership", "runs"),
  });

  assert.equal(out.recurrence_key, RECURRENCE_KEY);
  assert.equal(out.count_24h, 2);
  assert.equal(out.last_occurrence, inWindowB);
});

test("countResolutionFailures returns zero shape when telemetry file does not exist", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-resolution-telemetry-"));
  const out = countResolutionFailures({
    recurrenceKey: RECURRENCE_KEY,
    lookbackHours: 24,
    factoryId: "mothership",
    runsDir: join(root, ".hatch", "mothership", "runs"),
  });

  assert.deepEqual(out, {
    recurrence_key: RECURRENCE_KEY,
    count_24h: 0,
    last_occurrence: null,
  });
});

test("countResolutionFailures reads events written by emitResolutionFailure", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-resolution-roundtrip-"));
  const runsDir = join(root, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });
  emitResolutionFailure({
    recurrenceKey: RECURRENCE_KEY,
    resolutionNotes: "fixture unresolved conflict",
    factoryId: "mothership",
    runsDir,
  });
  const out = countResolutionFailures({ recurrenceKey: RECURRENCE_KEY, factoryId: "mothership", runsDir });
  assert.equal(out.count_24h, 1);
  assert.match(out.last_occurrence, /^\d{4}-\d{2}-\d{2}T/);
});
