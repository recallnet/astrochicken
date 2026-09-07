import assert from "node:assert/strict";
import test from "node:test";

import { bumpBrainstormRound } from "../../src/commands/brainstorm-bump-round.ts";

test("bumpBrainstormRound increments round and continues by default", () => {
  const out = bumpBrainstormRound({ round: "0", maxRounds: "10" });
  assert.equal(out.round, "1");
  assert.equal(out.has_next, "true");
  assert.equal(out.at_limit, "false");
  assert.equal(out.termination_reason, "continue");
});

test("bumpBrainstormRound signals at_limit on penultimate round", () => {
  const out = bumpBrainstormRound({ round: "8", maxRounds: "10" });
  assert.equal(out.round, "9");
  assert.equal(out.has_next, "true");
  assert.equal(out.at_limit, "false");
});

test("bumpBrainstormRound stops at max round ceiling", () => {
  const out = bumpBrainstormRound({ round: "9", maxRounds: "10" });
  assert.equal(out.round, "10");
  assert.equal(out.has_next, "false");
  assert.equal(out.at_limit, "true");
  assert.equal(out.termination_reason, "max_rounds_reached");
});

test("bumpBrainstormRound stops when already at ceiling", () => {
  const out = bumpBrainstormRound({ round: "10", maxRounds: "10" });
  assert.equal(out.round, "10");
  assert.equal(out.has_next, "false");
  assert.equal(out.at_limit, "true");
  assert.equal(out.termination_reason, "max_rounds_reached");
});

test("bumpBrainstormRound fails on invalid round", () => {
  assert.throws(() => {
    bumpBrainstormRound({ round: "-1", maxRounds: "10" });
  }, /invalid_round/);
});

test("bumpBrainstormRound fails on invalid max_rounds", () => {
  assert.throws(() => {
    bumpBrainstormRound({ round: "0", maxRounds: "0" });
  }, /invalid_max_rounds/);
});

test("bumpBrainstormRound defaults maxRounds to 10", () => {
  const out = bumpBrainstormRound({ round: "0" });
  assert.equal(out.round, "1");
  assert.equal(out.has_next, "true");
});
