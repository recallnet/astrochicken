import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReleaseNarrativeContract,
  assertReleaseReportContextContract,
  assertReleaseSlackPayloadContract,
  normalizeReleaseDeliveryStatusContract,
  RELEASE_NARRATIVE_DOCUMENT_DELIVERY_CONTRACT,
} from "../../../capability-release-reporting/src/release-action-contracts.ts";

test("release action contracts accept valid release report context", () => {
  const context = assertReleaseReportContextContract({
    repo: "acme/platform",
    factory_id: "mothership",
    generated_at: "2026-03-19T00:00:00.000Z",
    since_iso: "2026-03-18T00:00:00.000Z",
    goals: [],
    issues: [],
    prs: [],
    metrics: {},
    diff_stats: {},
    timing: {},
    errors: [],
  });

  assert.equal(context.repo, "acme/platform");
});

test("release action contracts reject invalid release report context", () => {
  assert.throws(() => assertReleaseReportContextContract({ repo: "acme/platform" }), /factory_id is required/);
});

test("release action contracts validate narrative and slack payloads", () => {
  assert.equal(assertReleaseNarrativeContract({ delivery_decision: "issue_only", warnings: [] }).delivery_decision, "issue_only");
  assert.equal(assertReleaseSlackPayloadContract({ blocks: [] }).blocks.length, 0);
  assert.deepEqual(normalizeReleaseDeliveryStatusContract({ status: "published", issue_url: "https://example.com" }), {
    status: "published",
    issue_url: "https://example.com",
  });
});

test("release action contracts expose release narrative document delivery contract id", () => {
  assert.equal(RELEASE_NARRATIVE_DOCUMENT_DELIVERY_CONTRACT, "release.narrative_document_delivery@v1");
});
