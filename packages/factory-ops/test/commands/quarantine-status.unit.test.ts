import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quarantineStatus } from "../../src/commands/quarantine-status.ts";

// Helper: build a ghJsonFn that returns the given issues and per-issue comments
function buildGhJsonFn(issues, commentsByNumber = {}) {
  return (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") return issues;
    if (args[0] === "api") {
      const urlArg = args[1] || "";
      const m = urlArg.match(/issues\/(\d+)\/comments/);
      if (m) return commentsByNumber[m[1]] || [];
    }
    return fallback;
  };
}

describe("quarantineStatus", () => {
  it("reads failure_count from WAVE-QUARANTINE plain-text format (the format wave-handle-review-failures actually writes)", () => {
    const until = Math.floor(Date.now() / 1000) + 3600;
    const ghJsonFn = buildGhJsonFn(
      [{ number: 100, title: "Flaky issue" }],
      {
        100: [
          { body: `Applied deterministic cooldown after repeated review failures. WAVE-QUARANTINE: until=${until} reason=repeat_review_failure count=5` },
        ],
      },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.equal(result.quarantined_count, 1);
    assert.equal(result.issues[0].number, 100);
    assert.equal(result.issues[0].failure_count, 5, "should read count from WAVE-QUARANTINE plain text");
    assert.ok(result.issues[0].cooldown_remaining_minutes > 0, "should compute remaining cooldown");
  });

  it("reads failure_count from WAVE-REVIEW-FAILURE comment when no WAVE-QUARANTINE comment exists", () => {
    const ghJsonFn = buildGhJsonFn(
      [{ number: 200, title: "Review-failed issue" }],
      {
        200: [
          { body: "Review failed after attempts:\n\nMissing impl_result payload.\n\nResume policy: ...\n\nWAVE-REVIEW-FAILURE: count=3 note_hash=abc123" },
        ],
      },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.equal(result.issues[0].failure_count, 3, "should read count from WAVE-REVIEW-FAILURE marker");
  });

  it("prefers WAVE-QUARANTINE count over WAVE-REVIEW-FAILURE count when both exist", () => {
    const until = Math.floor(Date.now() / 1000) + 3600;
    const ghJsonFn = buildGhJsonFn(
      [{ number: 300, title: "Both formats" }],
      {
        300: [
          { body: "WAVE-REVIEW-FAILURE: count=2 note_hash=abc123" },
          { body: `WAVE-QUARANTINE: until=${until} reason=repeat_review_failure count=5` },
          { body: "WAVE-REVIEW-FAILURE: count=6 note_hash=abc123" },
        ],
      },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    // The most recent WAVE-REVIEW-FAILURE has count=6, which is higher than WAVE-QUARANTINE count=5
    assert.equal(result.issues[0].failure_count, 6, "should use highest count from any marker");
  });

  it("reads review_notes from WAVE-REVIEW-FAILURE comments", () => {
    const ghJsonFn = buildGhJsonFn(
      [{ number: 400, title: "Issue with notes" }],
      {
        400: [
          { body: "Review failed after attempts:\n\nMissing impl_result payload from issue execution; marked failed to prevent loop.\n\nResume policy: ...\n\nWAVE-REVIEW-FAILURE: count=4 note_hash=abc123" },
        ],
      },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.ok(result.issues[0].review_notes, "should include review_notes");
    assert.match(result.issues[0].review_notes, /Missing impl_result/, "should extract the failure reason");
  });

  it("returns empty result when no quarantined issues exist", () => {
    const ghJsonFn = buildGhJsonFn([]);
    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.equal(result.quarantined_count, 0);
    assert.deepEqual(result.issues, []);
  });

  it("handles issues with no failure comments gracefully", () => {
    const ghJsonFn = buildGhJsonFn(
      [{ number: 500, title: "No comments" }],
      { 500: [{ body: "Some random comment" }] },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.equal(result.quarantined_count, 1);
    assert.equal(result.issues[0].number, 500);
    assert.equal(result.issues[0].failure_count, 0);
  });

  it("computes cooldown from epoch-based WAVE-QUARANTINE until field", () => {
    // Cooldown expired
    const pastUntil = Math.floor(Date.now() / 1000) - 3600;
    const ghJsonFn = buildGhJsonFn(
      [{ number: 600, title: "Expired cooldown" }],
      {
        600: [
          { body: `WAVE-QUARANTINE: until=${pastUntil} reason=repeat_review_failure count=3` },
        ],
      },
    );

    const result = quarantineStatus({ repo: "o/r", ghJsonFn });
    assert.equal(result.issues[0].cooldown_remaining_minutes, 0, "expired cooldown should be 0");
  });
});
