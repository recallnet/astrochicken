export const z: typeof import("zod").z;

export interface ArtifactTrustPolicy {
  schema_version: "artifact_trust_policy/v1";
  required: boolean;
  signing_stack: "cosign";
  attestation_stack: "in_toto_dsse";
  provenance_profile: "slsa_provenance/v1";
  verification_boundaries: Array<"release" | "promotion">;
  rationale: string;
}

export function defineArtifactTrustPolicy(definition?: Partial<ArtifactTrustPolicy> & {
  signingStack?: string;
  attestationStack?: string;
  provenanceProfile?: string;
  verificationBoundaries?: string[];
}): Readonly<ArtifactTrustPolicy>;

export function buildCosignSignatureRecord(options?: {
  keyId?: string;
  signature?: string;
  signatureAlgorithm?: string;
  payloadRef?: string;
  payloadType?: string;
  payloadBytes?: Buffer | string;
  payloadDigest?: string;
}): Record<string, unknown>;

export function buildSlsaProvenancePredicate(options?: {
  buildType?: string;
  builderId?: string;
  invocationId?: string;
  startedOn?: string;
  finishedOn?: string;
  externalParameters?: Record<string, string>;
  internalParameters?: Record<string, string>;
  resolvedDependencies?: Array<Record<string, unknown>>;
}): Record<string, unknown>;

export function buildDsseEnvelope(options?: {
  payloadType?: string;
  payload?: Record<string, unknown>;
  keyId?: string;
  signature?: string;
}): Record<string, unknown>;

export function buildSlsaAttestation(options?: {
  predicate?: Record<string, unknown>;
  keyId?: string;
  signature?: string;
}): Record<string, unknown>;

export function buildArtifactVerificationRecord(options?: {
  boundary?: "release" | "promotion";
  status?: "verified" | "failed";
  verifiedAt?: string;
  reason?: string;
}): Record<string, unknown>;

export function buildArtifactTrustBundle(options?: {
  policy?: ArtifactTrustPolicy;
  signature?: Record<string, unknown>;
  attestations?: Array<Record<string, unknown>>;
  verifications?: Array<Record<string, unknown>>;
}): Record<string, unknown>;

export function verifyCosignLikeSignature(options?: {
  signature?: string;
  publicKeyPem?: string;
  payloadBytes?: Buffer | string;
  signatureAlgorithm?: string;
  keyId?: string;
  payloadRef?: string;
  payloadType?: string;
  verificationBoundary?: "release" | "promotion";
}): Record<string, unknown>;
