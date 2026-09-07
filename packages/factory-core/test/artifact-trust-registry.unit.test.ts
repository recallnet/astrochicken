import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  buildArtifactTrustBundle,
  buildCosignSignatureRecord,
  buildSlsaAttestation,
  buildSlsaProvenancePredicate,
  buildArtifactVerificationRecord,
  defineArtifactTrustPolicy,
  verifyCosignLikeSignature,
} from "../src/artifact-trust-registry.ts";

test("artifact trust registry builds canonical cosign + slsa trust bundles", () => {
  const policy = defineArtifactTrustPolicy({
    rationale: "Release artifacts must be signed and verifiable at release and promotion boundaries.",
  });

  const signature = buildCosignSignatureRecord({
    keyId: "release-key-01",
    signature: "c2lnbmF0dXJl",
    payloadRef: "registry.example.dev/astrochicken:release-report-1",
    payloadType: "oci_artifact",
    payloadDigest: "sha256:deadbeef",
  });

  const predicate = buildSlsaProvenancePredicate({
    buildType: "https://recallnet.dev/build/release-report",
    builderId: "https://recallnet.dev/builders/release-report",
    invocationId: "run-123",
    startedOn: "2026-03-21T10:00:00.000Z",
    finishedOn: "2026-03-21T10:05:00.000Z",
    externalParameters: { artifact_ref: "registry.example.dev/astrochicken:release-report-1" },
    internalParameters: { workflow_id: "release_report_flow" },
    resolvedDependencies: [{ uri: "git+https://github.com/recallnet/astrochicken", digest: { sha1: "abc123" } }],
  });

  const attestation = buildSlsaAttestation({
    predicate,
    keyId: "release-key-01",
    signature: "c2lnbmF0dXJl",
  });

  const bundle = buildArtifactTrustBundle({
    policy,
    signature,
    attestations: [attestation],
    verifications: [buildArtifactVerificationRecord({
      boundary: "release",
      status: "verified",
      verifiedAt: "2026-03-21T10:06:00.000Z",
    })],
  });

  assert.equal(bundle.policy.signing_stack, "cosign");
  assert.equal(bundle.attestations[0].predicate_type, "https://slsa.dev/provenance/v1");
  assert.equal(bundle.verifications[0].boundary, "release");
});

test("artifact trust registry verifies canonical cosign-like signatures for payload bytes", () => {
  const payloadBytes = Buffer.from("signed payload\n", "utf8");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signature = sign("sha256", payloadBytes, privateKey).toString("base64");

  const verification = verifyCosignLikeSignature({
    signature,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    payloadBytes,
    keyId: "test-key-01",
    payloadRef: "registry.example.dev/astrochicken:artifact-1",
    payloadType: "oci_artifact",
    verificationBoundary: "promotion",
  });

  assert.equal(verification.ok, true);
  assert.equal(verification.signature.key_id, "test-key-01");
  assert.equal(verification.verification.boundary, "promotion");
  assert.equal(verification.verification.status, "verified");
});
