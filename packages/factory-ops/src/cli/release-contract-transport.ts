import { decodeBase64Utf8, resolveB64OrRaw } from "./helpers.ts";
import { parseContractValue, parseJsonFlag, requireTransportPayload, resolveTransportPair } from "./release-command-helpers.ts";

function writeError(context, error) {
  context.stderr.write(`${String(error?.message || error)}\n`);
}

export function parseRequiredReleaseContractPair({
  context,
  operation,
  leftRaw,
  leftB64,
  leftLabel,
  leftValidate,
  rightRaw,
  rightB64,
  rightLabel,
  rightValidate,
} = {}) {
  let payloads;
  try {
    payloads = resolveTransportPair({
      leftRaw,
      leftB64,
      leftName: leftLabel,
      rightRaw,
      rightB64,
      rightName: rightLabel,
    });
  } catch (error) {
    writeError(context, error);
    return { ok: false };
  }

  if (!requireTransportPayload(context, payloads.left, `${operation} requires one transport: --${leftLabel} or --${leftLabel}-b64`)) {
    return { ok: false };
  }
  if (!requireTransportPayload(context, payloads.right, `${operation} requires one transport: --${rightLabel} or --${rightLabel}-b64`)) {
    return { ok: false };
  }

  if (leftB64 !== undefined && String(leftB64).trim() && !String(payloads.left).trim()) {
    context.stderr.write(`${operation} ${leftLabel} decode failed; ensure --${leftLabel}-b64 decodes to UTF-8 JSON\n`);
    return { ok: false };
  }
  if (rightB64 !== undefined && String(rightB64).trim() && !String(payloads.right).trim()) {
    context.stderr.write(`${operation} ${rightLabel} decode failed; ensure --${rightLabel}-b64 decodes to UTF-8 JSON\n`);
    return { ok: false };
  }

  const parsedLeft = parseContractValue({
    context,
    payload: payloads.left,
    label: leftLabel,
    validate: leftValidate,
  });
  if (!parsedLeft.ok) return { ok: false };

  const parsedRight = parseContractValue({
    context,
    payload: payloads.right,
    label: rightLabel,
    validate: rightValidate,
  });
  if (!parsedRight.ok) return { ok: false };

  return {
    ok: true,
    left: parsedLeft.value,
    right: parsedRight.value,
  };
}

export function parseRequiredReleaseContractInput({
  context,
  operation,
  raw,
  b64,
  label,
  validate,
} = {}) {
  let payload;
  try {
    payload = resolveB64OrRaw(raw, b64, label);
  } catch (error) {
    writeError(context, error);
    return { ok: false };
  }

  if (!requireTransportPayload(context, payload, `${operation} requires --${label} or --${label}-b64`)) {
    return { ok: false };
  }

  const parsed = parseContractValue({
    context,
    payload,
    label,
    validate,
  });
  if (!parsed.ok) return { ok: false };
  return { ok: true, value: parsed.value };
}

export function parseOptionalReleaseContractWithFallback({
  raw,
  b64,
  label,
  validate,
  warnings = [],
} = {}) {
  const rawPayload = String(raw ?? "");
  const encoded = String(b64 ?? "").trim();

  if (rawPayload && encoded) {
    warnings.push(`fallback:${label}_dual_transport_raw_preferred`);
  }

  const payload = rawPayload || decodeBase64Utf8(encoded);
  if (!String(payload || "").trim()) {
    warnings.push(`fallback:${label}_missing`);
    return {};
  }

  try {
    return validate(parseJsonFlag(String(payload), label));
  } catch {
    warnings.push(`fallback:${label}_json_parse_failed`);
    return {};
  }
}
