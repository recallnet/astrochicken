import { COMPLEXITY_OTEL_CLASS_KEY } from "./signals.js";

import type { Outcome } from "../pipeline/context.js";

export const DEFAULT_COMPLEXITY_CLASS = "unknown";
export const DEFAULT_COMPLEXITY_REASON = "class=unknown;reason=missing_estimator_output";
export const DEFAULT_COMPLEXITY_OTEL_KEY = COMPLEXITY_OTEL_CLASS_KEY;

export interface ComplexityTelemetry {
	complexityClass: string;
	executionPath: string;
	pathTaken: string;
	mergeResolver: string;
	signalMap: Record<string, unknown>;
	reason: string;
	otelDimensionKey: string;
}

export function mapPathTakenToExecutionPath(pathTaken: string, complexityClass = DEFAULT_COMPLEXITY_CLASS): string {
	const normalized = String(pathTaken || "").trim().toLowerCase();
	if (normalized === "fast" || normalized === "moderate" || normalized === "full") return normalized;
	return derivePathTakenFromComplexityClass(complexityClass);
}

export function resolveComplexityTelemetry(args: {
	context: Record<string, string>;
	outcome?: Outcome;
}): ComplexityTelemetry {
	const context = args.context || {};
	const outcome = args.outcome;
	const updates = (outcome?.contextUpdates || {}) as Record<string, unknown>;
	const output = parseJsonObject(outcome?.output || "") || {};

	const complexityClass =
		pickString([updates], ["complexity_class", DEFAULT_COMPLEXITY_OTEL_KEY]) ||
		pickString([context], ["complexity_class", DEFAULT_COMPLEXITY_OTEL_KEY]) ||
		pickString([output], ["complexity_class", DEFAULT_COMPLEXITY_OTEL_KEY]) ||
		DEFAULT_COMPLEXITY_CLASS;

	const otelDimensionKey =
		pickString([updates, context, output], ["complexity_otel_key"]) ||
		pickEstimatorString([updates, output], ["otel_dimension_key"]) ||
		DEFAULT_COMPLEXITY_OTEL_KEY;

	const signalMap =
		pickSignalMap([updates, context, output], ["complexity_signals"]) ||
		pickEstimatorSignalMap([updates, output], ["signals"]) ||
		defaultSignalMap(complexityClass);

	const pathTaken =
		pickString([updates, context, output], ["path_taken"]) ||
		derivePathTakenFromComplexityClass(complexityClass);
	const executionPath =
		pickString([updates, context, output], ["hatch.execution.path", "execution_path"]) ||
		mapPathTakenToExecutionPath(pathTaken, complexityClass);
	const mergeResolver =
		pickString([updates, context, output], ["hatch.merge.resolver", "merge_resolver", "resolution_source"]) ||
		"unknown";

	const reason =
		pickString([updates, context, output], ["complexity_reason"]) ||
		pickEstimatorString([updates, output], ["reason"]) ||
		DEFAULT_COMPLEXITY_REASON;

	return {
		complexityClass,
		executionPath,
		pathTaken,
		mergeResolver,
		signalMap,
		reason,
		otelDimensionKey,
	};
}

export function complexityTelemetryEventData(telemetry: ComplexityTelemetry): Record<string, string> {
	const out: Record<string, string> = {
		complexity_class: telemetry.complexityClass,
		complexity_signals: JSON.stringify(telemetry.signalMap),
		complexity_reason: telemetry.reason,
		complexity_otel_key: telemetry.otelDimensionKey,
		[telemetry.otelDimensionKey]: telemetry.complexityClass,
		"hatch.execution.path": telemetry.executionPath,
		path_taken: telemetry.pathTaken,
		"hatch.merge.resolver": telemetry.mergeResolver,
	};

	for (const [key, value] of Object.entries(telemetry.signalMap)) {
		emitSignalTelemetry(out, key, value);
	}

	return out;
}

export function extractComplexityDimensions(data: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!data) return undefined;
	const dimensions: Record<string, string> = {};
	const complexityClass = String(data["complexity_class"] || "").trim();
	if (complexityClass) {
		const otelKey = String(data["complexity_otel_key"] || DEFAULT_COMPLEXITY_OTEL_KEY).trim() || DEFAULT_COMPLEXITY_OTEL_KEY;
		dimensions[otelKey] = complexityClass;
	}
	const executionPath = String(data["hatch.execution.path"] || "").trim();
	if (executionPath) dimensions["hatch.execution.path"] = executionPath;
	const pathTaken = String(data["path_taken"] || "").trim();
	if (pathTaken) dimensions["path_taken"] = pathTaken;
	const mergeResolver = String(data["hatch.merge.resolver"] || "").trim();
	if (mergeResolver) dimensions["hatch.merge.resolver"] = mergeResolver;
	return Object.keys(dimensions).length > 0 ? dimensions : undefined;
}

function pickString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | undefined {
	for (const source of sources) {
		if (!source) continue;
		for (const key of keys) {
			const value = source[key];
			if (typeof value !== "string") continue;
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return undefined;
}

function pickEstimatorString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | undefined {
	for (const source of sources) {
		if (!source || !isEstimatorPayload(source)) continue;
		const value = pickString([source], keys);
		if (value) return value;
	}
	return undefined;
}

function pickSignalMap(
	sources: Array<Record<string, unknown> | null>,
	keys: string[],
): Record<string, unknown> | undefined {
	for (const source of sources) {
		if (!source) continue;
		for (const key of keys) {
			const parsed = asSignalRecord(source[key]);
			if (parsed && Object.keys(parsed).length > 0) return parsed;
		}
	}
	return undefined;
}

function pickEstimatorSignalMap(
	sources: Array<Record<string, unknown> | null>,
	keys: string[],
): Record<string, unknown> | undefined {
	for (const source of sources) {
		if (!source || !isEstimatorPayload(source)) continue;
		const parsed = pickSignalMap([source], keys);
		if (parsed) return parsed;
	}
	return undefined;
}

function isEstimatorPayload(source: Record<string, unknown>): boolean {
	const complexityClass = String(source["complexity_class"] || "").trim();
	if (complexityClass) return true;

	const complexityOtelKey = String(source["complexity_otel_key"] || "").trim();
	if (complexityOtelKey) return true;

	const genericOtelKey = String(source["otel_dimension_key"] || "").trim();
	if (genericOtelKey) return true;

	if (typeof source[DEFAULT_COMPLEXITY_OTEL_KEY] === "string") {
		const defaultDimensionValue = String(source[DEFAULT_COMPLEXITY_OTEL_KEY] || "").trim();
		if (defaultDimensionValue) return true;
	}

	return false;
}

function defaultSignalMap(complexityClass: string): Record<string, string> {
	return { estimator_state: complexityClass === DEFAULT_COMPLEXITY_CLASS ? "missing" : "present" };
}

function derivePathTakenFromComplexityClass(complexityClass: string): string {
	const normalized = String(complexityClass || "").trim().toLowerCase();
	if (normalized === "fast" || normalized === "low") return "fast";
	if (normalized === "moderate" || normalized === "medium") return "moderate";
	if (normalized === "full" || normalized === "high") return "full";
	return "full";
}


function asSignalRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value) return undefined;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const parsed = parseJsonObject(trimmed);
		if (!parsed) return undefined;
		return normalizeSignalRecord(parsed);
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return normalizeSignalRecord(value as Record<string, unknown>);
	}
	return undefined;
}

function normalizeSignalRecord(value: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry === undefined || entry === null) continue;
		out[key] = entry;
	}
	return out;
}

function emitSignalTelemetry(out: Record<string, string>, key: string, value: unknown): void {
	const signalKey = sanitizeSignalKey(key);
	const prefix = `complexity_signal.${signalKey}`;
	if (value === undefined || value === null) return;

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		out[prefix] = String(value);
		return;
	}

	if (typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		const signalValue = record["value"];
		if (signalValue !== undefined && signalValue !== null) {
			out[prefix] = stringifySignalField(signalValue);
		}
		const reason = record["reason"];
		if (reason !== undefined && reason !== null) {
			out[`${prefix}.reason`] = stringifySignalField(reason);
		}
		const score = record["score"];
		if (score !== undefined && score !== null) {
			out[`${prefix}.score`] = stringifySignalField(score);
		}
		const unknownFlag = record["_unknown"];
		if (unknownFlag !== undefined && unknownFlag !== null) {
			out[`${prefix}._unknown`] = stringifySignalField(unknownFlag);
		}
		if (!(prefix in out)) {
			out[prefix] = stringifySignalField(record);
		}
		return;
	}

	out[prefix] = stringifySignalField(value);
}

function stringifySignalField(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function sanitizeSignalKey(key: string): string {
	return String(key || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "") || "unknown";
}
