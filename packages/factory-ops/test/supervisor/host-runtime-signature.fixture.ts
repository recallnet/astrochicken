import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function createRuntimeSignatureFixture({
  workspaceDir,
  payloadRelativePath = "payload/runtime-entrypoint.mjs",
  payloadContent = "export const runtime = 'signed';\n",
  manifestRelativePath = "release/host-runtime-release.json",
  keyName = "runtime-signing-key.pem",
} = {}) {
  const root = String(workspaceDir || "").trim();
  if (!root) {
    throw new Error("workspaceDir_required");
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const payloadPath = join(root, payloadRelativePath);
  mkdirSync(dirname(payloadPath), { recursive: true });
  writeFileSync(payloadPath, payloadContent, "utf8");

  const payloadBytes = Buffer.from(payloadContent, "utf8");
  const signatureBase64 = sign("sha256", payloadBytes, privateKey).toString("base64");

  const publicKeyPath = join(root, keyName);
  writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");

  const runtimeSignatureKeyId = "test-runtime-key-01";
  const releaseManifestPath = join(root, manifestRelativePath);
  mkdirSync(dirname(releaseManifestPath), { recursive: true });
  writeFileSync(releaseManifestPath, `${JSON.stringify({
    schema_version: "host_runtime_release/v1",
    trust: {
      signature: {
        signature: signatureBase64,
        key_id: runtimeSignatureKeyId,
        signature_algorithm: "sha256",
      },
    },
  }, null, 2)}\n`);

  return {
    payloadPath,
    releaseManifestPath,
    publicKeyPath,
    runtimeSignature: signatureBase64,
    runtimeSignatureKeyId,
  };
}
