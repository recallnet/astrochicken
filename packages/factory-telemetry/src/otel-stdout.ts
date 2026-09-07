import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

export interface OtelEnvelope {
	ts?: string;
	event_name?: string;
	severity_text?: string;
	body?: Record<string, unknown>;
	attributes?: Record<string, string>;
	schema_version?: string;
}

export interface GovernedOtelEnvelope {
	ts?: string;
	event_name: string;
	severity_text?: string;
	body?: Record<string, unknown>;
	correlation: import("./otel-contract.js").GovernedOtelCorrelation;
	attributes?: Record<string, unknown>;
}

import {
	stringifyGovernedOtelAttributes,
	validateGovernedOtelAttributes,
	validateGovernedOtelCorrelation,
	validateGovernedOtelEventName,
} from "./otel-contract.js";

function toOtelAttributes(attrs: Record<string, string> = {}): Array<{ key: string; value: { stringValue: string } }> {
	return Object.entries(attrs).map(([key, value]) => ({
		key,
		value: { stringValue: value == null ? "" : String(value) },
	}));
}

function toUnixNano(isoTs: string): string {
	const ms = Date.parse(isoTs);
	if (!Number.isFinite(ms)) return String(Date.now() * 1_000_000);
	return String(Math.trunc(ms * 1_000_000));
}

let otelLoggerProvider: LoggerProvider | null = null;
let otelRuntimeDisabled = false;

function resolveOtelMode() {
	const mode = String(process.env.OTEL_MODE || "stdout").trim().toLowerCase();
	return {
		toStdout: mode === "stdout" || mode === "both" || mode === "",
		toOtlp: mode === "otlp" || mode === "both",
	};
}

function createOtelLoggerProvider(): LoggerProvider | null {
	const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
	if (!endpoint) throw new Error("missing OTEL_EXPORTER_OTLP_ENDPOINT");
	const timeoutMillis = Number(process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS || 2000);
	return new LoggerProvider({
		processors: [
			new BatchLogRecordProcessor(new OTLPLogExporter({
				url: endpoint,
				timeoutMillis: Number.isFinite(timeoutMillis) ? timeoutMillis : 2000,
			})),
		],
	});
}

function getOtelLoggerProvider(): LoggerProvider | null {
	if (otelRuntimeDisabled) return null;
	if (otelLoggerProvider) return otelLoggerProvider;
	try {
		otelLoggerProvider = createOtelLoggerProvider();
		return otelLoggerProvider;
	} catch (error) {
		otelRuntimeDisabled = true;
		const msg = String((error as Error)?.message || error || "otlp_export_failed");
		process.stderr.write(`[otel] export_failed ${msg}\n`);
		return null;
	}
}

function emitViaOtelSdk(envelope: Required<OtelEnvelope>): void {
	const provider = getOtelLoggerProvider();
	if (!provider) return;
	const serviceName = String(process.env.OTEL_SERVICE_NAME || "@recallnet/factory-telemetry").trim() || "@recallnet/factory-telemetry";
	const logger = provider.getLogger(serviceName, "v1");
	logger.emit({
		severityText: String(envelope.severity_text || "INFO"),
		body: JSON.stringify(envelope.body || {}),
		attributes: {
			event_name: String(envelope.event_name || "factory.supervisor.telemetry"),
			...envelope.attributes,
			"service.name": serviceName,
			"deployment.environment": String(process.env.NODE_ENV || "development"),
		},
		timestamp: Date.parse(envelope.ts) || Date.now(),
		observedTimestamp: Date.now(),
	});
}

// @context:regression !critical Auxiliary flush hooks let Langfuse (and any
// future telemetry sink) register their flush/shutdown callbacks so they
// execute alongside OTel flush. Commit e6b77eec removed direct Langfuse
// lifecycle management from cli.ts, breaking trace ingestion for 9 days.
const auxiliaryFlushHooks: Array<() => Promise<void>> = [];
const auxiliaryShutdownHooks: Array<() => Promise<void>> = [];

export function registerTelemetryFlushHook(hook: () => Promise<void>): void {
	auxiliaryFlushHooks.push(hook);
}

export function registerTelemetryShutdownHook(hook: () => Promise<void>): void {
	auxiliaryShutdownHooks.push(hook);
}

export async function flushOtelRuntime(): Promise<void> {
	const promises: Array<Promise<void>> = [];
	if (otelLoggerProvider) promises.push(otelLoggerProvider.forceFlush());
	for (const hook of auxiliaryFlushHooks) promises.push(hook());
	await Promise.allSettled(promises);
}

export async function shutdownOtelRuntime(): Promise<void> {
	const promises: Array<Promise<void>> = [];
	if (otelLoggerProvider) {
		const provider = otelLoggerProvider;
		otelLoggerProvider = null;
		otelRuntimeDisabled = false;
		promises.push(provider.shutdown());
	}
	for (const hook of auxiliaryShutdownHooks) promises.push(hook());
	await Promise.allSettled(promises);
	auxiliaryFlushHooks.length = 0;
	auxiliaryShutdownHooks.length = 0;
}

export function emitOtelEvent(event: OtelEnvelope = {}): Required<OtelEnvelope> {
	const envelope: Required<OtelEnvelope> = {
		ts: event.ts || new Date().toISOString(),
		schema_version: String(event.schema_version || "otel.event.v1"),
		event_name: String(event.event_name || "factory.supervisor.telemetry"),
		severity_text: String(event.severity_text || "INFO"),
		body: event.body || {},
		attributes: { ...(event.attributes || {}) },
	};
	const { toStdout, toOtlp } = resolveOtelMode();

	if (toStdout) {
		process.stderr.write(`OTEL_EVENT ${JSON.stringify(envelope)}\n`);
	}

	if (toOtlp) {
		emitViaOtelSdk(envelope);
	}

	return envelope;
}

export function emitGovernedOtelEvent(event: GovernedOtelEnvelope): Required<OtelEnvelope> {
	const diagnostics = [
		...validateGovernedOtelEventName(event?.event_name || ""),
		...validateGovernedOtelCorrelation(event?.correlation || {}),
		...validateGovernedOtelAttributes(stringifyGovernedOtelAttributes(event?.correlation || {}, event?.attributes || {})),
	];
	if (diagnostics.length > 0) {
		throw new Error(`invalid_governed_otel_event:${diagnostics.join(",")}`);
	}

	return emitOtelEvent({
		ts: event.ts,
		schema_version: "otel.event.v2",
		event_name: event.event_name,
		severity_text: event.severity_text,
		body: event.body || {},
		attributes: stringifyGovernedOtelAttributes(event.correlation, event.attributes || {}),
	});
}
