import { createHash, createVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { FACTORY_OPS_ERROR_CODES } from "./error-catalog.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function normalizeHex(value = "") {
  const normalized = trim(value).toLowerCase().replace(/^0x/, "");
  return /^[a-f0-9]+$/.test(normalized) ? normalized : "";
}

function normalizePemBody(value = "") {
  return trim(value).replace(/\r\n/g, "\n");
}

function parseJson(text = "", fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toBase64(value = "") {
  const normalized = trim(value);
  if (!normalized) return "";
  const fromBase64 = Buffer.from(normalized, "base64").toString("base64");
  if (fromBase64 === normalized.replace(/\s+/g, "")) {
    return normalized;
  }

  const hex = normalizeHex(normalized);
  if (hex) {
    return Buffer.from(hex, "hex").toString("base64");
  }

  return "";
}

function resolveSignedPayload({ releaseManifestPath = "", runtimeEntrypointPath = "" } = {}) {
  const manifestPath = trim(releaseManifestPath);
  if (manifestPath && existsSync(manifestPath)) {
    return {
      payloadPath: manifestPath,
      payloadBytes: readFileSync(manifestPath),
      payloadType: "release_manifest",
    };
  }

  const entrypointPath = trim(runtimeEntrypointPath);
  if (entrypointPath && existsSync(entrypointPath)) {
    return {
      payloadPath: entrypointPath,
      payloadBytes: readFileSync(entrypointPath),
      payloadType: "runtime_entrypoint",
    };
  }

  return {
    payloadPath: "",
    payloadBytes: Buffer.alloc(0),
    payloadType: "missing",
  };
}

function resolveAlgorithm({ requestedAlgorithm = "" } = {}) {
  const normalized = trim(requestedAlgorithm || "sha256").toLowerCase();
  if (["sha256", "sha384", "sha512"].includes(normalized)) return normalized;
  return "sha256";
}

function computeDigestHex(bytes = Buffer.alloc(0), algorithm = "sha256") {
  return createHash(resolveAlgorithm({ requestedAlgorithm: algorithm })).update(bytes).digest("hex");
}

export function loadTrustPublicKey({ trustPublicKeyPath = "", trustPublicKeyPem = "", runtimeSignatureKeyId = "" } = {}) {
  const normalizedPath = trim(trustPublicKeyPath);
  const pemFromPath = normalizedPath && existsSync(normalizedPath) ? readFileSync(normalizedPath, "utf8") : "";
  const pem = normalizePemBody(trustPublicKeyPem || pemFromPath);
  const keyId = trim(runtimeSignatureKeyId)
    || (normalizedPath ? normalizedPath.split("/").pop() : "")
    || `sha256:${computeDigestHex(Buffer.from(pem || "", "utf8"), "sha256").slice(0, 16)}`;

  return {
    ok: Boolean(pem),
    errorCode: pem ? "" : FACTORY_OPS_ERROR_CODES.runtime_signature_key_missing,
    message: pem ? "runtime_signature_key_loaded" : "runtime_signature_key_missing",
    publicKeyPem: pem,
    keyId,
    algorithm: "sha256",
    hash: "sha256",
    trustPublicKeyPath: normalizedPath,
  };
}

export function verifyRuntimeSignature({
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  trustPublicKeyPath = "",
  trustPublicKeyPem = "",
  releaseManifestPath = "",
  runtimeEntrypointPath = "",
  signedPayloadPath = "",
  signatureAlgorithm = "sha256",
} = {}) {
  const signature = toBase64(runtimeSignature);
  if (!signature) {
    return {
      ok: false,
      keyId: trim(runtimeSignatureKeyId),
      verifiedAt: "",
      error: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      digest: "",
      digest_algorithm: resolveAlgorithm({ requestedAlgorithm: signatureAlgorithm }),
      payload_path: "",
      payload_type: "",
    };
  }

  const trustKey = loadTrustPublicKey({
    trustPublicKeyPath,
    trustPublicKeyPem,
    runtimeSignatureKeyId,
  });
  if (!trustKey.ok) {
    return {
      ok: false,
      keyId: trim(runtimeSignatureKeyId),
      verifiedAt: "",
      error: trustKey.message,
      errorCode: trustKey.errorCode,
      digest: "",
      digest_algorithm: trustKey.hash,
      payload_path: "",
      payload_type: "",
    };
  }

  const resolvedPayloadPath = trim(signedPayloadPath);
  let payload;
  if (resolvedPayloadPath) {
    if (!existsSync(resolvedPayloadPath)) {
      return {
        ok: false,
        keyId: trustKey.keyId,
        verifiedAt: "",
        error: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
        errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
        digest: "",
        digest_algorithm: trustKey.hash,
        payload_path: resolvedPayloadPath,
        payload_type: "explicit",
      };
    }
    payload = {
      payloadPath: resolvedPayloadPath,
      payloadBytes: readFileSync(resolvedPayloadPath),
      payloadType: "explicit",
    };
  } else {
    payload = resolveSignedPayload({ releaseManifestPath, runtimeEntrypointPath });
  }

  if (!payload?.payloadPath || !Buffer.isBuffer(payload.payloadBytes) || payload.payloadBytes.length === 0) {
    return {
      ok: false,
      keyId: trustKey.keyId,
      verifiedAt: "",
      error: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      digest: "",
      digest_algorithm: trustKey.hash,
      payload_path: trim(payload?.payloadPath),
      payload_type: trim(payload?.payloadType),
    };
  }

  const digestAlgorithm = resolveAlgorithm({ requestedAlgorithm: signatureAlgorithm });
  const digest = computeDigestHex(payload.payloadBytes, digestAlgorithm);

  try {
    const verifier = createVerify(digestAlgorithm);
    verifier.update(payload.payloadBytes);
    verifier.end();
    const verified = verifier.verify(trustKey.publicKeyPem, signature, "base64");

    return {
      ok: verified,
      keyId: trustKey.keyId,
      verifiedAt: verified ? new Date().toISOString() : "",
      error: verified ? "" : FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      errorCode: verified ? "" : FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      digest,
      digest_algorithm: digestAlgorithm,
      payload_path: payload.payloadPath,
      payload_type: payload.payloadType,
    };
  } catch (error) {
    return {
      ok: false,
      keyId: trustKey.keyId,
      verifiedAt: "",
      error: String(error?.message || FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid),
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_invalid,
      digest,
      digest_algorithm: digestAlgorithm,
      payload_path: payload.payloadPath,
      payload_type: payload.payloadType,
    };
  }
}

export function extractRuntimeSignatureInputs({
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  trustPublicKeyPath = "",
  trustPublicKeyPem = "",
  env = process.env,
} = {}) {
  const normalized = {
    runtimeSignature: trim(runtimeSignature || env.HATCH_HOST_RUNTIME_SIGNATURE || ""),
    runtimeSignatureKeyId: trim(runtimeSignatureKeyId || env.HATCH_HOST_RUNTIME_SIGNATURE_KEY_ID || ""),
    trustPublicKeyPath: trim(trustPublicKeyPath || env.HATCH_HOST_RUNTIME_PUBLIC_KEY_PATH || ""),
    trustPublicKeyPem: trim(trustPublicKeyPem || env.HATCH_HOST_RUNTIME_PUBLIC_KEY_PEM || ""),
  };

  const missing = [];
  if (!normalized.runtimeSignature) missing.push("runtime_signature");
  if (!normalized.runtimeSignatureKeyId) missing.push("runtime_signature_key_id");
  if (!normalized.trustPublicKeyPath && !normalized.trustPublicKeyPem) missing.push("trust_public_key");

  if (missing.length > 0) {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      message: `host_runtime_signature_missing:${missing.join(",")}`,
      inputs: normalized,
    };
  }

  const trustKey = loadTrustPublicKey({
    trustPublicKeyPath: normalized.trustPublicKeyPath,
    trustPublicKeyPem: normalized.trustPublicKeyPem,
    runtimeSignatureKeyId: normalized.runtimeSignatureKeyId,
  });

  if (!trustKey.ok) {
    return {
      ok: false,
      errorCode: trustKey.errorCode,
      message: trustKey.message,
      inputs: normalized,
    };
  }

  return {
    ok: true,
    errorCode: "",
    message: "runtime_signature_inputs_ready",
    inputs: normalized,
  };
}

export function buildRuntimeSignatureEvidence({
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  verification = {},
} = {}) {
  const signatureBytes = trim(runtimeSignature) ? Buffer.from(trim(runtimeSignature), "utf8") : Buffer.alloc(0);
  const signatureHash = signatureBytes.length > 0 ? `sha256:${computeDigestHex(signatureBytes, "sha256")}` : "";

  return {
    runtime_signature: trim(runtimeSignature),
    runtime_signature_key_id: trim(runtimeSignatureKeyId || verification.keyId || ""),
    runtime_signature_hash: signatureHash,
    runtime_signature_status: verification.ok ? "verified" : "invalid",
    runtime_signature_verified_at: trim(verification.verifiedAt || ""),
    runtime_signature_error: trim(verification.error || verification.errorCode || ""),
    runtime_signature_digest: trim(verification.digest || ""),
    runtime_signature_digest_algorithm: trim(verification.digest_algorithm || "sha256"),
    runtime_signature_payload_path: trim(verification.payload_path || ""),
    runtime_signature_payload_type: trim(verification.payload_type || ""),
  };
}

export function readRuntimeSignatureFromReleaseManifest({ releaseManifestPath = "" } = {}) {
  const manifestPath = trim(releaseManifestPath);
  if (!manifestPath || !existsSync(manifestPath)) {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      message: "host_runtime_signature_missing:release_manifest",
      runtimeSignature: "",
      runtimeSignatureKeyId: "",
      signatureAlgorithm: "sha256",
    };
  }

  const parsed = parseJson(readFileSync(manifestPath, "utf8"), null);
  const runtimeSignature = trim(parsed?.trust?.signature?.signature || parsed?.metadata?.runtime_signature || parsed?.runtime_signature || "");
  const runtimeSignatureKeyId = trim(parsed?.trust?.signature?.key_id || parsed?.metadata?.runtime_signature_key_id || parsed?.runtime_signature_key_id || "");
  const signatureAlgorithm = trim(parsed?.trust?.signature?.signature_algorithm || parsed?.metadata?.runtime_signature_algorithm || parsed?.runtime_signature_algorithm || "sha256");

  if (!runtimeSignature || !runtimeSignatureKeyId) {
    return {
      ok: false,
      errorCode: FACTORY_OPS_ERROR_CODES.host_runtime_signature_missing,
      message: "host_runtime_signature_missing:release_manifest_fields",
      runtimeSignature,
      runtimeSignatureKeyId,
      signatureAlgorithm,
    };
  }

  return {
    ok: true,
    errorCode: "",
    message: "runtime_signature_manifest_ready",
    runtimeSignature,
    runtimeSignatureKeyId,
    signatureAlgorithm,
  };
}
