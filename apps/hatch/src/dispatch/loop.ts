import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadFactoryRegistry, type FactoryRegistry } from "./registry.js";
import {
	dispatchQueueSourcePath,
	dispatchQueueSnapshotPath,
	dispatchRelativePath,
	ensureDispatchStore,
	loadDispatchQueue,
	nextDispatchTickId,
	saveDispatchQueue,
	saveDispatchRunRecord,
	saveDispatchTickRecord,
	type DispatchQueueEntry,
	type DispatchRunRecord,
	type DispatchTickRecord,
} from "./store.js";

export interface DispatchLoopOptions {
	rootDir: string;
	registryPath?: string;
	queuePath?: string;
	intervalMs?: number;
	maxPerTick?: number;
	runOnce?: boolean;
	signal?: AbortSignal;
}

export interface DispatchTickOptions {
	rootDir: string;
	registryPath?: string;
	queuePath?: string;
	maxPerTick?: number;
}

const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_MAX_PER_TICK = 1;

export async function runDispatchLoop(
	options: DispatchLoopOptions,
	tick: (opts: DispatchTickOptions) => Promise<void> = dispatchTick,
): Promise<void> {
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	let running = true;

	if (options.signal) {
		if (options.signal.aborted) return;
		options.signal.addEventListener(
			"abort",
			() => {
				running = false;
			},
			{ once: true },
		);
	}

	do {
		await tick({
			rootDir: options.rootDir,
			registryPath: options.registryPath,
			queuePath: options.queuePath,
			maxPerTick: options.maxPerTick,
		});

		if (options.runOnce) break;
		if (!running) break;
		if (intervalMs <= 0) break;
		await sleep(intervalMs);
	} while (running);
}

export async function dispatchTick(options: DispatchTickOptions): Promise<void> {
	const rootDir = options.rootDir;
	ensureDispatchStore(rootDir);

	const tickId = nextDispatchTickId(rootDir);
	const now = new Date().toISOString();
	const queueSourcePath = dispatchQueueSourcePath(rootDir, options.queuePath);
	const queueSnapshotPath = dispatchQueueSnapshotPath(rootDir, tickId);
	const maxPerTick = options.maxPerTick ?? DEFAULT_MAX_PER_TICK;

	const tickRecord: DispatchTickRecord = {
		tick_id: tickId,
		status: "running",
		started_at: now,
		queue_source: dispatchRelativePath(rootDir, queueSourcePath),
		queue_snapshot: dispatchRelativePath(rootDir, queueSnapshotPath),
		max_per_tick: maxPerTick,
		selected: [],
		run_ids: [],
	};

	saveDispatchTickRecord(rootDir, tickRecord);

	try {
		const queue = normalizeQueue(loadDispatchQueue(queueSourcePath));
		const selected = queue.slice(0, maxPerTick);
		const remaining = queue.slice(maxPerTick);

		saveDispatchQueue(queueSnapshotPath, remaining);
		saveDispatchQueue(queueSourcePath, remaining);

		const registry = loadRegistryIfPresent(rootDir, options.registryPath);

		for (const entry of selected) {
			const resolvedGraph = resolveGraphPath(entry.graph, registry, rootDir);
			const runId = deterministicRunId(tickId, entry.graph, entry.goal_id);
			const commandArgs = buildHatchCommandArgs(resolvedGraph, runId, entry);
			const command = formatCommand(["hatch", ...commandArgs]);

			const runRecord: DispatchRunRecord = {
				run_id: runId,
				tick_id: tickId,
				graph: resolvedGraph,
				goal_id: entry.goal_id,
				status: "queued",
				command,
				created_at: now,
				context_path: entry.context_path,
				context: entry.context,
			};
			saveDispatchRunRecord(rootDir, runRecord);

			tickRecord.selected.push({
				graph: entry.graph,
				goal_id: entry.goal_id,
				run_id: runId,
				command,
				context_path: entry.context_path,
				context: entry.context,
			});
			tickRecord.run_ids.push(runId);

			const child = spawn("hatch", commandArgs, {
				cwd: rootDir,
				stdio: "inherit",
			});

			runRecord.status = "running";
			runRecord.updated_at = new Date().toISOString();
			runRecord.pid = child.pid;
			saveDispatchRunRecord(rootDir, runRecord);

			child.on("error", (err) => {
				runRecord.status = "failed";
				runRecord.updated_at = new Date().toISOString();
				runRecord.command = `${command} (error: ${err.message})`;
				saveDispatchRunRecord(rootDir, runRecord);
			});
		}

		tickRecord.status = "completed";
		tickRecord.completed_at = new Date().toISOString();
		saveDispatchTickRecord(rootDir, tickRecord);
	} catch (err) {
		tickRecord.status = "failed";
		tickRecord.completed_at = new Date().toISOString();
		tickRecord.errors = [err instanceof Error ? err.message : String(err)];
		saveDispatchTickRecord(rootDir, tickRecord);
		throw err;
	}
}

function normalizeQueue(entries: DispatchQueueEntry[]): DispatchQueueEntry[] {
	return entries.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new Error(`Dispatch queue entry ${index} must be an object`);
		}

		const graph = typeof entry.graph === "string" ? entry.graph.trim() : "";
		if (!graph) {
			throw new Error(`Dispatch queue entry ${index} missing "graph"`);
		}

		const rawGoalId = (entry as DispatchQueueEntry & { goalId?: unknown }).goal_id ?? (entry as { goalId?: unknown }).goalId;
		const goalId = rawGoalId ? String(rawGoalId).trim() : undefined;
		const rawContextPath = (entry as DispatchQueueEntry & { contextPath?: unknown }).context_path ?? (entry as { contextPath?: unknown }).contextPath;
		const contextPath = rawContextPath ? String(rawContextPath).trim() : undefined;
		const context = entry.context && typeof entry.context === "object" && !Array.isArray(entry.context) ? entry.context : undefined;

		return {
			graph,
			goal_id: goalId || undefined,
			context_path: contextPath || undefined,
			context,
		};
	});
}

function loadRegistryIfPresent(rootDir: string, registryPath?: string): FactoryRegistry | undefined {
	const candidate = resolve(rootDir, registryPath ?? "factory-registry.json");
	if (!existsSync(candidate)) return undefined;
	return loadFactoryRegistry({ rootDir, registryPath });
}

function resolveGraphPath(graph: string, registry: FactoryRegistry | undefined, rootDir: string): string {
	if (graph.includes("/") || graph.endsWith(".dot")) {
		return resolve(rootDir, graph);
	}

	if (!registry) {
		throw new Error(`Graph "${graph}" not found (missing factory registry)`);
	}

	for (const factory of registry.factories) {
		const match = factory.graphs.find((entry) => entry.id === graph);
		if (match) return resolve(rootDir, match.path);
	}

	throw new Error(`Graph "${graph}" not found in factory registry`);
}

function buildHatchCommandArgs(graphPath: string, runId: string, entry: DispatchQueueEntry): string[] {
	const args = ["run", graphPath, "--run-id", runId];
	if (entry.context_path) {
		args.push("--context", entry.context_path);
	} else if (entry.context) {
		args.push("--context", JSON.stringify(entry.context));
	}
	return args;
}

function deterministicRunId(tickId: string, graph: string, goalId?: string): string {
	const input = `${tickId}:${graph}:${goalId ?? ""}`;
	const hash = createHash("sha256").update(input).digest();
	const bytes = Buffer.from(hash.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatCommand(parts: string[]): string {
	return parts
		.map((part) => {
			if (/\s/.test(part) || part.includes("\"") || part.includes("'")) {
				return JSON.stringify(part);
			}
			return part;
		})
		.join(" ");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
