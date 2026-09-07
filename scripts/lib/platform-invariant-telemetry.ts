function normalizeTokenValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return String(value).trim();
}

function encodeToken(value) {
  const normalized = normalizeTokenValue(value);
  if (!normalized) {
    return "";
  }
  if (/^[A-Za-z0-9_./:-]+$/.test(normalized)) {
    return normalized;
  }
  return JSON.stringify(normalized);
}

function renderFieldTokens(fields = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return [];
  }

  return Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => {
      const encoded = encodeToken(value);
      if (!encoded) {
        return "";
      }
      return `${key}=${encoded}`;
    })
    .filter(Boolean);
}

export function formatPlatformInvariantTelemetry({
  prefix = "platform-invariant",
  ok = false,
  diagnosticsCount = 0,
  fields = {},
} = {}) {
  const tokens = [`[${prefix}]`, `result=${ok ? "ok" : "fail"}`];
  if (!ok) {
    tokens.push(`diagnostics=${Math.max(0, Number(diagnosticsCount) || 0)}`);
  }
  tokens.push(...renderFieldTokens(fields));
  return tokens.join(" ");
}

