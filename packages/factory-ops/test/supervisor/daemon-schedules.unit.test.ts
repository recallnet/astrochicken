import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateScheduledJob,
  findLatestMatchingScheduleSlot,
} from "../../src/lib/daemon-schedules.ts";

function computeWindow({ scheduledAt = "", hours = 24 } = {}) {
  const end = new Date(scheduledAt).toISOString();
  const start = new Date(new Date(scheduledAt).getTime() - (hours * 60 * 60 * 1000)).toISOString();
  return { start, end };
}

test("findLatestMatchingScheduleSlot resolves 08:45 America/Denver on a normal day and preserves trailing 24h handoff", () => {
  const slot = findLatestMatchingScheduleSlot({
    cron: "45 8 * * *",
    timeZone: "America/Denver",
    now: "2026-01-16T16:00:00.000Z",
    lookbackMinutes: 24 * 60,
  });

  assert.equal(slot, "2026-01-16T15:45:00.000Z");

  const window = computeWindow({ scheduledAt: slot, hours: 24 });
  assert.equal(window.end, "2026-01-16T15:45:00.000Z");
  assert.equal(window.start, "2026-01-15T15:45:00.000Z");
});

test("findLatestMatchingScheduleSlot resolves 08:45 America/Denver across DST start and keeps a deterministic 24h window", () => {
  const slot = findLatestMatchingScheduleSlot({
    cron: "45 8 * * *",
    timeZone: "America/Denver",
    now: "2026-03-08T14:50:00.000Z",
    lookbackMinutes: 24 * 60,
  });

  assert.equal(slot, "2026-03-08T14:45:00.000Z");

  const window = computeWindow({ scheduledAt: slot, hours: 24 });
  assert.equal(window.end, "2026-03-08T14:45:00.000Z");
  assert.equal(window.start, "2026-03-07T14:45:00.000Z");
});

test("evaluateScheduledJob marks one run per slot and is idempotent after a ledger entry exists", () => {
  const due = evaluateScheduledJob({
    job: {
      id: "daily-lens",
      cron: "45 8 * * *",
      time_zone: "America/Denver",
      catch_up: true,
    },
    now: "2026-03-15T14:49:00.000Z",
    state: {
      last_scheduled_at: "2026-03-14T14:45:00.000Z",
      last_status: "ok",
    },
  });

  assert.equal(due.due, true);
  assert.equal(due.scheduled_at, "2026-03-15T14:45:00.000Z");

  const alreadyRan = evaluateScheduledJob({
    job: {
      id: "daily-lens",
      cron: "45 8 * * *",
      time_zone: "America/Denver",
      catch_up: true,
    },
    now: "2026-03-15T14:54:00.000Z",
    state: {
      last_scheduled_at: "2026-03-15T14:45:00.000Z",
      last_status: "ok",
    },
  });

  assert.equal(alreadyRan.due, false);
  assert.equal(alreadyRan.reason, "already_ran_current_slot");
});

test("evaluateScheduledJob offers a missed slot as catch-up and clears catch-up after success", () => {
  const job = {
    id: "daily-lens",
    cron: "45 8 * * *",
    time_zone: "America/Denver",
    catch_up: true,
  };

  const catchUp = evaluateScheduledJob({
    job,
    now: "2026-03-15T14:20:00.000Z",
    state: {
      last_scheduled_at: "2026-03-13T14:45:00.000Z",
      last_status: "ok",
    },
  });

  assert.equal(catchUp.due, true);
  assert.equal(catchUp.scheduled_at, "2026-03-14T14:45:00.000Z");

  const caughtUp = evaluateScheduledJob({
    job,
    now: "2026-03-15T14:20:00.000Z",
    state: {
      last_scheduled_at: "2026-03-14T14:45:00.000Z",
      last_status: "ok",
    },
  });

  assert.equal(caughtUp.due, false);
  assert.equal(caughtUp.reason, "already_ran_current_slot");

  const nextSlot = evaluateScheduledJob({
    job,
    now: "2026-03-15T14:55:00.000Z",
    state: {
      last_scheduled_at: "2026-03-14T14:45:00.000Z",
      last_status: "ok",
    },
  });

  assert.equal(nextSlot.due, true);
  assert.equal(nextSlot.scheduled_at, "2026-03-15T14:45:00.000Z");
});
