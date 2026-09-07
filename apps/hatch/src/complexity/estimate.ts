import {
	COMPLEXITY_OTEL_CLASS_KEY,
	allComplexitySignals,
	normalizeComplexityInput,
	type ComplexityClass,
	type ComplexityEstimateInput,
	type ComplexitySignal,
} from "./signals.js";

export interface ComplexitySignalEstimate {
	value: string;
	reason: string;
	score: number;
	_reason: string;
	_score: number;
	_unknown: boolean;
}

export interface ComplexityEstimate {
	complexity_class: ComplexityClass;
	otel_dimension_key: typeof COMPLEXITY_OTEL_CLASS_KEY;
	signals: Record<string, ComplexitySignalEstimate>;
	reason: string;
	score: number;
}

export function estimateComplexity(input: ComplexityEstimateInput | unknown): ComplexityEstimate {
	const normalized = normalizeComplexityInput(input);
	const signals = allComplexitySignals(normalized);
	const signalMap = buildSignalMap(signals);
	const score = signals.reduce((sum, signal) => sum + signal.score, 0);
	const classFromScore = classifyScore(score);
	const hasUnknownSignal = signals.some((signal) => signal.unknown);
	const highRiskSignalCount = signals.filter((signal) => signal.score >= 2 && !signal.unknown).length;
	const hasConflictingHighSignals = highRiskSignalCount >= 2;
	const complexityClass = hasUnknownSignal || hasConflictingHighSignals
		? elevateClass(classFromScore)
		: classFromScore;

	return {
		complexity_class: complexityClass,
		otel_dimension_key: COMPLEXITY_OTEL_CLASS_KEY,
		signals: signalMap,
		reason: deterministicReason(signals, complexityClass, score),
		score,
	};
}

export function complexityTelemetryData(estimate: ComplexityEstimate): Record<string, string> {
	return {
		complexity_class: estimate.complexity_class,
		complexity_otel_key: estimate.otel_dimension_key,
		complexity_reason: estimate.reason,
		complexity_signals: JSON.stringify(estimate.signals),
		[estimate.otel_dimension_key]: estimate.complexity_class,
	};
}

function classifyScore(score: number): ComplexityClass {
	if (score <= 1) return "low";
	if (score <= 5) return "medium";
	return "high";
}

function elevateClass(_value: ComplexityClass): ComplexityClass {
	return "high";
}

function deterministicReason(signals: ComplexitySignal[], complexityClass: ComplexityClass, score: number): string {
	const ranked = [...signals]
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.key.localeCompare(b.key);
		})
		.slice(0, 3)
		.map((signal) => `${signal.key}:${signal.value}(${signal.reason})`);
	return `class=${complexityClass};score=${score};top=${ranked.join("|")}`;
}

function buildSignalMap(signals: ComplexitySignal[]): Record<string, ComplexitySignalEstimate> {
	const out: Record<string, ComplexitySignalEstimate> = {};
	for (const signal of signals) {
		out[signal.key] = {
			value: signal.value,
			reason: signal.reason,
			score: signal.score,
			_reason: signal.reason,
			_score: signal.score,
			_unknown: Boolean(signal.unknown),
		};
	}
	return out;
}
