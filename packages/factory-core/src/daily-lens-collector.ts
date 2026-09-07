export const MissingDataReason: Readonly<Record<string, string>> = Object.freeze({
  SOURCE_MISSING: "source_missing",
  WINDOW_INVALID: "window_invalid",
  COMMAND_FAILED: "command_failed",
  FILE_MISSING: "file_missing",
  PARSE_ERROR: "parse_error",
});

interface WindowResult {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
}

interface MissingDataEntry {
  reason: string;
  detail: string;
  [key: string]: unknown;
}

interface CollectorEnvelope {
  source: string;
  window: { start: string; end: string };
  missing_data: MissingDataEntry[];
  _windowMs: { startMs: number; endMs: number };
  [key: string]: unknown;
}

function parseIsoMs(value: unknown): number {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  const parsedMs = Date.parse(raw);
  return Number.isFinite(parsedMs) ? parsedMs : Number.NaN;
}

export function validateWindow(windowStart: unknown, windowEnd: unknown): WindowResult {
  const startMs = parseIsoMs(windowStart);
  const endMs = parseIsoMs(windowEnd);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("analysis_invalid_window: expected ISO timestamps for windowStart/windowEnd");
  }
  if (startMs >= endMs) {
    throw new Error("analysis_invalid_window: windowStart must be before windowEnd");
  }

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

export function createCollectorEnvelope({ source, windowStart, windowEnd }: { source: unknown; windowStart: unknown; windowEnd: unknown }): CollectorEnvelope {
  const window = validateWindow(windowStart, windowEnd);
  return {
    source: String(source || "unknown"),
    window: {
      start: window.start,
      end: window.end,
    },
    missing_data: [],
    _windowMs: {
      startMs: window.startMs,
      endMs: window.endMs,
    },
  };
}

export function finalizeCollectorEnvelope(payload: CollectorEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(payload || {}) };
  delete out._windowMs;
  return out;
}

export function addMissingData(payload: CollectorEnvelope, reason: string, detail: string, extra: Record<string, unknown> = {}): void {
  const allowed = new Set(Object.values(MissingDataReason));
  const normalizedReason = String(reason || "").trim();
  if (!allowed.has(normalizedReason)) {
    throw new Error(`analysis_invalid_missing_data_reason: ${normalizedReason || "(empty)"}`);
  }

  const normalizedDetail = String(detail || "").trim() || "unknown";
  payload.missing_data.push({
    reason: normalizedReason,
    detail: normalizedDetail,
    ...extra,
  });
}

export function inWindow(isoLike: unknown, startMs: number, endMs: number): boolean {
  const candidateMs = parseIsoMs(isoLike);
  return Number.isFinite(candidateMs) && candidateMs >= startMs && candidateMs < endMs;
}

export function parseJsonSafe(raw: unknown, fallback: unknown = null): unknown {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return fallback;
  }
}

export function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toNumber(value: unknown, fallback: number = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function uniqueStrings(values: unknown[] = []): string[] {
  return [...new Set(toArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function missingDataErrorText(missingData: unknown[] = []): string {
  const parts = toArray(missingData)
    .map((item) => String((item as Record<string, unknown>)?.detail || "").trim())
    .filter(Boolean);
  return parts.join("; ");
}
