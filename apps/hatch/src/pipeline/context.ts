import type { IntentMetadata } from "./intent.js";

/** StageStatus represents the execution status of a pipeline stage. */
export enum StageStatus {
	Pending = "pending",
	Running = "running",
	Completed = "completed",
	Failed = "failed",
	Skipped = "skipped",
}

/** OutcomeUsage tracks token usage for an outcome. */
export interface OutcomeUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

/** Outcome represents the result of executing a node handler. */
export interface Outcome {
	status: StageStatus;
	output: string;
	error?: string;
	contextUpdates?: Record<string, string>;
	suggestedNextNodes?: string[];
	preferredLabel?: string;
	durationMs?: number;
	usage?: OutcomeUsage;
	intent?: IntentMetadata;
}

/** StageRecord records the execution of a single pipeline stage. */
export interface StageRecord {
	nodeId: string;
	status: StageStatus;
	outcome?: Outcome;
	startedAt: Date;
	endedAt?: Date;
	attempt: number;
}

/** Context is a key-value store used during pipeline execution. */
export class Context {
	private values: Record<string, string>;

	constructor(initial?: Record<string, string>) {
		this.values = initial ? { ...initial } : {};
	}

	get(key: string): string {
		return this.values[key] ?? "";
	}

	set(key: string, value: string): void {
		this.values[key] = value;
	}

	has(key: string): boolean {
		return key in this.values;
	}

	delete(key: string): void {
		delete this.values[key];
	}

	all(): Record<string, string> {
		return { ...this.values };
	}

	merge(vals: Record<string, string>): void {
		for (const [k, v] of Object.entries(vals)) {
			this.values[k] = v;
		}
	}

	clone(): Context {
		return new Context(this.values);
	}

	/** Parse a stored string as JSON. Returns raw string on parse failure. */
	getJSON(key: string): unknown {
		const raw = this.get(key);
		if (!raw) return raw;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}

	/** Store a value as JSON string. Strings stored as-is. */
	setJSON(key: string, value: unknown): void {
		this.set(key, typeof value === "string" ? value : JSON.stringify(value));
	}

	/** Returns a lookup function that supports dot-path resolution. */
	lookup(): (key: string) => string {
		return (key: string) => this.resolve(key);
	}

	/** Resolve a key, supporting dot-path access into JSON values. */
	private resolve(key: string): string {
		if (!key.includes(".")) return this.get(key);

		const dotIdx = key.indexOf(".");
		const root = key.substring(0, dotIdx);
		const path = key.substring(dotIdx + 1);

		const raw = this.get(root);
		if (!raw) return "";

		try {
			const obj = JSON.parse(raw);
			const val = resolvePath(obj, path);
			if (val === undefined || val === null) return "";
			return typeof val === "object" ? JSON.stringify(val) : String(val);
		} catch {
			return "";
		}
	}
}

/** Resolve a dot-separated path into a nested object. */
function resolvePath(obj: unknown, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}
