import type { Event } from "../events.js";

/**
 * Pluggable telemetry sink contract used by runtime fan-out integrations.
 *
 * - emit(): non-blocking fire-and-forget path for hot execution loops
 * - flush(): best-effort async drain
 * - close(): best-effort async shutdown
 */
export interface TelemetrySink {
	emit(event: Event | Record<string, unknown>): void;
	flush(): Promise<void>;
	close(): Promise<void>;
}
