import assert from "node:assert/strict";
import test from "node:test";

import { createTestAdapter } from "../../../github-adapter/src/test-adapter.ts";

import { hasOpenPrerequisiteBlocker, listPrerequisiteBlockers } from "../../src/lib/prerequisite-blockers.ts";

test("listPrerequisiteBlockers returns parsed blocker nodes", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: () => [
        { number: 10, state: "OPEN" },
        { number: "11", state: "closed" },
      ],
    },
  });
  const result = listPrerequisiteBlockers({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, "");
  assert.deepEqual(result.blockers, [
    { number: 10, state: "OPEN" },
    { number: 11, state: "CLOSED" },
  ]);
});

test("listPrerequisiteBlockers handles empty blocker list", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: () => [],
    },
  });
  const result = listPrerequisiteBlockers({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, "");
  assert.deepEqual(result.blockers, []);
});

test("listPrerequisiteBlockers fails closed on malformed payload", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: () => {
        throw new Error("malformed");
      },
    },
  });
  const result = listPrerequisiteBlockers({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    adapter,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "failed_lookup");
  assert.deepEqual(result.blockers, []);
});

test("listPrerequisiteBlockers fails closed when GraphQL call throws", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: () => {
        throw new Error("graphql unavailable");
      },
    },
  });
  const result = listPrerequisiteBlockers({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    adapter,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "failed_lookup");
  assert.deepEqual(result.blockers, []);
});

test("hasOpenPrerequisiteBlocker reports open blockers only", () => {
  const result = hasOpenPrerequisiteBlocker({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    listPrerequisiteBlockersFn: () => ({
      ok: true,
      error: "",
      blockers: [
        { number: 50, state: "OPEN" },
        { number: 99, state: "CLOSED" },
        { number: 25, state: "OPEN" },
      ],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, "");
  assert.deepEqual(result.openBlockers, [25, 50]);
});

test("hasOpenPrerequisiteBlocker fails closed when lookup fails", () => {
  const result = hasOpenPrerequisiteBlocker({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    listPrerequisiteBlockersFn: () => ({
      ok: false,
      error: "failed_lookup",
      blockers: [],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "failed_lookup");
  assert.deepEqual(result.openBlockers, []);
});

test("listPrerequisiteBlockers uses adapter blockedBy seam when provided", () => {
  const adapter = createTestAdapter({
    repo: "recallnet/astrochicken",
    stubs: {
      issueBlockedBy: () => [
        { number: 10, state: "OPEN" },
        { number: "11", state: "closed" },
      ],
    },
  });

  const result = listPrerequisiteBlockers({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2396",
    adapter,
    ghJsonFn: () => {
      throw new Error("ghJson must not be called when adapter is provided");
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, [
    { number: 10, state: "OPEN" },
    { number: 11, state: "CLOSED" },
  ]);
  assert.equal(adapter.callsTo("issueBlockedBy").length, 1);
});
