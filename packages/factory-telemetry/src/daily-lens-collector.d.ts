declare module "@hatch/factory-core/daily-lens-collector" {
  export const MissingDataReason: {
    WINDOW_INVALID: string;
    SOURCE_MISSING: string;
    PARSE_ERROR: string;
  };
  export function addMissingData(payload: Record<string, unknown>, reason: string, detail: string, extra?: Record<string, unknown>): void;
  export function createCollectorEnvelope(opts: { source: string; windowStart: string; windowEnd: string }): Record<string, unknown> & { window: { start: string; end: string }; _windowMs: { startMs: string; endMs: string } };
  export function finalizeCollectorEnvelope(payload: Record<string, unknown>): Record<string, unknown>;
  export function inWindow(timestamp: string, windowStart: string, windowEnd: string): boolean;
  export function toArray(value: unknown): unknown[];
  export function toNumber(value: unknown, fallback: number): number;
  export function uniqueStrings(values: unknown[]): string[];
}
