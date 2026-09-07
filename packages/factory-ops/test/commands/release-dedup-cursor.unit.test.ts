import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readReleaseDedupCursor,
  writeReleaseDedupCursor,
  updateReleaseDedupCursorFromDelivery,
  RELEASE_DEDUP_CURSOR_SCHEMA,
} from "../../src/commands/release-dedup-cursor.ts";

test("readReleaseDedupCursor returns null when no cursor file exists", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor, null);
});

test("writeReleaseDedupCursor creates cursor file with atomic write", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const result = writeReleaseDedupCursor({
    factoryId: "mothership",
    rootDir: root,
    cursor: {
      last_reported_at: "2026-03-11T00:00:00.000Z",
      seen_goal_numbers: [1677, 1718],
      seen_issues: [1630, 1631],
      seen_prs: [445, 446],
    },
  });

  assert.equal(result.ok, true);
  assert.ok(existsSync(result.cursor_path));

  // Verify no .tmp file left behind
  assert.equal(existsSync(`${result.cursor_path}.tmp`), false);

  const raw = JSON.parse(readFileSync(result.cursor_path, "utf8"));
  assert.equal(raw.schema, RELEASE_DEDUP_CURSOR_SCHEMA);
  assert.equal(raw.factory_id, "mothership");
  assert.deepEqual(raw.seen_goal_numbers, [1677, 1718]);
  assert.deepEqual(raw.seen_issues, [1630, 1631]);
  assert.deepEqual(raw.seen_prs, [445, 446]);
});

test("readReleaseDedupCursor round-trips with writeReleaseDedupCursor", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  writeReleaseDedupCursor({
    factoryId: "test-factory",
    rootDir: root,
    cursor: {
      last_reported_at: "2026-03-11T01:00:00.000Z",
      seen_goal_numbers: [100, 200],
      seen_issues: [300],
      seen_prs: [400],
    },
  });

  const cursor = readReleaseDedupCursor({ factoryId: "test-factory", rootDir: root });
  assert.equal(cursor.schema, RELEASE_DEDUP_CURSOR_SCHEMA);
  assert.equal(cursor.last_reported_at, "2026-03-11T01:00:00.000Z");
  assert.deepEqual(cursor.seen_goal_numbers, [100, 200]);
  assert.deepEqual(cursor.seen_issues, [300]);
  assert.deepEqual(cursor.seen_prs, [400]);
});

test("readReleaseDedupCursor returns null for corrupt JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const cursorDir = join(root, ".hatch", "factories", "mothership");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "release-dedup-cursor.json"), "not json!", "utf8");

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor, null);
});

test("readReleaseDedupCursor returns null for wrong schema version", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const cursorDir = join(root, ".hatch", "factories", "mothership");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(
    join(cursorDir, "release-dedup-cursor.json"),
    JSON.stringify({ schema: "wrong/v1", seen_goals: [] }),
    "utf8",
  );

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor, null);
});

test("updateReleaseDedupCursorFromDelivery skips on non-delivered status", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const result = updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: root,
    reportContext: { goals: [{ number: 1 }] },
    deliveryStatus: "skipped_no_outcomes",
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "skipped");
  assert.equal(readReleaseDedupCursor({ factoryId: "mothership", rootDir: root }), null);
});

test("updateReleaseDedupCursorFromDelivery persists cursor on delivered status", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const result = updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-11T02:00:00.000Z",
      goals: [{ number: 1718, wave_key: "goal-1718-wave-1" }, { number: 1677, wave_key: "goal-1677-wave-1" }],
      issues: [{ number: 1630 }],
      prs: [{ number: 445 }],
    },
    deliveryStatus: "delivered",
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "updated");
  assert.equal(result.seen_goal_numbers_count, 2);

  assert.equal(result.seen_issues_count, 1);
  assert.equal(result.seen_prs_count, 1);

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.deepEqual(cursor.seen_goal_numbers, [1677, 1718]);
});

test("writeReleaseDedupCursor persists last_release_sha and round-trips through read", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  writeReleaseDedupCursor({
    factoryId: "mothership",
    rootDir: root,
    cursor: {
      last_reported_at: "2026-03-19T20:00:00.000Z",
      last_release_sha: "abc123def456",
      seen_goal_numbers: [100],
      seen_issues: [200],
      seen_prs: [],
    },
  });

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor.last_release_sha, "abc123def456");
});

test("updateReleaseDedupCursorFromDelivery persists last_release_sha from report context", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-19T20:00:00.000Z",
      last_commit_sha: "deadbeef1234",
      goals: [],
      issues: [],
      prs: [],
    },
    deliveryStatus: "published",
  });

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.equal(cursor.last_release_sha, "deadbeef1234");
});

test("updateReleaseDedupCursorFromDelivery extracts status from JSON delivery result string", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const jsonDeliveryStatus = JSON.stringify({
    ok: true,
    status: "published",
    issue_number: 1332,
    issue_url: "https://github.com/example-org/example-trading/issues/1332",
    title: "Release Understanding Report — example-trading — 2026-03-20",
  });

  const result = updateReleaseDedupCursorFromDelivery({
    factoryId: "example-trading",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-20T01:53:00.000Z",
      goals: [{ number: 1187 }],
      issues: [{ number: 1327 }],
      prs: [],
    },
    deliveryStatus: jsonDeliveryStatus,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "updated", "cursor must update when deliveryStatus is a JSON string with status=published");

  const cursor = readReleaseDedupCursor({ factoryId: "example-trading", rootDir: root });
  assert.ok(cursor, "cursor must be persisted");
  assert.deepEqual(cursor.seen_goal_numbers, [1187]);
  assert.deepEqual(cursor.seen_issues, [1327]);
});

test("updateReleaseDedupCursorFromDelivery skips when JSON delivery result has non-delivered status", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));
  const jsonDeliveryStatus = JSON.stringify({
    ok: false,
    status: "failed",
    error: "missing_webhook_url",
  });

  const result = updateReleaseDedupCursorFromDelivery({
    factoryId: "example-trading",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-20T01:53:00.000Z",
      goals: [{ number: 1187 }],
      issues: [],
      prs: [],
    },
    deliveryStatus: jsonDeliveryStatus,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "skipped");
});

test("updateReleaseDedupCursorFromDelivery merges with existing cursor", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-cursor-"));

  // First delivery
  updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-11T01:00:00.000Z",
      goals: [{ number: 100, wave_key: "goal-100-wave-1" }],
      issues: [{ number: 200 }],
      prs: [{ number: 300 }],
    },
    deliveryStatus: "delivered",
  });

  // Second delivery: same goal (different wave — but deduped by number) + new goal
  updateReleaseDedupCursorFromDelivery({
    factoryId: "mothership",
    rootDir: root,
    reportContext: {
      generated_at: "2026-03-11T02:00:00.000Z",
      goals: [{ number: 100, wave_key: "goal-100-wave-2" }, { number: 101, wave_key: "goal-101-wave-1" }],
      issues: [{ number: 201 }],
      prs: [{ number: 300 }, { number: 301 }],
    },
    deliveryStatus: "delivered",
  });

  const cursor = readReleaseDedupCursor({ factoryId: "mothership", rootDir: root });
  assert.deepEqual(cursor.seen_goal_numbers, [100, 101]);
  assert.deepEqual(cursor.seen_issues, [200, 201]);
  assert.deepEqual(cursor.seen_prs, [300, 301]);
  assert.equal(cursor.last_reported_at, "2026-03-11T02:00:00.000Z");
});
