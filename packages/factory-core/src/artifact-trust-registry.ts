import { createHash, createVerify } from "node:crypto";

import { sortJson, z } from "./schema-registry.ts";

function trim(value: string = ""): string {
  return String(value ?? "").trim();
}

function stableList(values: string[] = []): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => trim(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeIsoInstant(value: string = ""): string {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeBase64(value: string = ""): string {
  const normalized = trim(value).replace(/\s+/g, "");
  if (!normalized) return "";
  try {
    return Buffer.from(normalized, "base64").toString("base64") === normalized ? normalized : "";
  } catch {
    return "";
  }
}

function resolveDigestAlgorithm(value: string = ""): string {
  const normalized = trim(value || "sha256").toLowerCase();
  return ["sha256", "sha384", "sha512"].includes(normalized) ? normalized : "sha256";
}

function digestHex(bytes: Buffer = Buffer.alloc(0), algorithm: string = "sha256"): string {
  return createHash(resolveDigestAlgorithm(algorithm)).update(bytes).digest("hex");
}

export const artifactTrustPolicySchema = z.strictObject({
  schema_version: z.literal("artifact_trust_policy/v1"),
  required: z.boolean(),
  signing_stack: z.literal("cosign"),
  attestation_stack: z.literal("in_toto_dsse"),
  provenance_profile: z.literal("slsa_provenance/v1"),
  verification_boundaries: z.array(z.enum(["release", "promotion"])).min(1),
  rationale: z.string(),
});

export const artifactSignatureSchema = z.strictObject({
  schema_version: z.literal("artifact_signature/v1"),
  stack: z.literal("cosign"),
  key_id: z.string().trim().min(1),
  signature: z.string().trim().min(1),
  signature_algorithm: z.string().trim().min(1),
  payload_ref: z.string().trim().min(1),
  payload_type: z.string().trim().min(1),
  payload_digest: z.string().trim().min(1),
});

export const dsseEnvelopeSchema = z.strictObject({
  schema_version: z.literal("dsse_envelope/v1"),
  payload_type: z.string().trim().min(1),
  payload: z.string().trim().min(1),
  signatures: z.array(z.strictObject({
    keyid: z.string().trim().min(1),
    sig: z.string().trim().min(1),
  })).min(1),
});

export const slsaProvenancePredicateSchema = z.strictObject({
  build_definition: z.strictObject({
    build_type: z.string().trim().min(1),
    external_parameters: z.record(z.string(), z.string()),
    internal_parameters: z.record(z.string(), z.string()),
    resolved_dependencies: z.array(z.strictObject({
      uri: z.string().trim().min(1),
      digest: z.record(z.string(), z.string()),
    })),
  }),
  run_details: z.strictObject({
    builder: z.strictObject({
      id: z.string().trim().min(1),
    }),
    metadata: z.strictObject({
      invocation_id: z.string().trim().min(1),
      started_on: z.string().trim().min(1),
      finished_on: z.string().trim().min(1),
    }),
  }),
});

export const artifactAttestationSchema = z.strictObject({
  schema_version: z.literal("artifact_attestation/v1"),
  stack: z.literal("cosign"),
  predicate_type: z.literal("https://slsa.dev/provenance/v1"),
  predicate: slsaProvenancePredicateSchema,
  dsse_envelope: dsseEnvelopeSchema,
});

export const artifactVerificationSchema = z.strictObject({
  schema_version: z.literal("artifact_verification/v1"),
  boundary: z.enum(["release", "promotion"]),
  verifier: z.literal("cosign"),
  status: z.enum(["verified", "failed"]),
  verified_at: z.string(),
  reason: z.string(),
});

export const artifactTrustBundleSchema = z.strictObject({
  schema_version: z.literal("artifact_trust_bundle/v1"),
  policy: artifactTrustPolicySchema,
  signature: artifactSignatureSchema,
  attestations: z.array(artifactAttestationSchema).min(1),
  verifications: z.array(artifactVerificationSchema).min(1),
});

export function defineArtifactTrustPolicy({
  required = true,
  signingStack = "cosign",
  attestationStack = "in_toto_dsse",
  provenanceProfile = "slsa_provenance/v1",
  verificationBoundaries = ["release", "promotion"],
  rationale = "",
  signing_stack: legacySigningStack = "cosign",
  attestation_stack: legacyAttestationStack = "in_toto_dsse",
  provenance_profile: legacyProvenanceProfile = "slsa_provenance/v1",
  verification_boundaries: legacyVerificationBoundaries = ["release", "promotion"],
}: {
  required?: boolean;
  signingStack?: string;
  attestationStack?: string;
  provenanceProfile?: string;
  verificationBoundaries?: string[];
  rationale?: string;
  signing_stack?: string;
  attestation_stack?: string;
  provenance_profile?: string;
  verification_boundaries?: string[];
} = {}): Readonly<Record<string, unknown>> {
  return Object.freeze(artifactTrustPolicySchema.parse({
    schema_version: "artifact_trust_policy/v1",
    required: required === true,
    signing_stack: trim(signingStack || legacySigningStack || "cosign") || "cosign",
    attestation_stack: trim(attestationStack || legacyAttestationStack || "in_toto_dsse") || "in_toto_dsse",
    provenance_profile: trim(provenanceProfile || legacyProvenanceProfile || "slsa_provenance/v1") || "slsa_provenance/v1",
    verification_boundaries: stableList(verificationBoundaries || legacyVerificationBoundaries || ["release", "promotion"]),
    rationale: trim(rationale),
  }));
}

export function buildCosignSignatureRecord({
  keyId = "",
  signature = "",
  signatureAlgorithm = "sha256",
  payloadRef = "",
  payloadType = "",
  payloadBytes = Buffer.alloc(0),
  payloadDigest = "",
}: {
  keyId?: string;
  signature?: string;
  signatureAlgorithm?: string;
  payloadRef?: string;
  payloadType?: string;
  payloadBytes?: Buffer;
  payloadDigest?: string;
} = {}): Readonly<Record<string, unknown>> {
  const algorithm = resolveDigestAlgorithm(signatureAlgorithm);
  const normalizedPayloadDigest = trim(payloadDigest) || `sha256:${digestHex(Buffer.isBuffer(payloadBytes) ? payloadBytes : Buffer.from(payloadBytes || ""), algorithm)}`;
  return Object.freeze(artifactSignatureSchema.parse({
    schema_version: "artifact_signature/v1",
    stack: "cosign",
    key_id: trim(keyId),
    signature: trim(signature),
    signature_algorithm: algorithm,
    payload_ref: trim(payloadRef),
    payload_type: trim(payloadType),
    payload_digest: normalizedPayloadDigest,
  }));
}

export function buildSlsaProvenancePredicate({
  buildType = "",
  builderId = "",
  invocationId = "",
  startedOn = "",
  finishedOn = "",
  externalParameters = {},
  internalParameters = {},
  resolvedDependencies = [],
}: {
  buildType?: string;
  builderId?: string;
  invocationId?: string;
  startedOn?: string;
  finishedOn?: string;
  externalParameters?: Record<string, string>;
  internalParameters?: Record<string, string>;
  resolvedDependencies?: Array<{ uri?: string; digest?: Record<string, string> }>;
} = {}): Readonly<Record<string, unknown>> {
  return Object.freeze(slsaProvenancePredicateSchema.parse({
    build_definition: {
      build_type: trim(buildType),
      external_parameters: Object.fromEntries(
        Object.entries(externalParameters || {}).map(([key, value]) => [trim(key), trim(value)]).filter(([key, value]) => key && value),
      ),
      internal_parameters: Object.fromEntries(
        Object.entries(internalParameters || {}).map(([key, value]) => [trim(key), trim(value)]).filter(([key, value]) => key && value),
      ),
      resolved_dependencies: (Array.isArray(resolvedDependencies) ? resolvedDependencies : []).map((entry) => ({
        uri: trim(entry?.uri),
        digest: Object.fromEntries(
          Object.entries(entry?.digest || {}).map(([key, value]) => [trim(key), trim(value)]).filter(([key, value]) => key && value),
        ),
      })),
    },
    run_details: {
      builder: {
        id: trim(builderId),
      },
      metadata: {
        invocation_id: trim(invocationId),
        started_on: normalizeIsoInstant(startedOn),
        finished_on: normalizeIsoInstant(finishedOn),
      },
    },
  }));
}

export function buildDsseEnvelope({
  payloadType = "application/vnd.in-toto+json",
  payload = {},
  keyId = "",
  signature = "",
}: {
  payloadType?: string;
  payload?: unknown;
  keyId?: string;
  signature?: string;
} = {}): Readonly<Record<string, unknown>> {
  const normalizedPayload = Buffer.from(JSON.stringify(sortJson(payload), null, 2)).toString("base64");
  return Object.freeze(dsseEnvelopeSchema.parse({
    schema_version: "dsse_envelope/v1",
    payload_type: trim(payloadType),
    payload: normalizedPayload,
    signatures: [{
      keyid: trim(keyId),
      sig: trim(signature),
    }],
  }));
}

export function buildSlsaAttestation({
  predicate,
  keyId = "",
  signature = "",
}: {
  predicate: unknown;
  keyId?: string;
  signature?: string;
} = {} as { predicate: unknown }): Readonly<Record<string, unknown>> {
  const normalizedPredicate = slsaProvenancePredicateSchema.parse(predicate);
  return Object.freeze(artifactAttestationSchema.parse({
    schema_version: "artifact_attestation/v1",
    stack: "cosign",
    predicate_type: "https://slsa.dev/provenance/v1",
    predicate: normalizedPredicate,
    dsse_envelope: buildDsseEnvelope({
      payload: {
        _type: "https://in-toto.io/Statement/v1",
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: normalizedPredicate,
      },
      keyId,
      signature,
    }),
  }));
}

export function buildArtifactVerificationRecord({
  boundary = "release",
  status = "verified",
  verifiedAt = "",
  reason = "",
}: {
  boundary?: string;
  status?: string;
  verifiedAt?: string;
  reason?: string;
} = {}): Readonly<Record<string, unknown>> {
  return Object.freeze(artifactVerificationSchema.parse({
    schema_version: "artifact_verification/v1",
    boundary: trim(boundary),
    verifier: "cosign",
    status: trim(status),
    verified_at: normalizeIsoInstant(verifiedAt) || "",
    reason: trim(reason),
  }));
}

export function buildArtifactTrustBundle({
  policy,
  signature,
  attestations = [],
  verifications = [],
}: {
  policy: unknown;
  signature: unknown;
  attestations?: unknown[];
  verifications?: unknown[];
} = {} as { policy: unknown; signature: unknown }): Readonly<Record<string, unknown>> {
  return Object.freeze(artifactTrustBundleSchema.parse({
    schema_version: "artifact_trust_bundle/v1",
    policy: defineArtifactTrustPolicy(policy as Record<string, unknown>),
    signature,
    attestations,
    verifications,
  }));
}

export function verifyCosignLikeSignature({
  signature = "",
  publicKeyPem = "",
  payloadBytes = Buffer.alloc(0),
  signatureAlgorithm = "sha256",
  keyId = "",
  payloadRef = "",
  payloadType = "",
  verificationBoundary = "release",
}: {
  signature?: string;
  publicKeyPem?: string;
  payloadBytes?: Buffer;
  signatureAlgorithm?: string;
  keyId?: string;
  payloadRef?: string;
  payloadType?: string;
  verificationBoundary?: string;
} = {}): { ok: boolean; signature: Readonly<Record<string, unknown>> | null; verification: Readonly<Record<string, unknown>> } {
  const normalizedSignature = normalizeBase64(signature);
  if (!normalizedSignature || !trim(publicKeyPem)) {
    return {
      ok: false,
      signature: null,
      verification: buildArtifactVerificationRecord({
        boundary: verificationBoundary,
        status: "failed",
        verifiedAt: "",
        reason: "missing_signature_or_key",
      }),
    };
  }

  const bytes = Buffer.isBuffer(payloadBytes) ? payloadBytes : Buffer.from(payloadBytes || "");
  const algorithm = resolveDigestAlgorithm(signatureAlgorithm);
  const verifier = createVerify(algorithm);
  verifier.update(bytes);
  verifier.end();
  const verified = verifier.verify(trim(publicKeyPem), normalizedSignature, "base64");

  return {
    ok: verified,
    signature: buildCosignSignatureRecord({
      keyId,
      signature: normalizedSignature,
      signatureAlgorithm: algorithm,
      payloadRef,
      payloadType,
      payloadBytes: bytes,
    }),
    verification: buildArtifactVerificationRecord({
      boundary: verificationBoundary,
      status: verified ? "verified" : "failed",
      verifiedAt: verified ? new Date().toISOString() : "",
      reason: verified ? "" : "signature_verification_failed",
    }),
  };
}

export { z };
