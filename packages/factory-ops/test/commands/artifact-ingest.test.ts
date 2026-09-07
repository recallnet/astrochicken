import assert from "node:assert/strict";
import test from "node:test";

import {
  extractArtifactFromBody,
  sanitizeString,
  validateArtifactContract,
  safeObj,
  computeSignature,
  buildLinkagePayload,
  buildLinkageComment,
} from "../../src/commands/artifact-ingest.ts";

test("extractArtifactFromBody parses fenced json", () => {
  const body = "prefix\n```json\n{\n  \"summary\": \"x\",\n  \"kind\": \"blocker\"\n}\n```\nsuffix";
  const parsed = extractArtifactFromBody(body);
  assert.ok(parsed);
  assert.equal(parsed.kind, "blocker");
});

test("sanitizeString redacts token patterns and paths", () => {
  const raw = "token=ghp_abcdefghijklmnopqrstuvwxyz123456 /Users/alice/private/repo authorization: bearer abcdef";
  const out = sanitizeString(raw);
  assert.match(out, /\[REDACTED\]|\[REDACTED_TOKEN\]/);
  assert.match(out, /\[REDACTED_PATH\]/);
  assert.match(out, /authorization: bearer \[REDACTED\]/i);
});

test("validateArtifactContract enforces schema/identity allowlists", () => {
  const artifact = {
    schema_version: "artifact.v1",
    factory_id: "external/issue_worker",
    source_repo: "example/external-factory",
    run_id: "abc",
    summary: "blocked",
    goal_ingest: "true",
  };
  const ok = validateArtifactContract({
    artifact,
    sourceRepo: "example/external-factory",
    trustedSourceRepos: ["example/external-factory"],
    trustedFactoryIds: ["external/issue_worker"],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.reasons.length, 0);

  const bad = validateArtifactContract({
    artifact: { ...artifact, schema_version: "v0", factory_id: "evil/worker", source_repo: "other/repo" },
    sourceRepo: "example/external-factory",
    trustedSourceRepos: ["example/external-factory"],
    trustedFactoryIds: ["external/issue_worker"],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join(","), /invalid_schema_version/);
  assert.match(bad.reasons.join(","), /untrusted_factory_id/);
  assert.match(bad.reasons.join(","), /source_repo_mismatch/);
});

test("safeObj normalizes and sanitizes key artifact fields", () => {
  const raw = {
    schema_version: "artifact.v1",
    goal_ingest: true,
    factory_id: "worker",
    source_repo: "example/external-factory",
    run_id: "run-1",
    summary: "token ghp_abcdefghijklmnopqrstuvwxyz123456",
    evidence_excerpt: "path /Users/alice/private",
    required_factory_release: "1.2.3",
  };
  const safe = safeObj(raw);
  assert.equal(safe.goal_ingest, "true");
  assert.match(safe.summary, /\[REDACTED_TOKEN\]/);
  assert.match(safe.evidence_excerpt, /\[REDACTED_PATH\]/);
  assert.equal(safe.required_factory_release, "1.2.3");
});

test("computeSignature is deterministic and honors explicit signature_hash", () => {
  const artifact = {
    kind: "blocker",
    pipeline: "factory_supervisor_tick",
    node: "artifact_ingest",
    summary: "summary",
    evidence_excerpt: "evidence",
  };
  const a = computeSignature("example/external-factory", 42, artifact);
  const b = computeSignature("example/external-factory", 42, artifact);
  assert.equal(a, b);
  assert.match(a, /^sha256:/);

  const explicit = computeSignature("example/external-factory", 42, { ...artifact, signature_hash: "sha256:explicit" });
  assert.equal(explicit, "sha256:explicit");
});

test("buildLinkagePayload/comment produce factory_link.v1 contract", () => {
  const payload = buildLinkagePayload({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 10,
    signature: "sha256:abc",
    goalNumber: 500,
    factoryId: "external/issue_worker",
    requiredFactoryRelease: "1.2.3",
  });

  assert.equal(payload.schema_version, "factory_link.v1");
  assert.equal(payload.control_plane_goal, 500);
  assert.equal(payload.required_factory_release, "1.2.3");

  const comment = buildLinkageComment({
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 10,
    signature: "sha256:abc",
    goalNumber: 500,
    factoryId: "external/issue_worker",
    requiredFactoryRelease: "1.2.3",
  });
  assert.match(comment, /factory_link\.v1/);
  assert.match(comment, /required_factory_release/);
});
