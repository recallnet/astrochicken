import { resolveB64OrRaw } from "./helpers.ts";

export function parseJsonFlag(raw, flagName) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`--${flagName} must be valid JSON`);
  }
}

export function parsePolicyInput({ policyJson = "", policyPath = "", readFileSyncFn = null } = {}) {
  const inline = String(policyJson || "").trim();
  const path = String(policyPath || "").trim();

  if (inline && path) {
    throw new Error("release validate-policy accepts one input: --policy-json or --policy-path");
  }
  if (!inline && !path) {
    throw new Error("release validate-policy requires --policy-json or --policy-path");
  }

  if (inline) {
    return parseJsonFlag(inline, "policy-json");
  }

  if (typeof readFileSyncFn !== "function") {
    throw new Error("--policy-path read failed: missing_read_file_sync_fn");
  }

  try {
    return parseJsonFlag(readFileSyncFn(path, "utf8"), "policy-path");
  } catch (error) {
    const message = String(error?.message || error || "policy_path_read_failed");
    if (message.includes("--policy-path")) throw error;
    throw new Error(`--policy-path read failed: ${message}`);
  }
}

export function resolveTransportPair({
  leftRaw,
  leftB64,
  leftName,
  rightRaw,
  rightB64,
  rightName,
} = {}) {
  return {
    left: resolveB64OrRaw(leftRaw, leftB64, leftName),
    right: resolveB64OrRaw(rightRaw, rightB64, rightName),
  };
}

export function requireTransportPayload(context, payload, message) {
  if (String(payload || "").trim()) return true;
  context.stderr.write(`${message}\n`);
  return false;
}

export function parseJsonTransportPair({
  context,
  leftPayload,
  leftName,
  rightPayload,
  rightName,
} = {}) {
  try {
    return {
      ok: true,
      left: parseJsonFlag(String(leftPayload), leftName),
      right: parseJsonFlag(String(rightPayload), rightName),
    };
  } catch (error) {
    context.stderr.write(`${String(error?.message || error)}\n`);
    return { ok: false };
  }
}

export function parseContractValue({ context, payload, label, validate }) {
  try {
    const parsed = parseJsonFlag(String(payload), label);
    return { ok: true, value: validate(parsed) };
  } catch (error) {
    context.stderr.write(`${String(error?.message || error)}\n`);
    return { ok: false };
  }
}
