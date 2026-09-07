import assert from "node:assert/strict";
import test from "node:test";

import {
  compareReleases,
  isReleaseSatisfied,
  computeLinkageKey,
  parseLinkagePayload,
  evaluateResumeGateFromLinkage,
  evaluateResumeGateFromManifestEntry,
} from "../../src/commands/artifact-linkage.ts";

test("compareReleases compares semantic versions", () => {
  assert.equal(compareReleases("1.2.3", "1.2.3"), 0);
  assert.equal(compareReleases("1.3.0", "1.2.9") > 0, true);
  assert.equal(compareReleases("1.2.0", "1.2.1") < 0, true);
});

test("isReleaseSatisfied honors required floor", () => {
  assert.equal(isReleaseSatisfied({ localFactoryRelease: "1.2.3", requiredFactoryRelease: "1.2.0" }), true);
  assert.equal(isReleaseSatisfied({ localFactoryRelease: "1.2.3", requiredFactoryRelease: "1.2.3" }), true);
  assert.equal(isReleaseSatisfied({ localFactoryRelease: "1.2.3", requiredFactoryRelease: "1.3.0" }), false);
});

test("computeLinkageKey is deterministic", () => {
  const a = computeLinkageKey({ sourceRepo: "x/y", sourceIssueNumber: 42, signature: "sha256:abc" });
  const b = computeLinkageKey({ sourceRepo: "x/y", sourceIssueNumber: 42, signature: "sha256:abc" });
  assert.equal(a, b);
  assert.match(a, /^sha256:/);
});

test("parseLinkagePayload enforces factory_link.v1 schema", () => {
  const ok = parseLinkagePayload(JSON.stringify({ schema_version: "factory_link.v1", control_plane_goal: 123 }));
  assert.equal(ok?.schema_version, "factory_link.v1");

  const bad = parseLinkagePayload(JSON.stringify({ schema_version: "factory_link.v2", control_plane_goal: 123 }));
  assert.equal(bad, null);
});

test("evaluateResumeGateFromLinkage returns missing_linkage_record without payload", () => {
  const out = evaluateResumeGateFromLinkage({ linkage: null, sourceRepo: "x/y", sourceIssueNumber: 12 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "missing_linkage_record");
});

test("evaluateResumeGateFromManifestEntry reuses linkage schema and resume semantics", () => {
  const out = evaluateResumeGateFromManifestEntry({
    manifestEntry: {
      source_repo: "example/external-factory",
      source_issue: 88,
      source_issue_url: "https://example/88",
      linkage: {
        schema_version: "factory_link.v1",
        source_repo: "example/external-factory",
        source_issue: 88,
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 500,
        signature_hash: "sha256:abc",
        factory_id: "external/issue_worker",
        required_factory_release: "1.2.0",
      },
    },
    localFactoryRelease: "1.3.0",
    checkResumeGateFn: () => ({
      ok: true,
      can_resume: true,
      reason: "ready_to_resume",
      goal: { number: 500, state: "CLOSED", url: "https://example/goal/500", title: "Goal" },
      local_factory_release: "1.3.0",
      required_factory_release: "1.2.0",
    }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.can_resume, true);
  assert.equal(out.reason, "ready_to_resume");
  assert.equal(out.linkage.schema_version, "factory_link.v1");
});

test("evaluateResumeGateFromManifestEntry returns missing_manifest_linkage without linkage", () => {
  const out = evaluateResumeGateFromManifestEntry({
    manifestEntry: {
      source_repo: "example/external-factory",
      source_issue: 88,
      source_issue_url: "https://example/88",
    },
    localFactoryRelease: "1.3.0",
  });

  assert.equal(out.ok, false);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "missing_manifest_linkage");
});

test("evaluateResumeGateFromManifestEntry fails closed on invalid linkage schema", () => {
  const out = evaluateResumeGateFromManifestEntry({
    manifestEntry: {
      source_repo: "example/external-factory",
      source_issue: 88,
      source_issue_url: "https://example/88",
      linkage: {
        schema_version: "factory_link.v2",
        source_repo: "example/external-factory",
        source_issue: 88,
      },
    },
    localFactoryRelease: "1.3.0",
  });

  assert.equal(out.ok, false);
  assert.equal(out.can_resume, false);
  assert.equal(out.reason, "invalid_manifest_linkage");
});
