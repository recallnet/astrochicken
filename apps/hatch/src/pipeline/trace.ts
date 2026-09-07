import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { extractComplexityDimensions } from "../complexity/telemetry.js";
import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

import type { Event, EventHandler, IntentMetadataLike } from "@recallnet/factory-telemetry";

/** TraceEntry is a single line in a JSONL trace file. */
export interface TraceEntry {
	ts: string;
	kind: string;
	traceId?: string;
	nodeId?: string;
	edgeFrom?: string;
	edgeTo?: string;
	message?: string;
	data?: Record<string, string>;
	dimensions?: Record<string, string>;
	error?: string;
	durationMs?: number;
	intent?: IntentMetadataLike;
}

/** Create a trace event handler that appends to a JSONL file. */
export function createTraceHandler(tracePath: string): EventHandler {
	assertPathDoesNotRecreateConfiguredRepo(tracePath, { label: "trace_path" });
	const dir = dirname(tracePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	// Write empty file to start fresh
	writeFileSync(tracePath, "");

	return (event: Event) => {
		const entry: TraceEntry = {
			ts: event.timestamp.toISOString(),
			kind: event.kind,
		};

		if (event.traceId) entry.traceId = event.traceId;
		if (event.nodeId) entry.nodeId = event.nodeId;
		if (event.edgeFrom) entry.edgeFrom = event.edgeFrom;
		if (event.edgeTo) entry.edgeTo = event.edgeTo;
		if (event.message) entry.message = event.message;
		if (event.data) entry.data = event.data;
		if (event.error) entry.error = event.error.message;
		if (event.intent) entry.intent = event.intent;
		const dimensions = extractComplexityDimensions(event.data);
		if (dimensions) entry.dimensions = dimensions;

		appendFileSync(tracePath, JSON.stringify(entry) + "\n");
	};
}

/** Default trace path for a pipeline file. */
export function defaultTracePath(pipelineFile: string): string {
	const base = pipelineFile.split("/").pop()?.replace(/\.dot$/, "") ?? "pipeline";
	return join(dirname(pipelineFile), `.hatch-trace-${base}.jsonl`);
}

/** Read and format a trace file for display. */
export function formatTrace(tracePath: string): string {
	if (!existsSync(tracePath)) return `No trace file found at ${tracePath}`;

	const lines = readFileSync(tracePath, "utf-8").trim().split("\n").filter(Boolean);
	const entries: TraceEntry[] = lines.map((l) => JSON.parse(l));

	if (entries.length === 0) return "Empty trace.";

	const result: string[] = [];
	result.push(`Trace: ${tracePath}`);
	result.push(`Events: ${entries.length}`);
	result.push("");

	// Compute timeline
	let pipelineStart: Date | undefined;
	let pipelineEnd: Date | undefined;

	for (const e of entries) {
		const ts = new Date(e.ts);
		if (!pipelineStart || ts < pipelineStart) pipelineStart = ts;
		if (!pipelineEnd || ts > pipelineEnd) pipelineEnd = ts;

		const elapsed = pipelineStart ? ts.getTime() - pipelineStart.getTime() : 0;
		const elapsedStr = formatMs(elapsed);

		let line = `[${elapsedStr}] ${e.kind}`;
		if (e.nodeId) line += ` node=${e.nodeId}`;
		if (e.edgeFrom && e.edgeTo) line += ` ${e.edgeFrom}->${e.edgeTo}`;
		if (e.message) line += ` "${truncate(e.message, 60)}"`;
		if (e.error) line += ` ERROR: ${truncate(e.error, 60)}`;
		if (e.data) {
			const pairs = Object.entries(e.data)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ");
			line += ` {${pairs}}`;
		}

		result.push(line);
	}

	if (pipelineStart && pipelineEnd) {
		const total = pipelineEnd.getTime() - pipelineStart.getTime();
		result.push("");
		result.push(`Total: ${formatMs(total)}`);
	}

	return result.join("\n");
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = ((ms % 60000) / 1000).toFixed(0);
	return `${mins}m${secs}s`;
}

function truncate(s: string, max: number): string {
	const clean = s.replace(/\n/g, " ").trim();
	if (clean.length <= max) return clean;
	return clean.substring(0, max - 3) + "...";
}
