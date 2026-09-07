import test from "node:test";
import assert from "node:assert/strict";
import { chooseCanonicalMilestone, ensureMilestone } from "../src/commands/triage-ensure-milestone.ts";

test("chooseCanonicalMilestone prefers open and lowest number", () => {
  const out = chooseCanonicalMilestone([
    { number: 20, title: "x", state: "closed" },
    { number: 19, title: "x", state: "open" },
    { number: 18, title: "x", state: "open" },
  ]);
  assert.equal(out.number, 18);
});

test("ensureMilestone reuses existing milestone without creating duplicate", () => {
  const calls = { create: 0, update: 0 };
  const out = ensureMilestone({
    repo: "o/r",
    title: "goal-1-wave-1",
    description: "d",
    client: {
      listByTitle: () => [{ number: 7, title: "goal-1-wave-1", state: "open" }],
      create: () => { calls.create += 1; return { ok: false }; },
      update: () => { calls.update += 1; },
    },
  });
  assert.equal(out.title, "goal-1-wave-1");
  assert.equal(out.created, false);
  assert.equal(calls.create, 0);
  assert.equal(calls.update, 1);
});

test("ensureMilestone reopens closed milestone so dispatch can see it", () => {
  let reopened = false;
  const out = ensureMilestone({
    repo: "o/r",
    title: "goal-5-wave-1",
    description: "d",
    client: {
      listByTitle: () => [{ number: 12, title: "goal-5-wave-1", state: "closed" }],
      create: () => { throw new Error("should not create"); },
      reopen: (num) => { assert.equal(num, 12); reopened = true; },
      update: () => {},
    },
  });
  assert.equal(out.number, 12);
  assert.equal(out.created, false);
  assert.ok(reopened, "must reopen closed milestone");
});

test("ensureMilestone does not reopen already-open milestone", () => {
  let reopenCalled = false;
  ensureMilestone({
    repo: "o/r",
    title: "goal-6-wave-1",
    client: {
      listByTitle: () => [{ number: 13, title: "goal-6-wave-1", state: "open" }],
      create: () => { throw new Error("should not create"); },
      reopen: () => { reopenCalled = true; },
      update: () => {},
    },
  });
  assert.ok(!reopenCalled, "must not reopen an already-open milestone");
});

test("ensureMilestone handles create race with already_exists", () => {
  let listed = 0;
  const out = ensureMilestone({
    repo: "o/r",
    title: "goal-1-wave-2",
    description: "d",
    client: {
      listByTitle: () => {
        listed += 1;
        if (listed === 1) return [];
        return [{ number: 9, title: "goal-1-wave-2", state: "open" }];
      },
      create: () => ({ ok: false, errorCode: "already_exists" }),
      update: () => {},
    },
  });
  assert.equal(out.number, 9);
  assert.equal(out.created, false);
  assert.equal(out.duplicate_count, 0);
});
